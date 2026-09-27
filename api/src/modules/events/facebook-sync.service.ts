import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventRsvpEntity, RsvpSource, RsvpStatus } from '../../database/entities/event-rsvp.entity';
import { UserEntity, UserStatus } from '../../database/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { CalendarService } from '../calendar/calendar.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { EventsService, isHiddenRole } from './events.service';
import { FacebookAttendeeDto } from './dto/facebook-sync.dto';

// Cap on the host's guest list: additional_guests is an unsigned tinyint.
const MAX_HOST_GUESTS = 255;

interface SyncMember {
  userId: number;
  name: string;
  facebookName: string;
  plusOnes: number;
}

export interface FacebookSyncReport {
  eventId: number;
  added: SyncMember[];
  raised: (SyncMember & { from: number })[];
  unchanged: SyncMember[];
  removed: { userId: number; name: string }[];
  unmatched: { name: string; plusOnes: number }[];
  ambiguous: { name: string; candidates: { id: number; fullName: string }[] }[];
  host: { userId: number; name: string; guestNames: string[]; additionalGuests: number; changed: boolean } | null;
  warnings: string[];
}

function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Phase 39: reconciles an event's RSVPs against the Facebook event's Going
// list. Every rule lives here, not in the calling integration:
//  - a matched member not Going on the site is marked Going (source
//    facebook_sync) and gets the usual confirmation email, noting the sync
//  - a member already Going only ever has their +1s raised, never lowered
//  - an RSVP the sync created is removed once they drop off Facebook's list;
//    anything a member or admin set is never removed
//  - unmatched (or ambiguous) names become +1 guest names on the sync host's
//    RSVP, a list the sync owns outright
@Injectable()
export class FacebookSyncService {
  constructor(
    @InjectRepository(EventRsvpEntity)
    private readonly rsvpRepo: Repository<EventRsvpEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly eventsService: EventsService,
    private readonly integrationsService: IntegrationsService,
    private readonly calendarService: CalendarService,
    private readonly auditService: AuditService,
  ) {}

  async sync(eventId: number, attendees: FacebookAttendeeDto[], actorId: number): Promise<FacebookSyncReport> {
    const event = await this.eventsService.getRsvpableEvent(eventId);
    const hostId = await this.integrationsService.getSyncHostId();

    const users = (await this.userRepo.find({
      where: { status: UserStatus.ACTIVE },
      select: ['id', 'fullName', 'role'],
    })).filter((u) => !isHiddenRole(u.role));
    const usersById = new Map(users.map((u) => [u.id, u]));
    const byName = new Map<string, UserEntity[]>();
    for (const u of users) {
      const key = normalizeName(u.fullName);
      byName.set(key, [...(byName.get(key) ?? []), u]);
    }

    const report: FacebookSyncReport = {
      eventId,
      added: [],
      raised: [],
      unchanged: [],
      removed: [],
      unmatched: [],
      ambiguous: [],
      host: null,
      warnings: [],
    };

    // ── Match Facebook names to members ──────────────────────────────────────
    const matched = new Map<number, SyncMember>();
    for (const a of attendees) {
      const facebookName = a.name.trim();
      const plusOnes = a.plusOnes ?? 0;
      let user: UserEntity | undefined;
      if (a.userId) {
        user = usersById.get(a.userId);
        if (!user) report.warnings.push(`userId ${a.userId} (${facebookName}) is not an active member — treated as unmatched`);
      } else {
        const candidates = byName.get(normalizeName(facebookName)) ?? [];
        if (candidates.length === 1) {
          user = candidates[0];
        } else if (candidates.length > 1) {
          report.ambiguous.push({
            name: facebookName,
            candidates: candidates.map((c) => ({ id: c.id, fullName: c.fullName })),
          });
        }
      }

      if (!user) {
        report.unmatched.push({ name: facebookName, plusOnes });
        continue;
      }
      const prior = matched.get(user.id);
      matched.set(user.id, {
        userId: user.id,
        name: user.fullName,
        facebookName,
        plusOnes: Math.max(prior?.plusOnes ?? 0, plusOnes),
      });
    }

    const rsvps = await this.rsvpRepo.find({ where: { eventId } });
    const rsvpByUser = new Map(rsvps.map((r) => [r.userId, r]));
    const changedUserIds = new Set<number>();
    const audit = (userId: number, change: string, metadata: Record<string, unknown>) =>
      this.auditService.log({
        userId: actorId,
        action: 'rsvp.facebook_sync',
        entityType: 'event',
        entityId: eventId,
        metadata: { targetUserId: userId, change, ...metadata },
      });

    // ── Add / raise matched members (the host is handled below) ──────────────
    for (const m of matched.values()) {
      if (m.userId === hostId) continue;
      const existing = rsvpByUser.get(m.userId);

      if (!existing || existing.status !== RsvpStatus.GOING) {
        const { before } = await this.eventsService.setGoingOnBehalf(event, m.userId, RsvpSource.FACEBOOK_SYNC, {
          additionalGuests: m.plusOnes,
        });
        report.added.push(m);
        changedUserIds.add(m.userId);
        await audit(m.userId, 'added', { before, after: { status: RsvpStatus.GOING, additionalGuests: m.plusOnes } });
      } else if (m.plusOnes > existing.additionalGuests) {
        const from = existing.additionalGuests;
        existing.additionalGuests = m.plusOnes;
        await this.rsvpRepo.save(existing);
        report.raised.push({ ...m, from });
        changedUserIds.add(m.userId);
        await audit(m.userId, 'raised_guests', { from, to: m.plusOnes });
      } else {
        report.unchanged.push(m);
      }
    }

    // ── Remove sync-created RSVPs that fell off Facebook's Going list ────────
    for (const r of rsvps) {
      if (r.userId === hostId || matched.has(r.userId)) continue;
      if (r.source !== RsvpSource.FACEBOOK_SYNC || r.status !== RsvpStatus.GOING) continue;
      await this.rsvpRepo.remove(r);
      report.removed.push({ userId: r.userId, name: usersById.get(r.userId)?.fullName ?? `User ${r.userId}` });
      changedUserIds.add(r.userId);
      await audit(r.userId, 'removed', { before: { status: r.status, additionalGuests: r.additionalGuests } });
    }

    // ── Unmatched attendees ride on the host's RSVP as +1 names ──────────────
    const guestNames = report.unmatched
      .flatMap((u) => [u.name, ...Array.from({ length: u.plusOnes }, (_, i) => `${u.name} +${i + 1}`)])
      .slice(0, MAX_HOST_GUESTS);
    if (report.unmatched.length > 0 && guestNames.length === MAX_HOST_GUESTS) {
      report.warnings.push(`Host guest list capped at ${MAX_HOST_GUESTS} names`);
    }

    const host = hostId ? usersById.get(hostId) : undefined;
    if (!host) {
      if (report.unmatched.length > 0) {
        report.warnings.push('No sync host is configured (Admin → Integrations) — unmatched attendees were not recorded');
      }
    } else {
      const hostPlusOnes = matched.get(host.id)?.plusOnes ?? 0;
      const additionalGuests = Math.min(MAX_HOST_GUESTS, guestNames.length + hostPlusOnes);
      const shouldBeGoing = matched.has(host.id) || guestNames.length > 0;
      const existing = rsvpByUser.get(host.id);
      const isGoing = existing?.status === RsvpStatus.GOING;
      const sameGuests =
        isGoing &&
        existing.additionalGuests === additionalGuests &&
        JSON.stringify(existing.guestNames ?? []) === JSON.stringify(guestNames);
      let changed = false;

      if (shouldBeGoing && !sameGuests) {
        const { before } = await this.eventsService.setGoingOnBehalf(event, host.id, RsvpSource.FACEBOOK_SYNC, {
          additionalGuests,
          guestNames,
        });
        changed = true;
        await audit(host.id, 'host_guests', { before, after: { status: RsvpStatus.GOING, additionalGuests, guestNames } });
      } else if (!shouldBeGoing && isGoing) {
        if (existing.source === RsvpSource.FACEBOOK_SYNC) {
          await this.rsvpRepo.remove(existing);
          report.removed.push({ userId: host.id, name: host.fullName });
          changed = true;
          await audit(host.id, 'removed', { before: { status: existing.status, additionalGuests: existing.additionalGuests } });
        } else if (existing.additionalGuests > 0 || (existing.guestNames?.length ?? 0) > 0) {
          const before = { additionalGuests: existing.additionalGuests, guestNames: existing.guestNames };
          existing.additionalGuests = 0;
          existing.guestNames = null;
          await this.rsvpRepo.save(existing);
          changed = true;
          await audit(host.id, 'host_guests', { before, after: { additionalGuests: 0, guestNames: [] } });
        }
      }

      if (changed) changedUserIds.add(host.id);
      report.host = {
        userId: host.id,
        name: host.fullName,
        guestNames: shouldBeGoing ? guestNames : [],
        additionalGuests: shouldBeGoing ? additionalGuests : 0,
        changed,
      };
    }

    for (const userId of changedUserIds) this.calendarService.invalidateForUser(userId);
    return report;
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EventRsvpEntity, RsvpSource, RsvpStatus } from '../../database/entities/event-rsvp.entity';
import { FacebookAccountStatus } from '../../database/entities/facebook-account.entity';
import {
  FacebookEventAttendeeEntity,
  FacebookGuests,
  facebookGuests,
  isFacebookGoing,
  mergeFacebookGuests,
} from '../../database/entities/facebook-event-attendee.entity';
import { UserEntity, UserStatus } from '../../database/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { CalendarService } from '../calendar/calendar.service';
import { EventsService, isHiddenRole } from '../events/events.service';

export interface MemberGuestChange {
  eventId: number;
  userId: number;
  name: string;
  // The member's Facebook +1s now on the dinner (null = unnamed).
  facebookGuests: (string | null)[];
}

export interface ReconcileChanges {
  added: MemberGuestChange[];
  guestsChanged: (MemberGuestChange & { from: (string | null)[] })[];
  removed: { eventId: number; userId: number; name: string }[];
  warnings: string[];
}

export function emptyReconcileChanges(): ReconcileChanges {
  return { added: [], guestsChanged: [], removed: [], warnings: [] };
}

// A linked member's Facebook +1s as stored on their RSVP: every Facebook name
// not already one of their named website guests (ignoring case), then one
// null per unnamed +1. Facebook +1s are extra seats — never assumed to be a
// guest the member already added on the website.
export function facebookGuestsForRsvp(guests: FacebookGuests, websiteGuestNames: string[] | null): (string | null)[] {
  const onWebsite = new Set((websiteGuestNames ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean));
  const named = guests.names.filter((n) => !onWebsite.has(n.trim().toLowerCase()));
  return [...named, ...Array.from({ length: guests.unnamed }, () => null)];
}

// Brings one dinner's member RSVPs in line with its merged Facebook lists
// (Phase 39). Shared by the sync and by linking an account from the admin page.
//  - a linked member Going on any list is marked Going if they weren't
//    (source facebook_sync, with the usual email noting the sync)
//  - their Facebook +1s are stored beside their website guests, replaced on
//    every run; the website guests themselves are never touched
//  - once they're on none of the lists, a sync-made RSVP is removed and a
//    website-made one just loses its Facebook +1s
//  - banned or deleted members are flagged, never added or counted
@Injectable()
export class FacebookReconcileService {
  constructor(
    @InjectRepository(FacebookEventAttendeeEntity)
    private readonly attendeeRepo: Repository<FacebookEventAttendeeEntity>,
    @InjectRepository(EventRsvpEntity)
    private readonly rsvpRepo: Repository<EventRsvpEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly eventsService: EventsService,
    private readonly calendarService: CalendarService,
    private readonly auditService: AuditService,
  ) {}

  async reconcileEvent(eventId: number, actorId: number, changes: ReconcileChanges = emptyReconcileChanges()): Promise<ReconcileChanges> {
    const event = await this.eventsService.getRsvpableEvent(eventId);
    const rows = await this.attendeeRepo.find({ where: { eventId }, relations: ['facebookAccount'] });

    // Linked members Going on at least one list, with their +1s merged across
    // lists and accounts (a member with two Facebook accounts counts once).
    const perMember = new Map<number, FacebookGuests[]>();
    for (const row of rows) {
      const userId = row.facebookAccount?.userId;
      if (!userId || row.facebookAccount.status !== FacebookAccountStatus.LINKED || !isFacebookGoing(row)) continue;
      perMember.set(userId, [...(perMember.get(userId) ?? []), facebookGuests(row)]);
    }
    const goingMembers = new Map([...perMember].map(([userId, lists]) => [userId, mergeFacebookGuests(lists)]));

    const users = goingMembers.size ? await this.userRepo.find({ where: { id: In([...goingMembers.keys()]) } }) : [];
    const usersById = new Map(users.map((u) => [u.id, u]));
    const rsvps = await this.rsvpRepo.find({ where: { eventId } });
    const rsvpByUser = new Map(rsvps.map((r) => [r.userId, r]));
    const audit = (userId: number, change: string, metadata: Record<string, unknown>) =>
      this.auditService.log({
        userId: actorId,
        action: 'rsvp.facebook_sync',
        entityType: 'event',
        entityId: eventId,
        metadata: { targetUserId: userId, change, ...metadata },
      });

    for (const [userId, guests] of goingMembers) {
      const user = usersById.get(userId);
      if (!user || isHiddenRole(user.role)) continue;
      // A banned or deleted member keeps their Facebook link precisely so
      // they're recognized here. Never RSVP or count them — flag them.
      if (user.status !== UserStatus.ACTIVE) {
        const label = user.status === UserStatus.SUSPENDED ? 'banned' : 'deleted';
        changes.warnings.push(`${user.fullName} (${label} member) is Going on Facebook for event ${eventId} — not added or counted`);
        continue;
      }

      let rsvp = rsvpByUser.get(userId);
      if (!rsvp || rsvp.status !== RsvpStatus.GOING) {
        const { rsvp: saved, before } = await this.eventsService.setGoingOnBehalf(event, userId, RsvpSource.FACEBOOK_SYNC, {
          additionalGuests: rsvp?.additionalGuests ?? 0,
        });
        rsvp = saved;
        const facebook = facebookGuestsForRsvp(guests, rsvp.guestNames);
        await this.saveFacebookGuests(rsvp, facebook);
        changes.added.push({ eventId, userId, name: user.fullName, facebookGuests: facebook });
        await audit(userId, 'added', { before, after: { status: RsvpStatus.GOING, facebookGuests: facebook } });
        continue;
      }

      const facebook = facebookGuestsForRsvp(guests, rsvp.guestNames);
      const from = rsvp.facebookGuestNames ?? [];
      if (JSON.stringify(from) !== JSON.stringify(facebook)) {
        await this.saveFacebookGuests(rsvp, facebook);
        this.calendarService.invalidateForUser(userId);
        changes.guestsChanged.push({ eventId, userId, name: user.fullName, facebookGuests: facebook, from });
        await audit(userId, 'facebook_guests', { from, to: facebook });
      }
    }

    // Members on none of the dinner's lists any more.
    for (const r of rsvps) {
      if (goingMembers.has(r.userId)) continue;
      const user = usersById.get(r.userId) ?? (await this.userRepo.findOne({ where: { id: r.userId } }));
      if (r.source === RsvpSource.FACEBOOK_SYNC && r.status === RsvpStatus.GOING) {
        await this.rsvpRepo.remove(r);
        this.calendarService.invalidateForUser(r.userId);
        changes.removed.push({ eventId, userId: r.userId, name: user?.fullName ?? `User ${r.userId}` });
        await audit(r.userId, 'removed', { before: { status: r.status, facebookGuests: r.facebookGuestNames } });
      } else if ((r.facebookGuestNames?.length ?? 0) > 0 || r.facebookGuestCount > 0) {
        // Made on the website, so it stays — only its Facebook +1s go.
        const from = r.facebookGuestNames ?? [];
        await this.saveFacebookGuests(r, []);
        this.calendarService.invalidateForUser(r.userId);
        changes.guestsChanged.push({ eventId, userId: r.userId, name: user?.fullName ?? `User ${r.userId}`, facebookGuests: [], from });
        await audit(r.userId, 'facebook_guests', { from, to: [] });
      }
    }
    return changes;
  }

  private async saveFacebookGuests(rsvp: EventRsvpEntity, guests: (string | null)[]): Promise<void> {
    rsvp.facebookGuestNames = guests.length ? guests : null;
    rsvp.facebookGuestCount = Math.min(255, guests.length);
    await this.rsvpRepo.update(rsvp.id, {
      facebookGuestNames: rsvp.facebookGuestNames,
      facebookGuestCount: rsvp.facebookGuestCount,
    });
  }
}

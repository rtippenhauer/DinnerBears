import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EventFacebookLinkEntity } from '../../database/entities/event-facebook-link.entity';
import {
  FacebookAccountEntity,
  FacebookAccountStatus,
} from '../../database/entities/facebook-account.entity';
import {
  FacebookEventAttendeeEntity,
  FacebookGuests,
  isFacebookGoing,
  mergeFacebookGuests,
} from '../../database/entities/facebook-event-attendee.entity';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { FacebookAccountsService, MemberSuggestion } from './facebook-accounts.service';
import { emptyReconcileChanges, FacebookReconcileService, ReconcileChanges } from './facebook-reconcile.service';
import { FacebookEventSyncDto, FacebookSyncDto } from './dto/facebook-sync.dto';

export interface FacebookEventLinkView {
  facebookEventId: string;
  group: string | null;
  url: string;
  lastSyncedAt: Date | null;
  lastGoingCount: number | null;
}

export interface FacebookEventResult {
  facebookEventId: string;
  dinnerbearsEventId: number;
  group: string | null;
  // 'ok' — applied; 'skipped' — older than the list already applied;
  // 'error' — not applied (see `error`).
  status: 'ok' | 'skipped' | 'error';
  error?: string;
  // Guests accepted from this Facebook event's list.
  accepted: number;
  // False when going_count didn't match the guests sent — nobody was removed.
  complete: boolean;
  // The dinner's merged headcount after the whole batch: members Going plus
  // their +1s, Facebook-only people plus their +1s, and public guest signups.
  // Write this into the Facebook event's description.
  totalGoing: number | null;
}

export interface FacebookSyncReport extends ReconcileChanges {
  extractedAt: string | null;
  events: FacebookEventResult[];
  // Facebook accounts on these lists not yet linked to a member (and not
  // marked "not a member"). They count as Facebook-only attendees meanwhile.
  unmatched: { facebookAccountId: number; name: string; profileUrl: string | null; suggestions: MemberSuggestion[] }[];
}

// Phase 39: reconciles DinnerBears with the Going lists of the Facebook
// events that mirror each dinner (possibly several per dinner, one per group).
//
// Each Facebook event's list is stored on its own and replaced by each sync,
// then every affected dinner is reconciled against all of its lists together
// (FacebookReconcileService):
//  - a guest whose Facebook account an admin linked to a member counts through
//    that member's RSVP, with their Facebook +1s beside the member's own
//  - everyone else is a Facebook-only attendee, counted once however many
//    lists they're on
// Name matches are only ever suggestions — linking is an admin decision.
@Injectable()
export class FacebookSyncService {
  constructor(
    @InjectRepository(EventFacebookLinkEntity)
    private readonly linkRepo: Repository<EventFacebookLinkEntity>,
    @InjectRepository(FacebookEventAttendeeEntity)
    private readonly attendeeRepo: Repository<FacebookEventAttendeeEntity>,
    private readonly eventsService: EventsService,
    private readonly accountsService: FacebookAccountsService,
    private readonly reconcileService: FacebookReconcileService,
    private readonly auditService: AuditService,
  ) {}

  // ── Links between dinners and Facebook events ────────────────────────────

  async linksFor(eventIds: number[]): Promise<Map<number, FacebookEventLinkView[]>> {
    const map = new Map<number, FacebookEventLinkView[]>();
    if (eventIds.length === 0) return map;
    const links = await this.linkRepo.find({ where: { eventId: In(eventIds) }, order: { createdAt: 'ASC' } });
    for (const l of links) {
      map.set(l.eventId, [...(map.get(l.eventId) ?? []), this.view(l)]);
    }
    return map;
  }

  async linkFacebookEvent(eventId: number, facebookEventId: string, group: string | null | undefined, actorId: number): Promise<FacebookEventLinkView> {
    await this.eventsService.findOne(eventId); // 404 if the dinner doesn't exist
    const link = await this.upsertLink(eventId, facebookEventId, group);
    await this.auditService.log({
      userId: actorId,
      action: 'facebook.event_link',
      entityType: 'event',
      entityId: eventId,
      metadata: { facebookEventId, group: link.facebookGroup },
    });
    return this.view(link);
  }

  // Unlinking drops that Facebook event's list from the dinner and reconciles
  // it, so anyone who was only on that list stops counting.
  async unlinkFacebookEvent(eventId: number, facebookEventId: string, actorId: number): Promise<{ success: true }> {
    const link = await this.linkRepo.findOne({ where: { facebookEventId, eventId } });
    if (!link) throw new NotFoundException(`Facebook event ${facebookEventId} isn't linked to event ${eventId}`);
    await this.replaceSourceList(eventId, facebookEventId, new Map(), true);
    await this.linkRepo.remove(link);
    const changes = emptyReconcileChanges();
    await this.reconcileService.reconcileEvent(eventId, actorId, changes).catch(() => undefined); // past/draft: nothing to reconcile
    await this.auditService.log({
      userId: actorId,
      action: 'facebook.event_unlink',
      entityType: 'event',
      entityId: eventId,
      metadata: { facebookEventId, removed: changes.removed.map((r) => r.userId) },
    });
    return { success: true };
  }

  // ── The batch sync ────────────────────────────────────────────────────────

  async sync(dto: FacebookSyncDto, actorId: number): Promise<FacebookSyncReport> {
    const extractedAt = dto.extracted_at ? new Date(dto.extracted_at) : null;
    const report: FacebookSyncReport = {
      extractedAt: dto.extracted_at ?? null,
      events: [],
      ...emptyReconcileChanges(),
      unmatched: [],
    };
    const seenAccounts = new Map<number, FacebookAccountEntity>();
    const touchedEvents = new Set<number>();

    // 1. Apply every Facebook event's list before reconciling anything, so a
    //    dinner fed by two groups is judged on both lists together.
    for (const fb of dto.events) {
      const result: FacebookEventResult = {
        facebookEventId: fb.facebook_event_id,
        dinnerbearsEventId: fb.dinnerbears_event_id,
        group: fb.facebook_group ?? null,
        status: 'ok',
        accepted: 0,
        complete: true,
        totalGoing: null,
      };
      report.events.push(result);
      try {
        await this.applyList(fb, extractedAt, result, seenAccounts);
        if (result.status === 'ok') touchedEvents.add(fb.dinnerbears_event_id);
      } catch (err) {
        result.status = 'error';
        result.error = (err as Error).message;
      }
    }

    // 2. Reconcile each affected dinner's RSVPs against all its lists.
    for (const eventId of touchedEvents) {
      try {
        await this.reconcileService.reconcileEvent(eventId, actorId, report);
      } catch (err) {
        for (const r of report.events.filter((e) => e.dinnerbearsEventId === eventId)) {
          r.status = 'error';
          r.error = (err as Error).message;
        }
      }
    }

    // 3. Only now compute the counts handed back to each Facebook event.
    const totals = new Map<number, number>();
    for (const r of report.events) {
      if (r.status === 'error') continue;
      if (!totals.has(r.dinnerbearsEventId)) {
        totals.set(r.dinnerbearsEventId, await this.eventsService.getHeadcount(r.dinnerbearsEventId));
      }
      r.totalGoing = totals.get(r.dinnerbearsEventId)!;
    }

    const unmatched = [...seenAccounts.values()].filter((a) => a.status === FacebookAccountStatus.UNMATCHED);
    const suggestions = await this.accountsService.suggestionsFor(unmatched.map((a) => a.displayName));
    report.unmatched = unmatched.map((a) => ({
      facebookAccountId: a.id,
      name: a.displayName,
      profileUrl: a.profileUrl ? `https://www.${a.profileUrl}` : null,
      suggestions: suggestions.get(a.displayName) ?? [],
    }));
    for (const r of report.events) {
      if (!r.complete) {
        report.warnings.push(`Facebook event ${r.facebookEventId}: going_count didn't match the guests sent — nobody was removed from it`);
      }
    }

    await this.auditService.log({
      userId: actorId,
      action: 'facebook.sync',
      metadata: {
        events: report.events.map((e) => ({ facebookEventId: e.facebookEventId, eventId: e.dinnerbearsEventId, status: e.status, accepted: e.accepted })),
        added: report.added.length,
        guestsChanged: report.guestsChanged.length,
        removed: report.removed.length,
        unmatched: report.unmatched.length,
      },
    });
    return report;
  }

  private async applyList(
    fb: FacebookEventSyncDto,
    extractedAt: Date | null,
    result: FacebookEventResult,
    seenAccounts: Map<number, FacebookAccountEntity>,
  ): Promise<void> {
    await this.eventsService.getRsvpableEvent(fb.dinnerbears_event_id); // published, not past
    const link = await this.upsertLink(fb.dinnerbears_event_id, fb.facebook_event_id, fb.facebook_group);

    if (extractedAt && link.lastExtractedAt && extractedAt < link.lastExtractedAt) {
      result.status = 'skipped';
      result.error = 'A newer list for this Facebook event was already applied';
      return;
    }

    const guestsByAccount = new Map<number, FacebookGuests>();
    for (const g of fb.guests) {
      const account = await this.accountsService.resolve({
        name: g.name,
        profileUrl: g.profile_url,
        facebookUserId: g.facebook_user_id,
      });
      seenAccounts.set(account.id, account);
      const names = (g.plus_one_names ?? []).map((n) => n.trim()).filter(Boolean);
      const guests: FacebookGuests = { names, unnamed: Math.max(0, (g.plus_ones ?? 0) - names.length) };
      const prior = guestsByAccount.get(account.id);
      guestsByAccount.set(account.id, prior ? mergeFacebookGuests([prior, guests]) : mergeFacebookGuests([guests]));
    }

    result.accepted = guestsByAccount.size;
    result.complete = fb.going_count === undefined || fb.going_count === fb.guests.length;
    await this.replaceSourceList(fb.dinnerbears_event_id, fb.facebook_event_id, guestsByAccount, result.complete);

    link.lastExtractedAt = extractedAt ?? new Date();
    link.lastSyncedAt = new Date();
    link.lastGoingCount = result.accepted;
    await this.linkRepo.save(link);
  }

  // Replaces one Facebook event's entries on the dinner's attendee rows. A
  // partial list only adds and updates; it never takes anyone off.
  private async replaceSourceList(eventId: number, facebookEventId: string, guestsByAccount: Map<number, FacebookGuests>, complete: boolean): Promise<void> {
    const rows = await this.attendeeRepo.find({ where: { eventId } });
    const byAccount = new Map(rows.map((r) => [r.facebookAccountId, r]));

    for (const row of rows) {
      if (!guestsByAccount.has(row.facebookAccountId) && complete && facebookEventId in (row.sources ?? {})) {
        const { [facebookEventId]: _dropped, ...rest } = row.sources;
        row.sources = rest;
        if (!isFacebookGoing(row) && row.attended == null) {
          await this.attendeeRepo.remove(row);
        } else {
          await this.attendeeRepo.save(row);
        }
      }
    }
    for (const [accountId, guests] of guestsByAccount) {
      const row = byAccount.get(accountId) ?? this.attendeeRepo.create({ eventId, facebookAccountId: accountId, sources: {}, attended: null });
      row.sources = { ...(row.sources ?? {}), [facebookEventId]: guests };
      await this.attendeeRepo.save(row);
    }
  }

  private async upsertLink(eventId: number, facebookEventId: string, group: string | null | undefined): Promise<EventFacebookLinkEntity> {
    let link = await this.linkRepo.findOne({ where: { facebookEventId } });
    if (link && link.eventId !== eventId) {
      throw new ConflictException(`Facebook event ${facebookEventId} is already linked to event ${link.eventId}`);
    }
    if (!link) link = this.linkRepo.create({ eventId, facebookEventId });
    if (group !== undefined) link.facebookGroup = group?.trim() || null;
    return this.linkRepo.save(link);
  }

  private view(l: EventFacebookLinkEntity): FacebookEventLinkView {
    return {
      facebookEventId: l.facebookEventId,
      group: l.facebookGroup,
      url: `https://www.facebook.com/events/${l.facebookEventId}/`,
      lastSyncedAt: l.lastSyncedAt,
      lastGoingCount: l.lastGoingCount,
    };
  }
}

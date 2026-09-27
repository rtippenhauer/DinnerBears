import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EventEntity, EventStatus } from '../../database/entities/event.entity';
import { EventRsvpEntity, RsvpSource, RsvpStatus } from '../../database/entities/event-rsvp.entity';
import {
  FacebookAccountEntity,
  FacebookAccountStatus,
} from '../../database/entities/facebook-account.entity';
import {
  FacebookEventAttendeeEntity,
  facebookPlusOnes,
  isFacebookGoing,
} from '../../database/entities/facebook-event-attendee.entity';
import { UserEntity, UserStatus } from '../../database/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { EventsService, isHiddenRole } from '../events/events.service';
import { normalizePersonName, parseFacebookProfile } from './facebook-profile.util';

export interface MemberSuggestion {
  id: number;
  fullName: string;
}

export interface FacebookAccountRow {
  id: number;
  displayName: string;
  profileUrl: string | null;
  facebookUserId: string | null;
  status: FacebookAccountStatus;
  // `status` is the member's account status — 'suspended' (banned) or
  // 'deleted' accounts keep their Facebook link so they're recognized.
  member: { id: number; fullName: string; status: UserStatus } | null;
  lastSeenAt: Date | null;
  eventCount: number;
  suggestions: MemberSuggestion[];
}

@Injectable()
export class FacebookAccountsService {
  private readonly logger = new Logger(FacebookAccountsService.name);

  constructor(
    @InjectRepository(FacebookAccountEntity)
    private readonly accountRepo: Repository<FacebookAccountEntity>,
    @InjectRepository(FacebookEventAttendeeEntity)
    private readonly attendeeRepo: Repository<FacebookEventAttendeeEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(EventEntity)
    private readonly eventRepo: Repository<EventEntity>,
    @InjectRepository(EventRsvpEntity)
    private readonly rsvpRepo: Repository<EventRsvpEntity>,
    private readonly eventsService: EventsService,
    private readonly auditService: AuditService,
  ) {}

  // Finds the stored account for a guest on a Going list by their numeric
  // Facebook ID (the permanent key), creating it on first sighting. The name
  // and vanity URL are refreshed on every sync — Muse tracks vanity changes
  // and always sends the current one.
  async resolve(guest: { name: string; profileUrl: string; facebookUserId: string }): Promise<FacebookAccountEntity> {
    const facebookUserId = guest.facebookUserId;
    const parsed = parseFacebookProfile(guest.profileUrl);
    const profileUrl = parsed.profileUrl ?? guest.profileUrl.trim().slice(0, 255);

    let account = await this.accountRepo.findOne({ where: { facebookUserId } });
    if (!account) {
      account = this.accountRepo.create({ facebookUserId, status: FacebookAccountStatus.UNMATCHED });
    }

    // A vanity is unique to one person at a time; if another account still
    // holds it (their old vanity, since taken by this person), release it.
    if (account.profileUrl !== profileUrl) {
      const holder = await this.accountRepo.findOne({ where: { profileUrl } });
      if (holder && holder.id !== account.id) {
        holder.profileUrl = null;
        await this.accountRepo.save(holder);
      }
      account.profileUrl = profileUrl;
    }
    account.displayName = guest.name.trim();
    account.lastSeenAt = new Date();
    return this.accountRepo.save(account);
  }

  // Members whose name matches — offered to the admin to confirm, never
  // applied automatically.
  async suggestionsFor(names: string[]): Promise<Map<string, MemberSuggestion[]>> {
    const users = await this.activeMembers();
    const byName = new Map<string, MemberSuggestion[]>();
    for (const u of users) {
      const key = normalizePersonName(u.fullName);
      byName.set(key, [...(byName.get(key) ?? []), { id: u.id, fullName: u.fullName }]);
    }
    return new Map(names.map((n) => [n, byName.get(normalizePersonName(n)) ?? []]));
  }

  async list(status?: FacebookAccountStatus): Promise<FacebookAccountRow[]> {
    const accounts = await this.accountRepo.find({
      where: status ? { status } : {},
      relations: ['user'],
      order: { lastSeenAt: 'DESC' },
    });
    if (accounts.length === 0) return [];

    const counts = await this.attendeeRepo
      .createQueryBuilder('a')
      .select('a.facebookAccountId', 'accountId')
      .addSelect('COUNT(*)', 'n')
      .where('a.facebookAccountId IN (:...ids)', { ids: accounts.map((a) => a.id) })
      .groupBy('a.facebookAccountId')
      .getRawMany<{ accountId: string; n: string }>();
    const countMap = new Map(counts.map((c) => [Number(c.accountId), Number(c.n)]));

    const suggestions = await this.suggestionsFor(
      accounts.filter((a) => a.status === FacebookAccountStatus.UNMATCHED).map((a) => a.displayName),
    );

    return accounts.map((a) => ({
      id: a.id,
      displayName: a.displayName,
      profileUrl: a.profileUrl ? `https://www.${a.profileUrl}` : null,
      facebookUserId: a.facebookUserId,
      status: a.status,
      member: a.user ? { id: a.user.id, fullName: a.user.fullName, status: a.user.status } : null,
      lastSeenAt: a.lastSeenAt,
      eventCount: countMap.get(a.id) ?? 0,
      suggestions: a.status === FacebookAccountStatus.UNMATCHED ? suggestions.get(a.displayName) ?? [] : [],
    }));
  }

  // Ties a Facebook account to a member. From then on the member counts
  // through their own RSVP instead of as a Facebook-only attendee, and
  // anything this account already did carries over:
  //  - dinners it was marked Attended at become attended RSVPs, with points
  //  - upcoming dinners it's Going to become Going RSVPs (source facebook_sync)
  async link(accountId: number, userId: number, actorId: number): Promise<FacebookAccountRow> {
    const account = await this.getAccount(accountId);
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || user.status !== UserStatus.ACTIVE || isHiddenRole(user.role) || user.isAutomationAccount) {
      throw new NotFoundException('Member not found');
    }

    account.userId = user.id;
    account.status = FacebookAccountStatus.LINKED;
    account.linkedAt = new Date();
    account.linkedById = actorId;
    await this.accountRepo.save(account);

    const carried = await this.carryOver(account, user.id);
    await this.auditService.log({
      userId: actorId,
      action: 'facebook.account_link',
      entityType: 'user',
      entityId: user.id,
      metadata: { facebookAccountId: account.id, displayName: account.displayName, ...carried },
    });
    return this.row(account.id);
  }

  // Back to unmatched. Anything already carried over to the member stays; the
  // next sync removes Going RSVPs the sync made for them if no other linked
  // account of theirs is still Going.
  async unlink(accountId: number, actorId: number): Promise<FacebookAccountRow> {
    const account = await this.getAccount(accountId);
    const previousUserId = account.userId;
    account.userId = null;
    account.status = FacebookAccountStatus.UNMATCHED;
    account.linkedAt = null;
    account.linkedById = null;
    await this.accountRepo.save(account);
    await this.auditService.log({
      userId: actorId,
      action: 'facebook.account_unlink',
      entityType: 'user',
      entityId: previousUserId ?? undefined,
      metadata: { facebookAccountId: account.id, displayName: account.displayName },
    });
    return this.row(account.id);
  }

  async markNotMember(accountId: number, actorId: number): Promise<FacebookAccountRow> {
    const account = await this.getAccount(accountId);
    if (account.status === FacebookAccountStatus.LINKED) {
      throw new BadRequestException('Unlink this account from its member first');
    }
    account.status = FacebookAccountStatus.NOT_MEMBER;
    await this.accountRepo.save(account);
    await this.auditService.log({
      userId: actorId,
      action: 'facebook.account_not_member',
      metadata: { facebookAccountId: account.id, displayName: account.displayName },
    });
    return this.row(account.id);
  }

  private async carryOver(account: FacebookAccountEntity, userId: number): Promise<{ attendedCarried: number[]; goingCarried: number[] }> {
    const rows = await this.attendeeRepo.find({ where: { facebookAccountId: account.id } });
    if (rows.length === 0) return { attendedCarried: [], goingCarried: [] };
    const events = await this.eventRepo.find({ where: { id: In(rows.map((r) => r.eventId)) } });
    const eventById = new Map(events.map((e) => [e.id, e]));
    const attendedCarried: number[] = [];
    const goingCarried: number[] = [];

    for (const row of rows) {
      const event = eventById.get(row.eventId);
      if (!event) continue;

      if (row.attended) {
        // Make sure there's a Going RSVP to hang the attendance on, then use
        // the normal attendance path so points and achievements match.
        let rsvp = await this.rsvpRepo.findOne({ where: { eventId: event.id, userId } });
        if (!rsvp) {
          rsvp = this.rsvpRepo.create({
            eventId: event.id,
            userId,
            status: RsvpStatus.GOING,
            additionalGuests: facebookPlusOnes(row),
            source: RsvpSource.FACEBOOK_SYNC,
          });
        } else {
          rsvp.status = RsvpStatus.GOING;
        }
        await this.rsvpRepo.save(rsvp);
        await this.eventsService.markAttendance(event.id, [{ userId, attended: true }]);
        attendedCarried.push(event.id);
        continue;
      }

      if (isFacebookGoing(row) && event.status === EventStatus.PUBLISHED) {
        try {
          const rsvpable = await this.eventsService.getRsvpableEvent(event.id);
          const existing = await this.rsvpRepo.findOne({ where: { eventId: event.id, userId } });
          const plusOnes = facebookPlusOnes(row);
          if (!existing || existing.status !== RsvpStatus.GOING) {
            await this.eventsService.setGoingOnBehalf(rsvpable, userId, RsvpSource.FACEBOOK_SYNC, { additionalGuests: plusOnes });
            goingCarried.push(event.id);
          } else if (plusOnes > existing.additionalGuests) {
            existing.additionalGuests = plusOnes;
            await this.rsvpRepo.save(existing);
          }
        } catch (err) {
          // Past or no longer published — nothing to carry.
          this.logger.debug(`Skipped carrying event ${event.id}: ${(err as Error).message}`);
        }
      }
    }
    return { attendedCarried, goingCarried };
  }

  private async activeMembers(): Promise<UserEntity[]> {
    const users = await this.userRepo.find({
      where: { status: UserStatus.ACTIVE, isAutomationAccount: false },
      select: ['id', 'fullName', 'role'],
    });
    return users.filter((u) => !isHiddenRole(u.role));
  }

  private async getAccount(id: number): Promise<FacebookAccountEntity> {
    const account = await this.accountRepo.findOne({ where: { id } });
    if (!account) throw new NotFoundException('Facebook account not found');
    return account;
  }

  private async row(id: number): Promise<FacebookAccountRow> {
    return (await this.list()).find((r) => r.id === id)!;
  }
}

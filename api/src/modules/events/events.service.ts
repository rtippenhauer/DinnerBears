import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes, randomUUID } from 'crypto';
import { In, IsNull, Not, Repository } from 'typeorm';
import { EventEntity, EventStatus } from '../../database/entities/event.entity';
import { UserEntity, UserRole, UserStatus } from '../../database/entities/user.entity';
import { EventGuestLinkEntity } from '../../database/entities/event-guest-link.entity';
import { EventRsvpEntity, RsvpSource, RsvpStatus } from '../../database/entities/event-rsvp.entity';
import {
  FacebookEventAttendeeEntity,
  facebookGuestCount,
  facebookGuests,
  isFacebookGoing,
} from '../../database/entities/facebook-event-attendee.entity';
import { FacebookAccountStatus } from '../../database/entities/facebook-account.entity';
import { InviteEntity, InviteFlavor, InviteType } from '../../database/entities/invite.entity';
import { LocationEntity } from '../../database/entities/location.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { SetReservationDto } from './dto/set-reservation.dto';
import { EmailService } from '../email/email.service';
import { CalendarService } from '../calendar/calendar.service';
import { PointsService, SecretDinnerResync } from '../community/points.service';
import { AchievementsService } from '../community/achievements.service';
import { ConfigService } from '@nestjs/config';
import { isPastRsvpCutoff } from '../../common/utils/rsvp-cutoff.util';
import { toPublicUser } from '../../common/utils/public-user.util';
import { icsEscape, eventTimeToUtc, toIcsUtcString, foldIcsLine, EVENT_DURATION_MS } from '../../common/utils/ics.util';
import { LocationVisibilityService } from '../../common/services/location-visibility.service';
import { eventOrganizerEmail } from '../../common/config/instance-contact';
import { AppConfigService } from '../app-config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { easternToday } from '../../common/utils/event-location-snapshot.util';

export interface EventFilters {
  cityId?: number;
  upcoming?: boolean;
  fromDate?: string;
  status?: EventStatus;
  isAdminOrMod?: boolean;
  userId?: number;
  callerRole?: UserRole;
}

// Accounts that act on the site but aren't people — never RSVP'd, searched
// for, or matched by name.
export function isHiddenRole(role: UserRole): boolean {
  return role === UserRole.AUTOMATION || role === UserRole.MUSE;
}

// A Facebook-only attendee (Phase 39): someone Going on a synced Facebook
// event whose account isn't linked to a member.
export interface FacebookOnlyAttendee {
  id: number;
  facebookAccountId: number;
  name: string;
  plusOnes: number;
  // Named +1s from the Facebook comments; `plusOnes` also counts unnamed ones.
  plusOneNames: string[];
  attended: boolean | null;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @InjectRepository(EventEntity)
    private readonly eventRepo: Repository<EventEntity>,
    @InjectRepository(EventRsvpEntity)
    private readonly rsvpRepo: Repository<EventRsvpEntity>,
    @InjectRepository(EventGuestLinkEntity)
    private readonly guestLinkRepo: Repository<EventGuestLinkEntity>,
    @InjectRepository(LocationEntity)
    private readonly locationRepo: Repository<LocationEntity>,
    @InjectRepository(InviteEntity)
    private readonly inviteRepo: Repository<InviteEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(FacebookEventAttendeeEntity)
    private readonly facebookAttendeeRepo: Repository<FacebookEventAttendeeEntity>,
    private readonly emailService: EmailService,
    private readonly calendarService: CalendarService,
    private readonly pointsService: PointsService,
    private readonly achievementsService: AchievementsService,
    private readonly config: ConfigService,
    private readonly locationVisibility: LocationVisibilityService,
    private readonly appConfig: AppConfigService,
    private readonly auditService: AuditService,
  ) {}

  // Per-instance branding for transactional emails / calendar files. Reads the
  // same configurable rows the UI uses (Phase 32) so a fork's emails carry its
  // own name/tagline/event term instead of hardcoded "DinnerBears". The event
  // term (`term_dinner_*`) is title-case in config (DinnerBears pins "Dinner");
  // lowercase variants are provided for mid-sentence use.
  private async getEmailBrand(): Promise<{
    brandName: string;
    tagline: string;
    eventSingular: string;
    eventPlural: string;
    eventSingularLower: string;
    eventPluralLower: string;
    logoUrl: string;
  }> {
    const [brandName, tagline, eventSingular, eventPlural, brandLogoUrl] = await Promise.all([
      this.appConfig.getSiteSetting('brand_name'),
      this.appConfig.getSiteSetting('brand_tagline'),
      this.appConfig.getSiteSetting('term_dinner_singular'),
      this.appConfig.getSiteSetting('term_dinner_plural'),
      this.appConfig.getSiteSetting('brand_logo_url'),
    ]);
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    // brand_logo_url is already an absolute path (/api/uploads/branding/<file>)
    // once an admin uploads one; empty means no override, so fall back to the
    // same compiled-in default asset the frontend's BrandConfigService.logoSrc
    // falls back to when nothing's been uploaded.
    const logoUrl = `${appUrl}${brandLogoUrl || '/assets/logo.png'}`;
    return {
      brandName,
      tagline,
      eventSingular,
      eventPlural,
      eventSingularLower: eventSingular.toLowerCase(),
      eventPluralLower: eventPlural.toLowerCase(),
      logoUrl,
    };
  }

  async findAll(filters: EventFilters): Promise<(EventEntity & { goingCount: number; totalAttending: number; attendeeSnippet: { fullName: string; profilePhotoPath: string | null }[]; myRsvpStatus: string | null })[]> {
    const qb = this.eventRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.city', 'city')
      .leftJoinAndSelect('e.location', 'location')
      .leftJoinAndSelect('location.photos', 'photos')
      .leftJoinAndSelect('e.createdByUser', 'createdByUser');

    if (filters.cityId) {
      qb.andWhere('e.cityId = :cityId', { cityId: filters.cityId });
    }

    if (filters.status) {
      qb.andWhere('e.status = :status', { status: filters.status });
    } else if (!filters.isAdminOrMod) {
      qb.andWhere('e.status != :draft', { draft: EventStatus.DRAFT });
    }

    if (filters.fromDate) {
      qb.andWhere('e.eventDate >= :fromDate', { fromDate: filters.fromDate }).orderBy('e.eventDate', 'ASC').addOrderBy('e.eventTime', 'ASC');
    } else {
      const todayParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date());
      const get = (t: string) => todayParts.find((p) => p.type === t)?.value ?? '0';
      const today = `${get('year')}-${get('month')}-${get('day')}`;
      if (filters.upcoming === true) {
        qb.andWhere('e.eventDate >= :today', { today }).orderBy('e.eventDate', 'ASC').addOrderBy('e.eventTime', 'ASC');
      } else if (filters.upcoming === false) {
        qb.andWhere('e.eventDate < :today', { today }).orderBy('e.eventDate', 'DESC').addOrderBy('e.eventTime', 'DESC');
      } else {
        qb.orderBy('e.eventDate', 'DESC').addOrderBy('e.eventTime', 'DESC');
      }
    }
    // Without an explicit order, MySQL can return the photos join in a
    // different order than other queries (e.g. findOne), and every caller
    // treats photos[0] as "the cover photo" — so an unordered join makes the
    // same location show a different card image on different pages. Must be
    // added after the .orderBy() calls above, since .orderBy() resets prior
    // ordering (unlike .addOrderBy()).
    qb.addOrderBy('photos.id', 'ASC');

    const events = await qb.getMany();
    if (events.length === 0) {
      return events as (EventEntity & { goingCount: number; totalAttending: number; attendeeSnippet: { fullName: string; profilePhotoPath: string | null }[]; myRsvpStatus: string | null })[];
    }

    const ids = events.map((e) => e.id);

    // One query: all going+maybe RSVPs with user names for counts and avatar snippet
    const rsvpRows = await this.rsvpRepo
      .createQueryBuilder('r')
      .leftJoin('r.user', 'u')
      .select('r.eventId', 'eventId')
      .addSelect('r.status', 'status')
      .addSelect('r.additionalGuests', 'additionalGuests')
      .addSelect('r.facebookGuestCount', 'facebookGuestCount')
      .addSelect('u.fullName', 'fullName')
      .addSelect('u.profilePhotoPath', 'profilePhotoPath')
      .where('r.eventId IN (:...ids)', { ids })
      .andWhere('r.status IN (:...statuses)', { statuses: [RsvpStatus.GOING, RsvpStatus.MAYBE] })
      .orderBy('r.status', 'ASC')   // 'going' < 'maybe' — going first
      .addOrderBy('r.createdAt', 'ASC')
      .getRawMany<{ eventId: string; status: string; additionalGuests: string; facebookGuestCount: string; fullName: string; profilePhotoPath: string | null }>();

    const goingCountMap = new Map<number, number>();
    const totalMap = new Map<number, number>();
    const snippetMap = new Map<number, { fullName: string; profilePhotoPath: string | null }[]>();

    for (const row of rsvpRows) {
      const eid = Number(row.eventId);
      const guests = (Number(row.additionalGuests) || 0) + (Number(row.facebookGuestCount) || 0);
      const seats = row.status === RsvpStatus.GOING ? 1 + guests : 1;

      if (row.status === RsvpStatus.GOING) {
        goingCountMap.set(eid, (goingCountMap.get(eid) ?? 0) + seats);
      }
      totalMap.set(eid, (totalMap.get(eid) ?? 0) + seats);

      const snippet = snippetMap.get(eid) ?? [];
      if (snippet.length < 3) {
        snippet.push({ fullName: row.fullName, profilePhotoPath: row.profilePhotoPath });
        snippetMap.set(eid, snippet);
      }
    }

    // Facebook-only attendees (Phase 39) count as Going, with their +1s.
    const facebookOnly = await this.getFacebookOnlyAttendees(ids);
    for (const [eid, people] of facebookOnly) {
      const seats = people.reduce((sum, p) => sum + 1 + p.plusOnes, 0);
      goingCountMap.set(eid, (goingCountMap.get(eid) ?? 0) + seats);
      totalMap.set(eid, (totalMap.get(eid) ?? 0) + seats);
    }

    // Current user's RSVP status per event
    let myRsvpMap = new Map<number, string>();
    if (filters.userId) {
      const myRows = await this.rsvpRepo
        .createQueryBuilder('r')
        .select('r.eventId', 'eventId')
        .addSelect('r.status', 'status')
        .where('r.eventId IN (:...ids)', { ids })
        .andWhere('r.userId = :userId', { userId: filters.userId })
        .getRawMany<{ eventId: string; status: string }>();
      myRsvpMap = new Map(myRows.map((r) => [Number(r.eventId), r.status]));
    }

    const isValidatedMember =
      filters.callerRole != null &&
      filters.callerRole !== UserRole.NON_VALIDATED;
    const isPrivileged = filters.callerRole === UserRole.ADMIN || filters.callerRole === UserRole.MODERATOR;

    return events.map((e) => {
      (e as any).createdByUser = toPublicUser(e.createdByUser);
      delete (e as any).reservationConfirmToken;
      if (!isValidatedMember) {
        (e as any).reservationAssignee = null;
        (e as any).reservationAssigneeId = null;
        (e as any).reservationContactName = null;
        (e as any).reservationContactEmail = null;
        (e as any).reservationConfirmedBy = null;
        (e as any).reservationConfirmedNote = null;
      } else {
        (e as any).reservationAssignee = toPublicUser(e.reservationAssignee);
        if (!isPrivileged) (e as any).reservationContactEmail = null;
      }

      const hasGoingRsvp = myRsvpMap.get(e.id) === RsvpStatus.GOING;
      if (e.location && !this.locationVisibility.canViewAddressSync(e.location, isPrivileged, hasGoingRsvp)) {
        e.locationAddress = null as unknown as string;
        e.locationLat = null;
        e.locationLng = null;
        (e.location as any).address = null;
        (e.location as any).lat = null;
        (e.location as any).lng = null;
        // Withhold photos too — a private venue's picture can reveal it.
        (e.location as any).photos = [];
      }

      return Object.assign(e, {
        goingCount: goingCountMap.get(e.id) ?? 0,
        totalAttending: totalMap.get(e.id) ?? 0,
        attendeeSnippet: isValidatedMember ? (snippetMap.get(e.id) ?? []) : [],
        myRsvpStatus: myRsvpMap.get(e.id) ?? null,
      });
    });
  }

  async findOne(id: number, callerRole?: UserRole, callerId?: number): Promise<EventEntity & {
    publicRsvps: Pick<EventGuestLinkEntity, 'id' | 'recipientName' | 'cancelledAt'>[];
    facebookAttendees: { id: number; name: string | null; plusOnes: number; plusOneNames: string[] }[];
  }> {
    const event = await this.eventRepo.findOne({
      where: { id },
      relations: [
        'city',
        'location',
        'location.photos',
        'createdByUser',
        'rsvps',
        'rsvps.user',
        'rsvps.guestLinks',
        'reservationAssignee',
      ],
      // Keep photos[0] ("the cover photo") consistent with findAll's ordering.
      order: { location: { photos: { id: 'ASC' } } },
    });
    if (!event) throw new NotFoundException(`Event ${id} not found`);

    const isValidatedMember = callerRole != null && callerRole !== UserRole.NON_VALIDATED;
    const isPrivileged = callerRole === UserRole.ADMIN || callerRole === UserRole.MODERATOR;

    const hasGoingRsvp =
      callerId != null &&
      (event.rsvps?.some((r) => r.userId === callerId && r.status === RsvpStatus.GOING) ?? false);
    if (event.location && !this.locationVisibility.canViewAddressSync(event.location, isPrivileged, hasGoingRsvp)) {
      event.locationAddress = null as unknown as string;
      event.locationLat = null;
      event.locationLng = null;
      (event.location as any).address = null;
      (event.location as any).lat = null;
      (event.location as any).lng = null;
      // A private venue's photos can reveal the address too (Street View, a
      // house shot) — withhold them until the viewer earns visibility. Emptied
      // server-side so the image URLs never reach the client.
      (event.location as any).photos = [];
    }

    // Unauthenticated/non-validated callers don't get to know member identities
    // at all; validated members can see who's going (name/photo) but never the
    // other attendee's raw account (password hash, calendar token, etc.).
    if (event.rsvps) {
      for (const rsvp of event.rsvps) {
        (rsvp as any).user = isValidatedMember ? toPublicUser(rsvp.user) : null;
      }
    }

    // Never expose the raw createdByUser/reservationAssignee entities (password
    // hash, calendar token, email, etc.) — reduce to safe display fields.
    (event as any).createdByUser = toPublicUser(event.createdByUser);
    (event as any).reservationAssignee = toPublicUser(event.reservationAssignee);

    // The confirm token is only used in the email confirm-link flow and should
    // never appear in a general read.
    delete (event as any).reservationConfirmToken;

    // The whole Reservation Coordinator panel is a members-only feature —
    // unauthenticated and non-validated (guest) callers get none of it, not
    // just the contact email.
    if (!isValidatedMember) {
      (event as any).reservationAssignee = null;
      (event as any).reservationAssigneeId = null;
      (event as any).reservationContactName = null;
      (event as any).reservationContactEmail = null;
      (event as any).reservationConfirmedBy = null;
      (event as any).reservationConfirmedNote = null;
    } else if (!isPrivileged) {
      // Validated members can see who's coordinating, but the contact email
      // is only for admins/moderators managing the reservation.
      (event as any).reservationContactEmail = null;
    }

    const publicRsvps = await this.guestLinkRepo.find({
      where: { eventId: id, source: 'public', cancelledAt: IsNull() },
      select: ['id', 'recipientName', 'cancelledAt'],
      order: { createdAt: 'ASC' },
    });

    // Facebook-only attendees (Phase 39). Names follow the same rule as member
    // RSVPs: validated members see who's going, others only the count.
    const facebookAttendees = ((await this.getFacebookOnlyAttendees([id])).get(id) ?? []).map((a) => ({
      id: a.id,
      name: isValidatedMember ? a.name : null,
      plusOnes: a.plusOnes,
      plusOneNames: isValidatedMember ? a.plusOneNames : [],
    }));

    return Object.assign(event, { publicRsvps, facebookAttendees });
  }

  async create(dto: CreateEventDto, userId: number): Promise<EventEntity> {
    const location = await this.locationRepo.findOne({
      where: { id: dto.locationId },
      relations: ['city'],
    });
    if (!location) throw new NotFoundException(`Restaurant ${dto.locationId} not found`);

    const event = this.eventRepo.create({
      cityId: dto.cityId,
      locationId: location.id,
      locationName: location.name,
      locationAddress: location.address,
      locationLat: location.lat,
      locationLng: location.lng,
      title: dto.title,
      description: dto.description ?? null,
      additionalInfo: dto.additionalInfo ?? null,
      eventDate: dto.eventDate,
      eventTime: dto.eventTime,
      status: dto.status ?? EventStatus.DRAFT,
      isSecret: dto.isSecret ?? false,
      createdById: userId,
    });

    if (event.status === EventStatus.PUBLISHED) {
      event.publishedAt = new Date();
    }

    return this.eventRepo.save(event);
  }

  async update(id: number, dto: UpdateEventDto, callerRole?: UserRole): Promise<EventEntity & { secretDinnerResync?: SecretDinnerResync }> {
    const event = await this.findOne(id, callerRole);

    const isRestoring = event.status === EventStatus.CANCELLED && dto.status === EventStatus.DRAFT;
    if (event.status === EventStatus.CANCELLED && !isRestoring) {
      throw new BadRequestException('Cannot edit a cancelled event');
    }

    const wasPublished = event.status === EventStatus.PUBLISHED;
    const wasSecret = event.isSecret;

    // Track meaningful changes for update-notification email
    const changedDate = dto.eventDate !== undefined && dto.eventDate !== event.eventDate;
    const changedTime = dto.eventTime !== undefined && dto.eventTime !== event.eventTime.substring(0, 5);
    const changedLocation = dto.locationId !== undefined && dto.locationId !== event.locationId;

    if (dto.cityId !== undefined) event.cityId = dto.cityId;

    if (dto.locationId && dto.locationId !== event.locationId) {
      const location = await this.locationRepo.findOne({
        where: { id: dto.locationId },
      });
      if (!location) throw new NotFoundException(`Restaurant ${dto.locationId} not found`);
      // Must set the relation object so TypeORM uses the new FK on save,
      // not the old relation it loaded from findOne
      event.location = location;
      event.locationId = location.id;
      event.locationName = location.name;
      event.locationAddress = location.address;
      event.locationLat = location.lat;
      event.locationLng = location.lng;
    } else if (event.locationId && (dto.eventDate ?? event.eventDate) >= easternToday()) {
      // Same location: still re-copy its current name/address, so a location
      // fixed after the event was created is picked up by saving the event.
      // Past events keep the details they had at the time.
      const location = await this.locationRepo.findOne({ where: { id: event.locationId } });
      if (location) {
        event.locationName = location.name;
        event.locationAddress = location.address;
        event.locationLat = location.lat;
        event.locationLng = location.lng;
      }
    }

    if (dto.title !== undefined) event.title = dto.title;
    if ('description' in dto) event.description = dto.description ?? null;
    if ('additionalInfo' in dto) event.additionalInfo = dto.additionalInfo ?? null;
    if ('facebookShareText' in dto) event.facebookShareText = dto.facebookShareText ?? null;
    if (dto.isSecret !== undefined) event.isSecret = dto.isSecret;
    if (dto.eventDate !== undefined) event.eventDate = dto.eventDate;
    if (dto.eventTime !== undefined) event.eventTime = dto.eventTime;

    if (dto.status !== undefined && dto.status !== event.status) {
      if (dto.status === EventStatus.PUBLISHED && !wasPublished) {
        event.publishedAt = new Date();
        void this.calendarService.invalidateAll();
      }
      if (dto.status === EventStatus.CANCELLED) {
        event.cancelledAt = new Date();
        event.cancelledReason = dto.cancelledReason ?? null;
      }
      event.status = dto.status;
    }

    await this.eventRepo.save(event);

    // Reload with fresh relations so the response reflects any location/city change
    const saved = await this.findOne(event.id, callerRole);

    if (saved.status === EventStatus.CANCELLED && wasPublished) {
      void this.sendCancellationEmails(saved);
      void this.calendarService.invalidateAll();
    } else if (wasPublished && saved.status === EventStatus.PUBLISHED && (changedDate || changedTime || changedLocation)) {
      void this.sendUpdateEmails(saved);
      void this.calendarService.invalidateAll();
    } else if (!wasPublished && saved.status === EventStatus.PUBLISHED) {
      void this.sendPublishInvites(saved);
    }

    let secretDinnerResync: SecretDinnerResync | undefined;
    if (dto.isSecret !== undefined && dto.isSecret !== wasSecret) {
      secretDinnerResync = await this.pointsService.resyncSecretDinnerForEvent(event.id, dto.isSecret);
    }

    return { ...saved, secretDinnerResync };
  }

  private async sendCancellationEmails(event: EventEntity): Promise<void> {
    const { brandName, tagline, eventSingularLower, logoUrl } = await this.getEmailBrand();
    const [ey, em, ed] = event.eventDate.split('-').map(Number);
    const [eh, emin] = event.eventTime.split(':').map(Number);
    const dateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const timeDisplay = this.formatEventTimeDisplay(eh, emin);

    const reasonBlock = event.cancelledReason
      ? `<p style="margin:16px 0 0;padding:12px 16px;background:#fff3e0;border-left:3px solid #e65100;border-radius:4px;font-size:0.9rem;color:#444">${event.cancelledReason}</p>`
      : '';

    const buildHtml = (recipientName: string) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EDD8;font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(61,28,5,0.12)">
  <tr><td style="background:#3D1C05;padding:20px;text-align:center">
    <img src="${logoUrl}" alt="${brandName}" height="100" style="display:inline-block;height:100px" />
  </td></tr>
  <tr><td style="padding:32px 36px 24px">
    <p style="margin:0 0 8px;font-size:0.95rem;color:#666">Hi ${recipientName},</p>
    <h1 style="margin:0 0 20px;font-size:1.4rem;font-weight:700;color:#c62828;line-height:1.2">This event has been cancelled</h1>
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:20px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span><strong>${event.title}</strong>
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span>${dateDisplay} at ${timeDisplay}
      </td></tr>
      <tr><td style="padding:10px 16px;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span>${event.locationName}
      </td></tr>
    </table>
    ${reasonBlock}
    <p style="margin:20px 0 0;font-size:0.88rem;color:#888">We hope to see you at the next ${brandName} ${eventSingularLower}!</p>
  </td></tr>
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">${brandName} — ${tagline}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    // Members who RSVPd
    const rsvps = await this.rsvpRepo.find({
      where: { eventId: event.id },
      relations: ['user'],
    });
    for (const rsvp of rsvps) {
      if (!rsvp.user?.email) continue;
      await this.emailService.queue({
        toEmail: rsvp.user.email,
        toName: rsvp.user.fullName,
        subject: `Cancelled: ${event.title}`,
        htmlBody: buildHtml(rsvp.user.fullName),
      });
    }

    // Guest link holders (member-invited + public RSVPs) with an email who haven't already cancelled
    const guestLinks = await this.guestLinkRepo.find({
      where: { eventId: event.id, cancelledAt: IsNull() },
    });
    for (const link of guestLinks) {
      if (!link.recipientEmail) continue;
      const name = link.recipientName ?? link.recipientEmail;
      await this.emailService.queue({
        toEmail: link.recipientEmail,
        toName: name,
        subject: `Cancelled: ${event.title}`,
        htmlBody: buildHtml(name),
      });
    }
  }

  private async sendUpdateEmails(event: EventEntity): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, tagline, logoUrl } = await this.getEmailBrand();
    const [ey, em, ed] = event.eventDate.split('-').map(Number);
    const [eh, emin] = event.eventTime.split(':').map(Number);
    const dateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const timeDisplay = this.formatEventTimeDisplay(eh, emin);
    const eventUrl = `${appUrl}/events/${event.id}`;

    const buildHtml = (recipientName: string, showAddress: boolean) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EDD8;font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(61,28,5,0.12)">
  <tr><td style="background:#3D1C05;padding:20px;text-align:center">
    <img src="${logoUrl}" alt="${brandName}" height="100" style="display:inline-block;height:100px" />
  </td></tr>
  <tr><td style="padding:32px 36px 24px">
    <p style="margin:0 0 8px;font-size:0.95rem;color:#666">Hi ${recipientName},</p>
    <h1 style="margin:0 0 20px;font-size:1.4rem;font-weight:700;color:#3D1C05;line-height:1.2">Event details have been updated</h1>
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:24px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span><strong>${event.title}</strong>
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span>${dateDisplay} at ${timeDisplay}
      </td></tr>
      <tr><td style="padding:10px 16px;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📍</span>${event.locationName}${showAddress && event.locationAddress ? ` — ${event.locationAddress}` : ''}
      </td></tr>
    </table>
    <p style="text-align:center;margin:0 0 24px">
      <a href="${eventUrl}" style="background:#3D1C05;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.95rem;display:inline-block">View Updated Event</a>
    </p>
    <p style="margin:0;font-size:0.85rem;color:#888">If you can no longer attend, you can update your RSVP on the event page.</p>
  </td></tr>
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">${brandName} — ${tagline}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    const rsvps = await this.rsvpRepo.find({
      where: { eventId: event.id },
      relations: ['user'],
    });
    for (const rsvp of rsvps) {
      if (!rsvp.user?.email) continue;
      const showAddress = this.locationVisibility.canViewAddressSync(
        event.location ?? { id: -1, isPrivate: false },
        this.locationVisibility.isAdminOrMod(rsvp.user),
        rsvp.status === RsvpStatus.GOING,
      );
      await this.emailService.queue({
        toEmail: rsvp.user.email,
        toName: rsvp.user.fullName,
        subject: `Updated: ${event.title}`,
        htmlBody: buildHtml(rsvp.user.fullName, showAddress),
      });
    }

    const guestLinks = await this.guestLinkRepo.find({
      where: { eventId: event.id, cancelledAt: IsNull() },
      relations: ['memberRsvp'],
    });
    for (const link of guestLinks) {
      if (!link.recipientEmail) continue;
      const name = link.recipientName ?? link.recipientEmail;
      // A public/self-service guest RSVP is itself a confirmed "Going" —
      // a member-invited guest link inherits the inviting member's status.
      const showAddress =
        link.source === 'public' ||
        this.locationVisibility.canViewAddressSync(
          event.location ?? { id: -1, isPrivate: false },
          false,
          link.memberRsvp?.status === RsvpStatus.GOING,
        );
      await this.emailService.queue({
        toEmail: link.recipientEmail,
        toName: name,
        subject: `Updated: ${event.title}`,
        htmlBody: buildHtml(name, showAddress),
      });
    }
  }

  async remove(id: number): Promise<void> {
    const event = await this.findOne(id);
    if (event.status === EventStatus.PUBLISHED) {
      throw new BadRequestException('Cannot delete a published event — cancel it first');
    }
    await this.eventRepo.remove(event);
  }

  // Published and not yet in the past (Eastern calendar date) — the baseline
  // for any RSVP change, whether the member's own or made on their behalf.
  async getRsvpableEvent(eventId: number): Promise<EventEntity> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('Can only RSVP to published events');
    }

    // Block RSVPs to events that have already passed
    const nowParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const getPart = (type: string) => nowParts.find((p) => p.type === type)?.value ?? '0';
    const todayEastern = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
    if (event.eventDate < todayEastern) {
      throw new BadRequestException('Cannot RSVP to a past event');
    }
    return event;
  }

  async upsertRsvp(
    eventId: number,
    userId: number,
    status: RsvpStatus,
    additionalGuests: number,
    guestNames?: string[],
    bringingItem?: string,
    userRole?: UserRole,
  ): Promise<EventRsvpEntity> {
    const event = await this.getRsvpableEvent(eventId);

    const existing = await this.rsvpRepo.findOne({ where: { eventId, userId } });

    const isPastCutoff = isPastRsvpCutoff(event.eventDate, event.eventTime);
    const isPrivileged = userRole === UserRole.ADMIN || userRole === UserRole.MODERATOR;

    // Block upgrading to GOING after cutoff — applies to new RSVPs and existing non-Going RSVPs
    if (status === RsvpStatus.GOING &&
        existing?.status !== RsvpStatus.GOING &&
        isPastCutoff && !isPrivileged) {
      throw new ForbiddenException('RSVP is closed — the deadline has passed');
    }

    // Block increasing guest count after cutoff — already-Going users can decrease but not add
    if (status === RsvpStatus.GOING &&
        existing?.status === RsvpStatus.GOING &&
        additionalGuests > existing.additionalGuests &&
        isPastCutoff && !isPrivileged) {
      throw new ForbiddenException('RSVP is closed — cannot increase guest count after the deadline');
    }

    // Membership fee (Phase 35): once a member has attended at least one event
    // (their free first meeting), a Going RSVP requires an active, non-expired
    // membership. Maybe is never blocked — only a Going RSVP unlocks address/
    // location visibility, so gating Maybe wouldn't serve the fee's purpose.
    if (status === RsvpStatus.GOING && !isPrivileged) {
      const requireMembership = await this.appConfig.isFeatureEnabled('feature_require_membership');
      if (requireMembership) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        const hasActiveMembership = !!user?.hasMembership &&
          !!user.membershipExpiresAt &&
          user.membershipExpiresAt > new Date();
        if (!hasActiveMembership) {
          const hasAttendedBefore = await this.rsvpRepo.exists({ where: { userId, attended: true } });
          if (hasAttendedBefore) {
            throw new ForbiddenException(
              'An active membership is required to RSVP — your first meeting is free, but this one needs a membership. Contact an admin.',
            );
          }
        }
      }
    }

    // A member touching their own RSVP takes ownership of it — from then on
    // the Facebook sync never removes it (Phase 39).
    let saved: EventRsvpEntity;
    if (existing) {
      existing.status = status;
      existing.source = RsvpSource.MEMBER;
      existing.additionalGuests = additionalGuests;
      if (guestNames !== undefined) {
        existing.guestNames = guestNames.length > 0 ? guestNames : null;
      }
      if (bringingItem !== undefined) {
        existing.bringingItem = bringingItem.trim() || null;
      }
      saved = await this.rsvpRepo.save(existing);
    } else {
      saved = await this.rsvpRepo.save(
        this.rsvpRepo.create({
          eventId,
          userId,
          status,
          additionalGuests,
          guestNames: guestNames && guestNames.length > 0 ? guestNames : null,
          bringingItem: bringingItem?.trim() || null,
          source: RsvpSource.MEMBER,
        }),
      );
    }

    this.calendarService.invalidateForUser(userId);

    // Send .ics confirmation when a member newly commits to Going
    const wasGoingBefore = existing?.status === RsvpStatus.GOING;
    if (status === RsvpStatus.GOING && !wasGoingBefore) {
      void this.sendRsvpConfirmation(event, userId);
    }

    return saved;
  }

  // Marks someone Going on their behalf (Phase 39) — an admin's "Add to Going"
  // or the Facebook sync. Deliberately skips the member-facing gates (RSVP
  // cutoff, membership fee): the organizer is vouching for them. Callers must
  // have already checked the event with getRsvpableEvent(). Sends the normal
  // confirmation, annotated with who added them, when they're newly Going.
  async setGoingOnBehalf(
    event: EventEntity,
    userId: number,
    source: RsvpSource.ADMIN | RsvpSource.FACEBOOK_SYNC,
    changes: { additionalGuests: number; guestNames?: string[] | null },
  ): Promise<{ rsvp: EventRsvpEntity; before: { status: RsvpStatus; additionalGuests: number } | null }> {
    const existing = await this.rsvpRepo.findOne({ where: { eventId: event.id, userId } });
    const before = existing ? { status: existing.status, additionalGuests: existing.additionalGuests } : null;
    const wasGoing = existing?.status === RsvpStatus.GOING;

    const rsvp = existing ?? this.rsvpRepo.create({ eventId: event.id, userId });
    rsvp.status = RsvpStatus.GOING;
    rsvp.additionalGuests = Math.min(255, Math.max(0, changes.additionalGuests));
    if (changes.guestNames !== undefined) {
      rsvp.guestNames = changes.guestNames && changes.guestNames.length > 0 ? changes.guestNames : null;
    }
    // Someone already Going keeps whoever owned the RSVP; only a new Going
    // (or an upgrade from Maybe/Not Going) belongs to the adder.
    if (!wasGoing) rsvp.source = source;

    const saved = await this.rsvpRepo.save(rsvp);
    this.calendarService.invalidateForUser(userId);
    if (!wasGoing) void this.sendRsvpConfirmation(event, userId, source);
    return { rsvp: saved, before };
  }

  async addGoingByAdmin(
    eventId: number,
    userId: number,
    additionalGuests: number,
    actorId: number,
  ): Promise<{
    type: 'member';
    userId: number;
    memberName: string;
    attended: boolean | null;
    isWalkin: boolean;
    fromOtherCity: boolean;
    linkUsed: boolean;
    source: RsvpSource;
  }> {
    const event = await this.getRsvpableEvent(eventId);
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || user.status !== UserStatus.ACTIVE || isHiddenRole(user.role)) {
      throw new NotFoundException('Member not found');
    }

    const { rsvp, before } = await this.setGoingOnBehalf(event, userId, RsvpSource.ADMIN, { additionalGuests });
    await this.auditService.log({
      userId: actorId,
      action: 'rsvp.admin_add_going',
      entityType: 'event',
      entityId: eventId,
      metadata: {
        targetUserId: userId,
        before,
        after: { status: rsvp.status, additionalGuests: rsvp.additionalGuests },
      },
    });

    return {
      type: 'member' as const,
      userId,
      memberName: user.fullName,
      attended: rsvp.attended == null ? null : !!rsvp.attended,
      isWalkin: !!rsvp.isWalkin,
      fromOtherCity: !!rsvp.fromOtherCity,
      linkUsed: false,
      source: rsvp.source,
    };
  }

  // Muse's read of an event's signups (Phase 39): every member RSVP in any
  // status — with +1s and who created it — plus public guest signups.
  async getAttendeeList(eventId: number): Promise<{
    eventId: number;
    members: {
      userId: number;
      fullName: string;
      status: RsvpStatus;
      additionalGuests: number;
      guestNames: string[];
      // Their +1s from the Facebook comments, beside the website guests
      // above (null = unnamed).
      facebookGuests: (string | null)[];
      source: RsvpSource;
      attended: boolean | null;
      isWalkin: boolean;
      updatedAt: Date;
    }[];
    publicGuests: { guestLinkId: number; name: string | null; attended: boolean | null; createdAt: Date }[];
    facebookOnly: { facebookAccountId: number; name: string; plusOnes: number; plusOneNames: string[]; attended: boolean | null }[];
    totalGoing: number;
  }> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);

    const [rsvps, publicLinks] = await Promise.all([
      this.rsvpRepo.find({ where: { eventId }, relations: ['user'], order: { createdAt: 'ASC' } }),
      this.guestLinkRepo.find({
        where: { eventId, source: 'public', cancelledAt: IsNull() },
        order: { createdAt: 'ASC' },
      }),
    ]);

    return {
      eventId,
      members: rsvps.map((r) => ({
        userId: r.userId,
        fullName: r.user?.fullName ?? 'Member',
        status: r.status,
        additionalGuests: Number(r.additionalGuests) || 0,
        guestNames: r.guestNames ?? [],
        facebookGuests: r.facebookGuestNames ?? [],
        source: r.source,
        // tinyint columns come back as 0/1 — normalize before they leave the API
        attended: r.attended === null ? null : !!r.attended,
        isWalkin: !!r.isWalkin,
        updatedAt: r.updatedAt,
      })),
      publicGuests: publicLinks.map((l) => ({
        guestLinkId: l.id,
        name: l.recipientName ?? null,
        attended: l.attended === null ? null : !!l.attended,
        createdAt: l.createdAt,
      })),
      facebookOnly: ((await this.getFacebookOnlyAttendees([eventId])).get(eventId) ?? []).map((a) => ({
        facebookAccountId: a.facebookAccountId,
        name: a.name,
        plusOnes: a.plusOnes,
        plusOneNames: a.plusOneNames,
        attended: a.attended,
      })),
      totalGoing: await this.getHeadcount(eventId),
    };
  }

  private async sendPublishInvites(event: EventEntity): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, tagline, eventSingularLower, logoUrl } = await this.getEmailBrand();
    // Every recipient here is, by construction, someone who hasn't RSVP'd yet
    // (see the rsvpedIds filter below) — so for a private location, none of
    // them have earned address visibility regardless of role.
    const addressVisible = !event.location?.isPrivate;
    const locationAddress = addressVisible ? event.locationAddress : null;

    const members = await this.userRepo
      .createQueryBuilder('u')
      .where('u.status IN (:...statuses)', { statuses: ['active', 'non_validated'] })
      .andWhere('u.email IS NOT NULL')
      .andWhere(
        `(u.calendarAutoInvite = 'all' OR (u.calendarAutoInvite = 'city' AND u.cityId = :cityId))`,
        { cityId: event.cityId },
      )
      .getMany();

    if (members.length === 0) return;

    const existingRsvps = await this.rsvpRepo.find({ where: { eventId: event.id }, select: ['userId'] });
    const rsvpedIds = new Set(existingRsvps.map((r) => r.userId));

    const [ey, em, ed] = event.eventDate.split('-').map(Number);
    const [eh, emin] = event.eventTime.split(':').map(Number);
    const dateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
    const timeDisplay = this.formatEventTimeDisplay(eh, emin);
    const eventUrl = `${appUrl}/events/${event.id}`;

    for (const member of members) {
      if (!member.email || rsvpedIds.has(member.id)) continue;
      if (['bounced', 'complained'].includes(member.emailStatus as string)) continue;

      const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EDD8;font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(61,28,5,0.12)">
  <tr><td style="background:#3D1C05;padding:20px;text-align:center">
    <img src="${logoUrl}" alt="${brandName}" height="100" style="display:inline-block;height:100px" />
  </td></tr>
  <tr><td style="padding:32px 36px 24px">
    <p style="margin:0 0 8px;font-size:0.95rem;color:#666">Hi ${member.fullName},</p>
    <h1 style="margin:0 0 20px;font-size:1.4rem;font-weight:700;color:#3D1C05;line-height:1.2">You're invited to ${eventSingularLower}! 🐻</h1>
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:24px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span><strong>${event.locationName}</strong>
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span>${dateDisplay} at ${timeDisplay} ET
      </td></tr>
      ${locationAddress ? `<tr><td style="padding:10px 16px;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📍</span>${locationAddress}
      </td></tr>` : ''}
    </table>
    <p style="margin:0 0 24px;font-size:0.9rem;color:#555">Open the attached calendar invite to Accept, Maybe, or Decline — your RSVP will update automatically. Or tap the button below to RSVP on the ${brandName} site.</p>
    <p style="text-align:center;margin:0 0 24px">
      <a href="${eventUrl}" style="background:#3D1C05;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.95rem;display:inline-block">View &amp; RSVP</a>
    </p>
  </td></tr>
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">${brandName} — ${tagline}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

      const icsContent = await this.calendarService.buildInviteAttachment(
        event,
        { name: member.fullName, email: member.email },
        appUrl,
        locationAddress,
      );

      await this.emailService.sendNow({
        toEmail: member.email,
        toName: member.fullName,
        subject: `${brandName} ${eventSingularLower} at ${event.locationName} — ${dateDisplay}`,
        htmlBody: html,
        attachments: [{ content: icsContent, name: 'dinner-invite.ics', contentType: 'text/calendar; method=REQUEST' }],
      }).catch((err: unknown) => {
        this.logger.warn(`Publish invite failed for ${member.email}: ${(err as Error)?.message}`);
      });
    }
  }

  private async sendRsvpConfirmation(
    event: EventEntity,
    userId: number,
    source: RsvpSource = RsvpSource.MEMBER,
  ): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user?.email) return;

    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, tagline, eventSingularLower, logoUrl } = await this.getEmailBrand();
    const [ey, em, ed] = event.eventDate.split('-').map(Number);
    const [eh, emin] = event.eventTime.split(':').map(Number);
    const dateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
    const timeDisplay = this.formatEventTimeDisplay(eh, emin);
    const eventUrl = `${appUrl}/events/${event.id}`;

    // Someone else put them on the list — say who, so the email isn't a surprise.
    const addedByNote =
      source === RsvpSource.FACEBOOK_SYNC
        ? `We added you because you marked <strong>Going</strong> on the Facebook event — this RSVP was made by our Facebook sync, not by you on the website.`
        : source === RsvpSource.ADMIN
          ? `An organizer added you to the list for this ${eventSingularLower}.`
          : null;
    const addedByHtml = addedByNote
      ? `<p style="margin:0 0 20px;padding:12px 16px;background:#fff8e7;border:1px solid #f0dca8;border-radius:8px;font-size:0.88rem;color:#6B4226">${addedByNote} If that's not right, you can change your RSVP on the ${eventSingularLower} page.</p>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EDD8;font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(61,28,5,0.12)">
  <tr><td style="background:#3D1C05;padding:20px;text-align:center">
    <img src="${logoUrl}" alt="${brandName}" height="100" style="display:inline-block;height:100px" />
  </td></tr>
  <tr><td style="padding:32px 36px 24px">
    <p style="margin:0 0 8px;font-size:0.95rem;color:#666">Hi ${user.fullName},</p>
    <h1 style="margin:0 0 20px;font-size:1.4rem;font-weight:700;color:#3D1C05;line-height:1.2">You're going! 🎉</h1>
    ${addedByHtml}
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:24px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span><strong>${event.locationName}</strong>
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span>${dateDisplay} at ${timeDisplay} ET
      </td></tr>
      ${event.locationAddress ? `<tr><td style="padding:10px 16px;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📍</span>${event.locationAddress}
      </td></tr>` : ''}
    </table>
    <p style="margin:0 0 24px;font-size:0.9rem;color:#555">A calendar invite is attached — open it to add this ${eventSingularLower} to your calendar. You can Accept, Maybe, or Decline directly from the invite.</p>
    <p style="text-align:center;margin:0 0 24px">
      <a href="${eventUrl}" style="background:#3D1C05;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.95rem;display:inline-block">View Event</a>
    </p>
  </td></tr>
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">${brandName} — ${tagline}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    const icsContent = await this.calendarService.buildInviteAttachment(
      event,
      { name: user.fullName, email: user.email },
      appUrl,
    );

    await this.emailService.sendNow({
      toEmail: user.email,
      toName: user.fullName,
      subject: `You're going to ${brandName} at ${event.locationName}!`,
      htmlBody: html,
      attachments: [{ content: icsContent, name: 'dinner-invite.ics', contentType: 'text/calendar; method=REQUEST' }],
    }).catch((err: unknown) => {
      this.logger.warn(`RSVP confirmation email failed for user ${userId}: ${(err as Error)?.message}`);
    });
  }

  async removeRsvp(eventId: number, userId: number): Promise<void> {
    const rsvp = await this.rsvpRepo.findOne({ where: { eventId, userId } });
    if (rsvp) {
      await this.rsvpRepo.remove(rsvp);
      this.calendarService.invalidateForUser(userId);
    }
  }

  async getGuestLink(token: string) {
    const link = await this.guestLinkRepo.findOne({
      where: { token },
      relations: ['event', 'event.location', 'event.location.photos', 'createdBy'],
      // Keep photos[0] ("the cover photo") consistent with findAll/findOne's ordering.
      order: { event: { location: { photos: { id: 'ASC' } } } },
    });
    if (!link) throw new NotFoundException('Guest link not found');

    const event = link.event;
    const photoUrl = event.location?.photos?.[0]?.filePath ?? null;
    // A guest link is inherently pre-RSVP and unauthenticated, so a private
    // location's address is always withheld here.
    const addressVisible = this.locationVisibility.canViewAddressSync(
      event.location ?? { id: -1, isPrivate: false },
      false,
      false,
    );

    return {
      eventTitle: event.title,
      eventDate: event.eventDate,
      eventTime: event.eventTime,
      eventStatus: event.status,
      locationName: event.locationName,
      locationAddress: addressVisible ? event.locationAddress : null,
      locationLat: addressVisible ? event.locationLat : null,
      locationLng: addressVisible ? event.locationLng : null,
      locationPhotoUrl: photoUrl,
      invitedByName: link.createdBy?.fullName ?? (await this.appConfig.getSiteSetting('brand_name')),
      recipientName: link.recipientName,
      usedAt: link.usedAt,
      cancelledAt: link.cancelledAt,
      expiresAt: link.expiresAt,
    };
  }

  async removeGuestLink(linkId: number, userId: number): Promise<void> {
    const link = await this.guestLinkRepo.findOne({
      where: { id: linkId },
      relations: ['memberRsvp', 'memberRsvp.guestLinks'],
    });
    if (!link) throw new NotFoundException('Link not found');

    const rsvp = link.memberRsvp;
    if (!rsvp) throw new BadRequestException('Cannot remove a public guest RSVP this way');
    if (rsvp.userId !== userId) throw new ForbiddenException('Not your RSVP');

    // Find this link's position in the sorted array to know which name to drop
    const sorted = [...rsvp.guestLinks].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const idx = sorted.findIndex((l) => l.id === linkId);

    rsvp.additionalGuests = Math.max(0, rsvp.additionalGuests - 1);
    if (rsvp.guestNames && idx >= 0 && idx < rsvp.guestNames.length) {
      rsvp.guestNames.splice(idx, 1);
      if (rsvp.guestNames.length === 0) rsvp.guestNames = null;
    }

    await this.guestLinkRepo.remove(link);
    await this.rsvpRepo.save(rsvp);
  }

  async cancelGuestRsvp(token: string): Promise<void> {
    const link = await this.guestLinkRepo.findOne({ where: { token } });
    if (!link) throw new NotFoundException('Guest link not found');
    if (new Date() > link.expiresAt) throw new BadRequestException('This link has expired');
    link.cancelledAt = new Date();
    await this.guestLinkRepo.save(link);
  }

  async useGuestLink(token: string, guestName?: string): Promise<{ message: string }> {
    const link = await this.guestLinkRepo.findOne({ where: { token } });
    if (!link) throw new NotFoundException('Guest link not found');
    if (link.usedAt && !link.cancelledAt) throw new BadRequestException('This link has already been used');
    if (new Date() > link.expiresAt) throw new BadRequestException('This link has expired');

    link.usedAt = new Date();
    link.cancelledAt = null;
    if (guestName?.trim()) link.recipientName = guestName.trim();
    await this.guestLinkRepo.save(link);
    return { message: 'RSVP confirmed' };
  }

  private formatEventTimeDisplay(hour: number, minute: number): string {
    return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
  }

  // locationAddress override lets callers pass '' when the viewer/recipient
  // hasn't earned visibility into a private location's address — otherwise
  // this "Add to Calendar" link would leak it even when the email body itself
  // was correctly redacted.
  private buildGoogleCalendarUrl(event: EventEntity, locationAddress = event.locationAddress): string {
    const [y, m, d] = event.eventDate.split('-').map(Number);
    const [h, min] = event.eventTime.split(':').map(Number);
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`;
    const end = `${y}${pad(m)}${pad(d)}T${pad(h + 2)}${pad(min)}00`;
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const details: string[] = [`🍽️ ${event.locationName}`];
    if (event.description) details.push(event.description);
    if (event.additionalInfo) details.push(event.additionalInfo);
    details.push(`View event: ${appUrl}/events/${event.id}`);
    const p = new URLSearchParams({
      action: 'TEMPLATE', text: event.title,
      dates: `${start}/${end}`, location: locationAddress,
      details: details.join('\n\n'),
    });
    return `https://calendar.google.com/calendar/render?${p.toString()}`;
  }

  private buildGuestEmail(params: {
    appUrl: string;
    brandName: string;
    tagline: string;
    eventSingularLower: string;
    logoUrl: string;
    inviterName: string | null;
    subject: string;
    eventTitle: string;
    eventDateDisplay: string;
    eventTimeDisplay: string;
    locationName: string;
    locationAddress: string;
    locationLat: number | null;
    locationLng: number | null;
    photoUrl: string | null;
    description: string | null;
    additionalInfo: string | null;
    manageUrl: string;
    googleCalUrl: string;
    icsUrl: string;
  }): string {
    const {
      appUrl, brandName, tagline, eventSingularLower, logoUrl, inviterName, eventTitle, eventDateDisplay, eventTimeDisplay,
      locationName, locationAddress, locationLat, locationLng,
      photoUrl, description, additionalInfo, manageUrl, googleCalUrl, icsUrl,
    } = params;

    const mapsUrl = (locationLat && locationLng)
      ? `https://www.google.com/maps?q=${locationLat},${locationLng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationAddress)}`;

    const icsHost = appUrl.replace(/^https?:\/\//, '');
    const appleCalUrl = `webcal://${icsHost}${icsUrl.replace(appUrl, '')}`;

    const photoRow = photoUrl
      ? `<tr><td style="padding:0;line-height:0"><img src="${appUrl}${photoUrl}" alt="${locationName}" width="600" style="display:block;width:100%;max-height:260px;object-fit:cover" /></td></tr>`
      : '';

    const inviterRow = inviterName
      ? `<p style="margin:0 0 16px;font-size:1rem;color:#6B4226">🎉 <strong>${inviterName}</strong> invited you to ${eventSingularLower}!</p>`
      : `<p style="margin:0 0 16px;font-size:1rem;color:#6B4226">🎉 You're on the guest list for a ${brandName} ${eventSingularLower}!</p>`;

    const descriptionBlock = description
      ? `<p style="margin:16px 0 0;font-size:0.95rem;color:#444;line-height:1.6">${description}</p>`
      : '';

    const additionalInfoBlock = additionalInfo
      ? `<p style="margin:12px 0 0;font-size:0.88rem;color:#666;line-height:1.5;padding:10px 14px;background:#f5edd8;border-radius:6px">${additionalInfo}</p>`
      : '';

    const btn = (href: string, label: string, bg: string, fg: string) =>
      `<a href="${href}" style="display:inline-block;padding:8px 16px;background:${bg};color:${fg};text-decoration:none;border-radius:6px;font-size:0.8rem;font-weight:600;border:1px solid ${bg}">${label}</a>`;

    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EDD8;font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(61,28,5,0.12)">

  <!-- Header -->
  <tr><td style="background:#3D1C05;padding:20px;text-align:center">
    <img src="${logoUrl}" alt="${brandName}" height="100" style="display:inline-block;height:100px" />
  </td></tr>

  <!-- Hero photo -->
  ${photoRow}

  <!-- Content -->
  <tr><td style="padding:32px 36px 24px">
    ${inviterRow}
    <h1 style="margin:0 0 20px;font-size:1.5rem;font-weight:700;color:#3D1C05;line-height:1.2">${eventTitle}</h1>

    <!-- Details card -->
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:20px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span>
        <strong>${eventDateDisplay}</strong> at ${eventTimeDisplay}
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span>${locationName}
      </td></tr>
      <tr><td style="padding:10px 16px;font-size:0.9rem">
        <span style="color:#C9933A;margin-right:8px">📍</span>
        <a href="${mapsUrl}" style="color:#C9933A;text-decoration:none">${locationAddress}</a>
      </td></tr>
    </table>

    ${descriptionBlock}
    ${additionalInfoBlock}

    <!-- Manage RSVP button -->
    <div style="text-align:center;margin:28px 0 20px">
      <a href="${manageUrl}" style="display:inline-block;padding:14px 32px;background:#C9933A;color:#fff;text-decoration:none;border-radius:8px;font-size:1rem;font-weight:700">
        Manage Your RSVP
      </a>
    </div>

    <!-- Calendar -->
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-top:20px">
      <tr><td style="padding:14px 16px">
        <p style="margin:0 0 10px;font-size:0.8rem;font-weight:700;color:#3D1C05;text-transform:uppercase;letter-spacing:0.05em">Add to Calendar</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${btn(googleCalUrl, '📅 Google Calendar', '#fff', '#1a73e8')}
          &nbsp;
          ${btn(appleCalUrl, '🗓 Apple Calendar', '#fff', '#1d1d1f')}
          &nbsp;
          ${btn(`${appUrl}${icsUrl.replace(appUrl, '')}`, '⬇ Download .ics', '#fff', '#555')}
        </div>
      </td></tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0 0 6px;font-size:0.78rem;color:#999">${brandName} — ${tagline}</p>
    <p style="margin:0;font-size:0.72rem;color:#bbb">This link is yours — don't share it. It expires when the event starts.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
  }

  private buildIcs(
    event: EventEntity,
    brand: { brandName: string; eventSingular: string },
    descriptionSuffix?: string,
  ): string {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, eventSingular } = brand;

    const startUtc = eventTimeToUtc(event.eventDate, event.eventTime);
    const endUtc = new Date(startUtc.getTime() + EVENT_DURATION_MS);

    const lastMod = toIcsUtcString(new Date(event.updatedAt));
    const sequence = Math.floor(new Date(event.updatedAt).getTime() / 60000) % 999999;

    const descParts: string[] = [`🍽️ ${event.locationName}`];
    if (event.locationAddress) descParts.push(event.locationAddress);
    if (event.description) descParts.push('', event.description);
    if (event.additionalInfo) descParts.push('', event.additionalInfo);
    if (descriptionSuffix) descParts.push('', descriptionSuffix);

    const location = event.locationAddress
      ? `${event.locationName}, ${event.locationAddress}`
      : event.locationName;

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//${brandName}//${brandName} Calendar//EN`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:dinnerbears-event-${event.id}@dinnerbears.com`,
      `DTSTART:${toIcsUtcString(startUtc)}`,
      `DTEND:${toIcsUtcString(endUtc)}`,
      `LAST-MODIFIED:${lastMod}`,
      `SEQUENCE:${sequence}`,
      `STATUS:${event.status === EventStatus.CANCELLED ? 'CANCELLED' : 'CONFIRMED'}`,
      foldIcsLine(`SUMMARY:${icsEscape(`${brandName} ${eventSingular} at ${event.locationName}`)}`),
      foldIcsLine(`LOCATION:${icsEscape(location)}`),
      foldIcsLine(`DESCRIPTION:${icsEscape(descParts.join('\n'))}`),
      foldIcsLine(`URL:${appUrl}/events/${event.id}`),
      `ORGANIZER;CN=${brandName}:mailto:${eventOrganizerEmail(this.config)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ];

    return lines.join('\r\n');
  }

  async generateIcs(id: number): Promise<string> {
    const event = await this.findOne(id);
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, eventSingular } = await this.getEmailBrand();
    return this.buildIcs(event, { brandName, eventSingular }, `View event: ${appUrl}/events/${id}`);
  }

  async generateGuestIcs(token: string): Promise<{ ics: string; eventId: number }> {
    const link = await this.guestLinkRepo.findOne({
      where: { token },
      relations: ['event'],
    });
    if (!link) throw new NotFoundException('Guest link not found');
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const manageUrl = `${appUrl}/rsvp-guest?token=${token}`;
    const { brandName, eventSingular } = await this.getEmailBrand();
    const ics = this.buildIcs(link.event, { brandName, eventSingular }, `Manage your RSVP: ${manageUrl}`);
    return { ics, eventId: link.event.id };
  }

  async generateGuestLink(
    eventId: number,
    userId: number,
    recipientName?: string,
    recipientEmail?: string,
  ): Promise<EventGuestLinkEntity> {
    const event = await this.eventRepo.findOne({
      where: { id: eventId },
      relations: ['location'],
      // Keep photos[0] ("the cover photo") consistent with findAll/findOne's ordering.
      order: { location: { photos: { id: 'ASC' } } },
    });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('Event is not published');
    }

    const rsvp = await this.rsvpRepo.findOne({ where: { eventId, userId }, relations: ['user'] });
    if (!rsvp) throw new BadRequestException('You must RSVP before generating a guest link');

    const existingLinks = await this.guestLinkRepo.count({ where: { memberRsvpId: rsvp.id } });
    if (existingLinks >= rsvp.additionalGuests) {
      throw new BadRequestException(
        `You already have ${existingLinks} guest link(s) — increase your additional guests count to generate more`,
      );
    }

    const token = randomBytes(20).toString('hex');

    const [y, m, d] = event.eventDate.split('-').map(Number);
    const [h, min] = event.eventTime.split(':').map(Number);
    const expiresAt = new Date(y, m - 1, d, h, min);

    const link = this.guestLinkRepo.create({
      eventId,
      createdById: userId,
      memberRsvpId: rsvp.id,
      deliveryType: 'shareable',
      recipientName: recipientName ?? null,
      recipientEmail: recipientEmail ?? null,
      token,
      expiresAt,
    });

    const saved = await this.guestLinkRepo.save(link);

    // Fire-and-forget — email delivery is best-effort and must not block returning the link
    if (recipientEmail) {
      const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
      const { brandName, tagline, eventSingularLower, logoUrl } = await this.getEmailBrand();
      const manageUrl = `${appUrl}/rsvp-guest?token=${saved.token}`;
      const icsUrl = `${appUrl}/api/v1/events/guest-ics/${saved.token}`;

      const [ey, em, ed] = event.eventDate.split('-').map(Number);
      const [eh, emin] = event.eventTime.split(':').map(Number);
      const eventDateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      });
      const eventTimeDisplay = this.formatEventTimeDisplay(eh, emin);
      const photoUrl = event.location?.photos?.[0]?.filePath ?? null;
      const inviterName = rsvp.user?.fullName ?? null;
      // The inviting member already has legitimate access (they RSVP'd Going
      // themselves); a guest they personally invite inherits that visibility.
      const addressVisible = this.locationVisibility.canViewAddressSync(
        event.location ?? { id: -1, isPrivate: false },
        false,
        rsvp.status === RsvpStatus.GOING,
      );

      void this.emailService.queue({
        toEmail: recipientEmail,
        toName: recipientName ?? undefined,
        subject: `You're invited to a ${brandName} ${eventSingularLower}!`,
        htmlBody: this.buildGuestEmail({
          appUrl,
          brandName,
          tagline,
          eventSingularLower,
          logoUrl,
          inviterName,
          subject: `You're invited to a ${brandName} ${eventSingularLower}!`,
          eventTitle: event.title,
          eventDateDisplay,
          eventTimeDisplay,
          locationName: event.locationName ?? '',
          locationAddress: addressVisible ? (event.locationAddress ?? '') : '',
          locationLat: addressVisible ? event.locationLat : null,
          locationLng: addressVisible ? event.locationLng : null,
          photoUrl,
          description: event.description ?? null,
          additionalInfo: event.additionalInfo ?? null,
          manageUrl,
          googleCalUrl: this.buildGoogleCalendarUrl(event, addressVisible ? event.locationAddress : ''),
          icsUrl,
        }),
      }).catch((err: unknown) => {
        this.logger.warn(`Failed to queue guest invite email to ${recipientEmail}: ${(err as Error)?.message}`);
      });
    }

    return saved;
  }

  async createPublicRsvp(eventId: number, name: string, email: string): Promise<void> {
    const event = await this.eventRepo.findOne({
      where: { id: eventId },
      relations: ['city', 'location'],
      // Keep photos[0] ("the cover photo") consistent with findAll/findOne's ordering.
      order: { location: { photos: { id: 'ASC' } } },
    });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('RSVPs are not open for this event');
    }
    const now = new Date();
    const eventStart = new Date(`${event.eventDate}T${event.eventTime}`);
    if (now >= eventStart) throw new BadRequestException('This event has already started');

    const existingMember = await this.userRepo.findOne({
      where: { email: email.trim().toLowerCase(), status: Not(UserStatus.DELETED) },
    });
    if (existingMember) throw new BadRequestException('already_a_member');

    const existing = await this.guestLinkRepo.findOne({
      where: { eventId, recipientEmail: email.toLowerCase(), source: 'public', cancelledAt: IsNull() },
    });
    if (existing) throw new BadRequestException('An RSVP for this email already exists for this event');

    const token = randomBytes(32).toString('hex');
    const link = this.guestLinkRepo.create({
      eventId,
      source: 'public',
      memberRsvpId: null,
      createdById: null,
      recipientName: name.trim(),
      recipientEmail: email.trim().toLowerCase(),
      token,
      expiresAt: eventStart,
      usedAt: now,
      deliveryType: 'email',
    });
    const saved = await this.guestLinkRepo.save(link);

    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, tagline, eventSingularLower, logoUrl } = await this.getEmailBrand();
    const manageUrl = `${appUrl}/rsvp-guest?token=${saved.token}`;
    const icsUrl = `${appUrl}/api/v1/events/guest-ics/${saved.token}`;

    const [ey, em, ed] = event.eventDate.split('-').map(Number);
    const [eh, emin] = event.eventTime.split(':').map(Number);
    const eventDateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const eventTimeDisplay = this.formatEventTimeDisplay(eh, emin);
    const photoUrl = event.location?.photos?.[0]?.filePath ?? null;

    await this.emailService.queue({
      toEmail: email,
      toName: name,
      subject: `You're going to a ${brandName} ${eventSingularLower}!`,
      htmlBody: this.buildGuestEmail({
        appUrl,
        brandName,
        tagline,
        eventSingularLower,
        logoUrl,
        inviterName: null,
        subject: `You're going to a ${brandName} ${eventSingularLower}!`,
        eventTitle: event.title,
        eventDateDisplay,
        eventTimeDisplay,
        locationName: event.locationName ?? '',
        locationAddress: event.locationAddress ?? '',
        locationLat: event.locationLat ?? null,
        locationLng: event.locationLng ?? null,
        photoUrl,
        description: event.description ?? null,
        additionalInfo: event.additionalInfo ?? null,
        manageUrl,
        googleCalUrl: this.buildGoogleCalendarUrl(event),
        icsUrl,
      }),
    });
  }

  async getAttendance(eventId: number): Promise<{
    type: 'member' | 'guest' | 'facebook';
    userId?: number;
    guestLinkId?: number;
    facebookAttendeeId?: number;
    memberName: string;
    recipientEmail?: string | null;
    attended: boolean | null;
    isWalkin: boolean;
    fromOtherCity: boolean;
    linkUsed: boolean;
    source?: RsvpSource;
  }[]> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const [rsvps, guestLinks] = await Promise.all([
      this.rsvpRepo.find({
        where: { eventId, status: RsvpStatus.GOING },
        relations: ['user'],
        order: { createdAt: 'ASC' },
      }),
      this.guestLinkRepo.find({
        where: { eventId },
        order: { createdAt: 'ASC' },
      }),
    ]);

    const members = rsvps.map((r) => ({
      type: 'member' as const,
      userId: r.userId,
      memberName: r.user?.fullName ?? 'Member',
      // `attended` is a plain tinyint column, not TypeORM's `boolean` type — MySQL
      // hands back a raw 0/1 number here, not a real boolean. The attendance
      // dialog highlights buttons with a strict `=== true`/`=== false` check, which
      // a number never satisfies, so this must be coerced before it leaves the API.
      attended: r.attended === null ? null : !!r.attended,
      isWalkin: r.isWalkin,
      fromOtherCity: r.fromOtherCity,
      linkUsed: false,
      source: r.source,
    }));

    const guests = guestLinks
      .filter((l) => !l.cancelledAt)
      .map((l) => ({
        type: 'guest' as const,
        guestLinkId: l.id,
        memberName: l.recipientName ?? l.recipientEmail ?? 'Guest',
        recipientEmail: l.recipientEmail,
        attended: l.attended === null ? null : !!l.attended,
        isWalkin: false,
        fromOtherCity: false,
        linkUsed: !!l.usedAt,
      }));

    const facebook = ((await this.getFacebookOnlyAttendees([eventId])).get(eventId) ?? []).map((a) => ({
      type: 'facebook' as const,
      facebookAttendeeId: a.id,
      memberName: a.plusOnes > 0
        ? `${a.name} (+${a.plusOnes}${a.plusOneNames.length ? `: ${a.plusOneNames.join(', ')}` : ''})`
        : a.name,
      attended: a.attended,
      isWalkin: false,
      fromOtherCity: false,
      linkUsed: false,
    }));

    return [...members, ...guests, ...facebook];
  }

  // Attendance for a Facebook-only attendee (Phase 39). No points yet — they
  // have no account; if the Facebook account is later linked to a member, an
  // Attended mark here carries over with points.
  async markFacebookAttendance(facebookAttendeeId: number, attended: boolean): Promise<void> {
    const row = await this.facebookAttendeeRepo.findOne({ where: { id: facebookAttendeeId } });
    if (!row) throw new NotFoundException('Facebook attendee not found');
    await this.facebookAttendeeRepo.update(facebookAttendeeId, { attended });
  }

  // Everyone Going on at least one synced Facebook event whose account isn't
  // linked to a member, per event.
  async getFacebookOnlyAttendees(eventIds: number[]): Promise<Map<number, FacebookOnlyAttendee[]>> {
    const map = new Map<number, FacebookOnlyAttendee[]>();
    if (eventIds.length === 0) return map;
    const rows = await this.facebookAttendeeRepo.find({
      where: { eventId: In(eventIds) },
      relations: ['facebookAccount'],
      order: { id: 'ASC' },
    });
    for (const row of rows) {
      const account = row.facebookAccount;
      if (!account || account.status === FacebookAccountStatus.LINKED || !isFacebookGoing(row)) continue;
      map.set(row.eventId, [
        ...(map.get(row.eventId) ?? []),
        {
          id: row.id,
          facebookAccountId: account.id,
          name: account.displayName,
          plusOnes: facebookGuestCount(facebookGuests(row)),
          plusOneNames: facebookGuests(row).names,
          attended: row.attended == null ? null : !!row.attended,
        },
      ]);
    }
    return map;
  }

  // The number handed back to Muse for each Facebook event's description:
  // members Going plus their +1s, public guest signups, and Facebook-only
  // attendees plus their +1s.
  async getHeadcount(eventId: number): Promise<number> {
    const goingRsvps = await this.rsvpRepo.find({ where: { eventId, status: RsvpStatus.GOING } });
    let count = goingRsvps.reduce(
      (sum, r) => sum + 1 + (Number(r.additionalGuests) || 0) + (Number(r.facebookGuestCount) || 0),
      0,
    );
    count += await this.guestLinkRepo.count({ where: { eventId, source: 'public', cancelledAt: IsNull() } });
    for (const p of (await this.getFacebookOnlyAttendees([eventId])).get(eventId) ?? []) {
      count += 1 + p.plusOnes;
    }
    return count;
  }

  async markAttendance(eventId: number, attendances: { userId: number; attended: boolean; fromOtherCity?: boolean }[]): Promise<void> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    for (const entry of attendances) {
      const update: Partial<EventRsvpEntity> = { attended: entry.attended };
      if (entry.fromOtherCity !== undefined) update.fromOtherCity = entry.fromOtherCity;

      await this.rsvpRepo.update(
        { eventId, userId: entry.userId, status: RsvpStatus.GOING },
        update,
      );
      if (entry.attended) {
        await this.pointsService.awardAttendance(entry.userId, eventId).catch(() => {});
        // Award coordinator if this member made the reservation
        const coordinatorId = event.reservationAssigneeId ?? null;
        if (coordinatorId === entry.userId) {
          await this.pointsService.awardCoordinator(entry.userId, eventId).catch(() => {});
        }
        // Award event-specific one-time achievement if this event has one
        await this.achievementsService.checkEventAchievement(entry.userId, eventId).catch(() => {});
        // City Hopper: mark as from another city
        if (entry.fromOtherCity) {
          await this.pointsService.awardCityHopper(entry.userId, eventId).catch(() => {});
        }
        // Secret Dinner: award if this event is marked secret
        if (event.isSecret) {
          await this.pointsService.awardSecretDinner(entry.userId, eventId).catch(() => {});
        }
      }
    }
  }

  async markGuestAttendance(guestLinkId: number, attended: boolean): Promise<void> {
    const link = await this.guestLinkRepo.findOne({ where: { id: guestLinkId } });
    if (!link) throw new NotFoundException('Guest link not found');
    await this.guestLinkRepo.update(guestLinkId, { attended });
  }

  async resendGuestInvite(guestLinkId: number): Promise<void> {
    const link = await this.guestLinkRepo.findOne({
      where: { id: guestLinkId },
      relations: ['event', 'event.location', 'event.location.photos', 'memberRsvp', 'memberRsvp.user'],
      // Keep photos[0] ("the cover photo") consistent with findAll/findOne's ordering.
      order: { event: { location: { photos: { id: 'ASC' } } } },
    });
    if (!link) throw new NotFoundException('Guest link not found');
    if (!link.recipientEmail) throw new BadRequestException('This guest link has no email address to resend to');

    const event = link.event;
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, tagline, eventSingularLower, logoUrl } = await this.getEmailBrand();
    const manageUrl = `${appUrl}/rsvp-guest?token=${link.token}`;
    const icsUrl = `${appUrl}/api/v1/events/guest-ics/${link.token}`;

    const [ey, em, ed] = event.eventDate.split('-').map(Number);
    const [eh, emin] = event.eventTime.split(':').map(Number);
    const eventDateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const eventTimeDisplay = this.formatEventTimeDisplay(eh, emin);
    const photoUrl = event.location?.photos?.[0]?.filePath ?? null;
    const inviterName = link.memberRsvp?.user?.fullName ?? null;
    const addressVisible = this.locationVisibility.canViewAddressSync(
      event.location ?? { id: -1, isPrivate: false },
      false,
      link.memberRsvp?.status === RsvpStatus.GOING,
    );

    await this.emailService.queue({
      toEmail: link.recipientEmail,
      toName: link.recipientName ?? undefined,
      subject: `You're invited to a ${brandName} ${eventSingularLower}!`,
      htmlBody: this.buildGuestEmail({
        appUrl,
        brandName,
        tagline,
        logoUrl,
        eventSingularLower,
        inviterName,
        subject: `You're invited to a ${brandName} ${eventSingularLower}!`,
        eventTitle: event.title,
        eventDateDisplay,
        eventTimeDisplay,
        locationName: event.locationName ?? '',
        locationAddress: addressVisible ? (event.locationAddress ?? '') : '',
        locationLat: addressVisible ? event.locationLat : null,
        locationLng: addressVisible ? event.locationLng : null,
        photoUrl,
        description: event.description ?? null,
        additionalInfo: event.additionalInfo ?? null,
        manageUrl,
        googleCalUrl: this.buildGoogleCalendarUrl(event, addressVisible ? event.locationAddress : ''),
        icsUrl,
      }),
    });
  }

  async searchMembersForWalkin(eventId: number, query: string, excludeGoing = true): Promise<{ id: number; fullName: string }[]> {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .select(['u.id', 'u.fullName'])
      .where('u.status = :status', { status: 'active' })
      .andWhere('u.role NOT IN (:...hiddenRoles)', { hiddenRoles: [UserRole.AUTOMATION, UserRole.MUSE] })
      .orderBy('u.full_name', 'ASC')
      .limit(20);

    if (excludeGoing) {
      const existingRsvps = await this.rsvpRepo.find({
        where: { eventId, status: RsvpStatus.GOING },
        select: ['userId'],
      });
      const excludeIds = existingRsvps.map((r) => r.userId);
      if (excludeIds.length > 0) {
        qb.andWhere('u.id NOT IN (:...excludeIds)', { excludeIds });
      }
    }

    if (query.trim()) {
      qb.andWhere('u.full_name LIKE :q', { q: `%${query.trim()}%` });
    }

    const users = await qb.getMany();
    return users.map((u) => ({ id: u.id, fullName: u.fullName }));
  }

  async getReservationInfo(token: string): Promise<{ eventTitle: string; locationName: string; eventDate: string; eventTime: string; inviteToken?: string }> {
    const event = await this.eventRepo.findOne({ where: { reservationConfirmToken: token } });
    if (!event) throw new NotFoundException('Confirmation link not found');
    let inviteToken: string | undefined;
    if (event.reservationContactEmail) {
      const invite = await this.inviteRepo.findOne({
        where: {
          type: InviteType.EVENT_INVITE,
          eventId: event.id,
          boundToEmail: event.reservationContactEmail.toLowerCase(),
          isRevoked: false,
          redeemedAt: IsNull(),
        },
      });
      if (invite) inviteToken = invite.token;
    }
    return {
      eventTitle: event.title,
      locationName: event.locationName,
      eventDate: event.eventDate,
      eventTime: event.eventTime,
      ...(inviteToken ? { inviteToken } : {}),
    };
  }

  async setReservation(eventId: number, dto: SetReservationDto, callerUser?: UserEntity): Promise<EventEntity> {
    const event = await this.eventRepo.findOne({
      where: { id: eventId },
      relations: ['location', 'reservationAssignee'],
    });
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);

    if (dto.confirmed !== undefined) {
      event.reservationConfirmed = dto.confirmed;
      if (dto.confirmed) {
        const assignedName = event.reservationAssignee?.fullName ?? event.reservationContactName;
        const callerIsAssignee = callerUser != null && event.reservationAssigneeId === callerUser.id;
        if (assignedName && callerUser && !callerIsAssignee) {
          // Admin/mod confirming on behalf of the actual assignee — record both
          event.reservationConfirmedBy = `${assignedName} (confirmed by ${callerUser.fullName})`;
        } else {
          // Assignee self-confirmed, or no specific assignee
          event.reservationConfirmedBy = assignedName ?? callerUser?.fullName ?? 'Admin';
        }
        event.reservationConfirmedAt = new Date();
        event.reservationConfirmedNote = dto.confirmedNote ?? null;
      } else {
        event.reservationConfirmedBy = null;
        event.reservationConfirmedAt = null;
        event.reservationConfirmedNote = null;
      }
    }

    if (dto.assigneeId !== undefined) {
      // Clear confirmation state on reassign
      if (event.reservationAssigneeId !== dto.assigneeId || event.reservationContactEmail) {
        event.reservationConfirmed = false;
        event.reservationConfirmedBy = null;
        event.reservationConfirmedAt = null;
        event.reservationSeatsEmailSent = false;
      }
      event.reservationAssigneeId = dto.assigneeId ?? null;
      event.reservationContactName = null;
      event.reservationContactEmail = null;
      event.reservationConfirmToken = null;

      if (dto.assigneeId) {
        const assignee = await this.userRepo.findOne({ where: { id: dto.assigneeId } });
        if (!assignee) throw new NotFoundException(`Member ${dto.assigneeId} not found`);
        if (assignee.email) {
          await this.sendReservationRequestEmail(event, assignee.fullName, assignee.email, null);
        }
      }
    } else if (dto.contactName !== undefined || dto.contactEmail !== undefined) {
      // Clear confirmation state on reassign
      if (event.reservationContactEmail !== dto.contactEmail || event.reservationAssigneeId) {
        event.reservationConfirmed = false;
        event.reservationConfirmedBy = null;
        event.reservationConfirmedAt = null;
        event.reservationSeatsEmailSent = false;
      }
      event.reservationAssigneeId = null;
      event.reservationContactName = dto.contactName ?? null;
      event.reservationContactEmail = dto.contactEmail ?? null;

      if (dto.contactEmail) {
        const token = randomUUID().replace(/-/g, '');
        event.reservationConfirmToken = token;
        const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
        const confirmUrl = `${appUrl}/events/reservation-confirm/${token}`;

        // Create (or reuse) an EVENT_INVITE so the outside contact can sign up
        const normalizedEmail = dto.contactEmail.toLowerCase();
        const existingInvite = await this.inviteRepo.findOne({
          where: {
            type: InviteType.EVENT_INVITE,
            eventId: event.id,
            boundToEmail: normalizedEmail,
            isRevoked: false,
            redeemedAt: IsNull(),
          },
        });
        let inviteToken: string;
        if (existingInvite) {
          inviteToken = existingInvite.token;
        } else {
          const inviteExpiry = new Date();
          inviteExpiry.setDate(inviteExpiry.getDate() + 30);
          const newInvite = await this.inviteRepo.save(this.inviteRepo.create({
            token: randomBytes(50).toString('hex'),
            type: InviteType.EVENT_INVITE,
            eventId: event.id,
            boundToEmail: normalizedEmail,
            boundToName: dto.contactName ?? null,
            inviteFlavor: InviteFlavor.MEMBER,
            maxUses: 1,
            expiresAt: inviteExpiry,
            createdBy: callerUser?.id ?? 1,
            cityId: event.cityId,
          }));
          inviteToken = newInvite.token;
        }
        const signupUrl = `${appUrl}/login?token=${inviteToken}`;
        await this.sendReservationRequestEmail(event, dto.contactName ?? dto.contactEmail, dto.contactEmail, confirmUrl, signupUrl);
      } else {
        event.reservationConfirmToken = null;
      }
    }

    await this.eventRepo.save(event);

    // awardCoordinator() otherwise only ever fires inline, once, inside
    // markAttendance() — someone assigned as coordinator *after* their
    // attendance was already marked (e.g. once they've finished registering)
    // would never get credit without this retroactive check.
    if (dto.assigneeId) {
      const assigneeRsvp = await this.rsvpRepo.findOne({
        where: { eventId, userId: dto.assigneeId, attended: true },
      });
      if (assigneeRsvp) {
        await this.pointsService.awardCoordinator(dto.assigneeId, eventId).catch(() => {});
      }
    }

    return this.findOne(eventId, callerUser?.role);
  }

  private async sendReservationRequestEmail(
    event: EventEntity,
    recipientName: string,
    recipientEmail: string,
    confirmUrl: string | null,
    signupUrl?: string,
  ): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, tagline, eventSingularLower, logoUrl } = await this.getEmailBrand();
    const [ey, em, ed] = event.eventDate.split('-').map(Number);
    const [eh, emin] = event.eventTime.split(':').map(Number);
    const dateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const timeDisplay = this.formatEventTimeDisplay(eh, emin);

    const eventUrl = `${appUrl}/events/${event.id}`;
    const ctaUrl = confirmUrl ?? eventUrl;
    const ctaLabel = confirmUrl ? 'Mark Reservation as Made' : 'View Event';

    const mapsUrl = (event.locationLat && event.locationLng)
      ? `https://www.google.com/maps?q=${event.locationLat},${event.locationLng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.locationAddress)}`;

    const phone = event.location?.phone ?? null;
    const websiteUrl = event.location?.websiteUrl ?? null;
    const phoneRow = phone
      ? `<tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📞</span>
        <a href="tel:${phone}" style="color:#C9933A;text-decoration:none">${phone}</a>
      </td></tr>`
      : '';
    const websiteRow = websiteUrl
      ? `<tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🌐</span>
        <a href="${websiteUrl}" style="color:#C9933A;text-decoration:none">${websiteUrl}</a>
      </td></tr>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EDD8;font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(61,28,5,0.12)">
  <tr><td style="background:#3D1C05;padding:20px;text-align:center">
    <img src="${logoUrl}" alt="${brandName}" height="100" style="display:inline-block;height:100px" />
  </td></tr>
  <tr><td style="padding:32px 36px 24px">
    <p style="margin:0 0 8px;font-size:0.95rem;color:#666">Hi ${recipientName},</p>
    <h1 style="margin:0 0 20px;font-size:1.4rem;font-weight:700;color:#3D1C05;line-height:1.2">You've been asked to make the ${eventSingularLower} reservation</h1>
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:24px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span><strong>${event.title}</strong>
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span><strong>${dateDisplay}</strong> at ${timeDisplay}
      </td></tr>
      <tr><td style="padding:10px 16px;${phone || websiteUrl ? 'border-bottom:1px solid #e8e0d6;' : ''}font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📍</span>
        <a href="${mapsUrl}" style="color:#C9933A;text-decoration:none">${event.locationName} — ${event.locationAddress}</a>
      </td></tr>
      ${phoneRow}
      ${websiteRow}
    </table>
    <p style="margin:0 0 12px;font-size:0.9rem;color:#555">
      Please call <strong>${event.locationName}</strong> and make a reservation for about
      <strong>20&ndash;25 people</strong> to start. A few things to mention when you call:
    </p>
    <ul style="margin:0 0 16px;padding-left:20px;font-size:0.9rem;color:#555;line-height:1.7">
      <li>${brandName} members typically start arriving <strong>30 minutes early</strong>, so give them a heads-up.</li>
      <li>You'll receive a follow-up email <strong>2 hours before the event</strong> with an updated headcount &mdash; please plan to call the venue that day to confirm the final count.</li>
    </ul>
    <p style="text-align:center;margin:0 0 24px">
      <a href="${ctaUrl}" style="background:#C9933A;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:1rem;display:inline-block">${ctaLabel}</a>
    </p>
    <p style="margin:0;font-size:0.8rem;color:#aaa;text-align:center">
      If you have questions, reply to this email or contact the event organizer.
    </p>
    ${signupUrl ? `
    <div style="margin-top:24px;padding:16px;background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;text-align:center">
      <p style="margin:0 0 10px;font-size:0.88rem;color:#555;font-weight:600">New to ${brandName}?</p>
      <p style="margin:0 0 12px;font-size:0.85rem;color:#777">Create your account and you'll be auto-RSVPed to this ${eventSingularLower}.</p>
      <a href="${signupUrl}" style="background:#1E4D8C;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.9rem;display:inline-block">Create My Account</a>
    </div>` : ''}
  </td></tr>
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">${brandName} — ${tagline}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    await this.emailService.queue({
      toEmail: recipientEmail,
      toName: recipientName,
      subject: `Action needed: make the reservation for ${event.title}`,
      htmlBody: html,
    });
  }

  async confirmReservation(token: string): Promise<{ eventTitle: string; locationName: string; eventDate: string; eventTime: string; inviteToken?: string }> {
    const event = await this.eventRepo.findOne({ where: { reservationConfirmToken: token } });
    if (!event) throw new NotFoundException('Confirmation link not found or already used');
    event.reservationConfirmed = true;
    event.reservationConfirmedBy = event.reservationContactName ?? 'Outside Contact';
    event.reservationConfirmedAt = new Date();
    await this.eventRepo.save(event);
    let inviteToken: string | undefined;
    if (event.reservationContactEmail) {
      const invite = await this.inviteRepo.findOne({
        where: {
          type: InviteType.EVENT_INVITE,
          eventId: event.id,
          boundToEmail: event.reservationContactEmail.toLowerCase(),
          isRevoked: false,
          redeemedAt: IsNull(),
        },
      });
      if (invite) inviteToken = invite.token;
    }
    return {
      eventTitle: event.title,
      locationName: event.locationName,
      eventDate: event.eventDate,
      eventTime: event.eventTime,
      ...(inviteToken ? { inviteToken } : {}),
    };
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async checkReservationSeatsReminders(): Promise<void> {
    // Get current Eastern time
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
    const pad2 = (n: string) => n.padStart(2, '0');
    const easternNow = `${g('year')}-${pad2(g('month'))}-${pad2(g('day'))} ${pad2(g('hour'))}:${pad2(g('minute'))}:00`;

    const twoHrsLater = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const parts2 = fmt.formatToParts(twoHrsLater);
    const g2 = (t: string) => parts2.find((p) => p.type === t)?.value ?? '0';
    const easternPlus2 = `${g2('year')}-${pad2(g2('month'))}-${pad2(g2('day'))} ${pad2(g2('hour'))}:${pad2(g2('minute'))}:00`;

    const events = await this.eventRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.location', 'location')
      .where('e.status = :status', { status: EventStatus.PUBLISHED })
      .andWhere('e.reservationSeatsEmailSent = 0')
      .andWhere('(e.reservationAssigneeId IS NOT NULL OR e.reservationContactEmail IS NOT NULL)')
      .andWhere('TIMESTAMP(e.event_date, e.event_time) BETWEEN :start AND :end', {
        start: easternNow,
        end: easternPlus2,
      })
      .getMany();

    for (const event of events) {
      try {
        await this.sendSeatsReminderEmail(event);
        await this.eventRepo.update(event.id, { reservationSeatsEmailSent: true });
      } catch (err) {
        this.logger.error(`Seats reminder failed for event ${event.id}`, err);
      }
    }
  }

  private async sendSeatsReminderEmail(event: EventEntity): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    const { brandName, tagline, eventSingularLower, logoUrl } = await this.getEmailBrand();

    // Resolve recipient
    let recipientEmail: string | null = event.reservationContactEmail;
    let recipientName: string = event.reservationContactName ?? 'there';
    if (event.reservationAssigneeId) {
      const assignee = await this.userRepo.findOne({ where: { id: event.reservationAssigneeId } });
      if (!assignee?.email) return;
      recipientEmail = assignee.email;
      recipientName = assignee.fullName;
    }
    if (!recipientEmail) return;

    // Current going count (member RSVPs + additional guests + public RSVPs)
    const goingRsvps = await this.rsvpRepo.find({
      where: { eventId: event.id, status: RsvpStatus.GOING },
    });
    let goingCount = goingRsvps.reduce((sum, r) => sum + 1 + r.additionalGuests + (Number(r.facebookGuestCount) || 0), 0);
    const publicCount = await this.guestLinkRepo.count({
      where: { eventId: event.id, source: 'public', cancelledAt: IsNull() },
    });
    goingCount += publicCount;
    for (const p of (await this.getFacebookOnlyAttendees([event.id])).get(event.id) ?? []) {
      goingCount += 1 + p.plusOnes;
    }
    const suggestedCount = goingCount + 3;

    const [ey, em, ed] = event.eventDate.split('-').map(Number);
    const [eh, emin] = event.eventTime.split(':').map(Number);
    const dateDisplay = new Date(ey, em - 1, ed).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const timeDisplay = this.formatEventTimeDisplay(eh, emin);
    const mapsUrl = (event.locationLat && event.locationLng)
      ? `https://www.google.com/maps?q=${event.locationLat},${event.locationLng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.locationAddress)}`;

    const rPhone = event.location?.phone ?? null;
    const rWebsite = event.location?.websiteUrl ?? null;
    const rPhoneRow = rPhone
      ? `<tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📞</span>
        <a href="tel:${rPhone}" style="color:#C9933A;text-decoration:none">${rPhone}</a>
      </td></tr>`
      : '';
    const rWebsiteRow = rWebsite
      ? `<tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🌐</span>
        <a href="${rWebsite}" style="color:#C9933A;text-decoration:none">${rWebsite}</a>
      </td></tr>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EDD8;font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(61,28,5,0.12)">
  <tr><td style="background:#3D1C05;padding:20px;text-align:center">
    <img src="${logoUrl}" alt="${brandName}" height="100" style="display:inline-block;height:100px" />
  </td></tr>
  <tr><td style="padding:32px 36px 24px">
    <p style="margin:0 0 8px;font-size:0.95rem;color:#666">Hi ${recipientName},</p>
    <h1 style="margin:0 0 20px;font-size:1.4rem;font-weight:700;color:#3D1C05;line-height:1.2">Updated headcount for tonight's ${eventSingularLower}</h1>
    <table role="presentation" width="100%" style="background:#faf7f2;border:1px solid #e8e0d6;border-radius:8px;margin-bottom:24px">
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">🍽️</span><strong>${event.title}</strong>
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📅</span><strong>${dateDisplay}</strong> at ${timeDisplay}
      </td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e8e0d6;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">📍</span>
        <a href="${mapsUrl}" style="color:#C9933A;text-decoration:none">${event.locationName} — ${event.locationAddress}</a>
      </td></tr>
      ${rPhoneRow}
      ${rWebsiteRow}
      <tr><td style="padding:14px 16px;font-size:0.9rem;color:#444">
        <span style="color:#C9933A;margin-right:8px">👥</span>
        Current confirmed count: <strong>${goingCount}</strong> people
        &nbsp;&bull;&nbsp; <strong>Please update the reservation to ${suggestedCount}</strong> to allow for walk-ins
      </td></tr>
    </table>
    <p style="margin:0 0 16px;font-size:0.9rem;color:#555">
      The event starts in about 2 hours. Please call <strong>${event.locationName}</strong> now and update the reservation
      to <strong>${suggestedCount} people</strong> (${goingCount} confirmed + 3 for walk-ins).
    </p>
    <p style="text-align:center;margin:0 0 20px">
      <a href="${appUrl}/events/${event.id}" style="background:#3D1C05;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.9rem;display:inline-block">View Live Attendee List</a>
    </p>
    <p style="margin:0;font-size:0.8rem;color:#aaa;text-align:center">
      Thank you for coordinating the reservation!
    </p>
  </td></tr>
  <tr><td style="padding:16px 36px;background:#faf7f2;border-top:1px solid #e8e0d6;text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">${brandName} — ${tagline}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    await this.emailService.queue({
      toEmail: recipientEmail,
      toName: recipientName,
      subject: `Headcount update for ${event.title} — please call ${event.locationName}`,
      htmlBody: html,
    });
  }

  async addWalkin(eventId: number, userId: number): Promise<{ type: 'member'; userId: number; memberName: string; attended: boolean | null; isWalkin: boolean; fromOtherCity: boolean; linkUsed: boolean }> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Member not found');

    const existing = await this.rsvpRepo.findOne({ where: { eventId, userId } });
    if (existing) {
      existing.attended = true;
      existing.isWalkin = true;
      await this.rsvpRepo.save(existing);
    } else {
      const rsvp = this.rsvpRepo.create({
        eventId,
        userId,
        status: RsvpStatus.GOING,
        attended: true,
        isWalkin: true,
        additionalGuests: 0,
      });
      await this.rsvpRepo.save(rsvp);
    }

    await this.pointsService.awardAttendance(userId, eventId).catch(() => {});
    await this.achievementsService.checkEventAchievement(userId, eventId).catch(() => {});

    return { type: 'member' as const, userId, memberName: user.fullName, attended: true, isWalkin: true, fromOtherCity: false, linkUsed: false };
  }
}

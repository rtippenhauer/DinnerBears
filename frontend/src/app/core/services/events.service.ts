import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BrandConfigService } from './brand-config.service';

export type EventStatus = 'draft' | 'published' | 'cancelled';

export interface PostTextInvite {
  url: string;
  flavor: 'member' | 'non_validated';
  maxUses: number | null;
  expiresAt: string;
}

interface EventLocation {
  id: number;
  name: string;
  isPrivate: boolean;
  isResidence: boolean;
  // Null when private and the viewer hasn't RSVP'd "Going" (or isn't admin/mod).
  address: string | null;
  lat: number | null;
  lng: number | null;
  websiteUrl: string | null;
  photos: Array<{ id: number; filePath: string }>;
}

export interface GuestLink {
  id: number;
  token: string;
  recipientName: string | null;
  usedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export type RsvpStatus = 'going' | 'maybe' | 'not_going';

export interface Rsvp {
  id: number;
  eventId: number;
  userId: number;
  user: { id: number; fullName: string; profilePhotoPath: string | null };
  status: RsvpStatus;
  additionalGuests: number;
  guestNames: string[] | null;
  bringingItem: string | null;
  guestLinks: GuestLink[] | undefined;
  createdAt: string;
}

interface FacebookAttendee {
  id: number;
  name: string | null;
  plusOnes: number;
}

interface PublicRsvp {
  id: number;
  recipientName: string | null;
  cancelledAt: string | null;
}

export interface Event {
  id: number;
  cityId: number;
  city: { id: number; name: string; subdomain: string };
  locationId: number | null;
  location: EventLocation | null;
  locationName: string;
  // Null when the location is private and the viewer hasn't earned visibility.
  locationAddress: string | null;
  locationLat: number | null;
  locationLng: number | null;
  title: string;
  description: string | null;
  additionalInfo: string | null;
  eventDate: string;
  eventTime: string;
  status: EventStatus;
  publishedAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  facebookShareText: string | null;
  isSecret: boolean;
  reservationAssigneeId: number | null;
  reservationAssignee: { id: number; fullName: string } | null;
  reservationContactName: string | null;
  reservationContactEmail: string | null;
  reservationConfirmed: boolean;
  reservationConfirmedBy: string | null;
  reservationConfirmedAt: string | null;
  reservationConfirmedNote: string | null;
  createdById: number;
  createdByUser: { id: number; fullName: string; profilePhotoPath: string | null };
  rsvps: Rsvp[];
  publicRsvps: PublicRsvp[];
  // Phase 39: Going on a synced Facebook event, not linked to a member yet.
  // `name` is null for viewers who can't see who's going.
  facebookAttendees?: FacebookAttendee[];
  goingCount: number;
  totalAttending?: number;
  attendeeSnippet?: Array<{ fullName: string; profilePhotoPath: string | null }>;
  myRsvpStatus?: 'going' | 'maybe' | null;
  createdAt: string;
  updatedAt: string;
  /** Only present on the response right after a PATCH that flips isSecret. */
  secretDinnerResync?: { enabled: true; awarded: number } | { enabled: false; removed: number };
}

export interface ReservationConfirmInfo {
  eventTitle: string;
  locationName: string;
  eventDate: string;
  eventTime: string;
  inviteToken?: string;
}

export interface GuestLinkInfo {
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  eventStatus: string;
  locationName: string;
  locationAddress: string | null;
  locationLat: number | null;
  locationLng: number | null;
  locationPhotoUrl: string | null;
  invitedByName: string;
  recipientName: string | null;
  usedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string;
}

export interface CreateEventPayload {
  cityId: number;
  locationId: number;
  title: string;
  description?: string | null;
  additionalInfo?: string | null;
  facebookShareText?: string | null;
  eventDate: string;
  eventTime: string;
  status?: EventStatus;
  isSecret?: boolean;
}

export interface UpdateEventPayload {
  cityId?: number;
  locationId?: number;
  title?: string;
  description?: string | null;
  additionalInfo?: string | null;
  facebookShareText?: string | null;
  eventDate?: string;
  eventTime?: string;
  status?: EventStatus;
  cancelledReason?: string | null;
  isSecret?: boolean;
}

@Injectable({ providedIn: 'root' })
export class EventsService {
  private readonly http = inject(HttpClient);
  private readonly brandConfig = inject(BrandConfigService);
  private readonly base = '/api/v1/events';

  private readonly noCache = { headers: { 'Cache-Control': 'no-cache' } };

  getAll(filters: { cityId?: number; upcoming?: boolean; fromDate?: string; status?: EventStatus } = {}): Observable<Event[]> {
    const params: Record<string, string> = {};
    if (filters.cityId) params['cityId'] = String(filters.cityId);
    if (filters.fromDate) params['fromDate'] = filters.fromDate;
    else if (filters.upcoming !== undefined) params['upcoming'] = String(filters.upcoming);
    if (filters.status) params['status'] = filters.status;
    return this.http.get<Event[]>(this.base, { params, ...this.noCache });
  }

  getOne(id: number): Observable<Event> {
    return this.http.get<Event>(`${this.base}/${id}`, this.noCache);
  }

  create(payload: CreateEventPayload): Observable<Event> {
    return this.http.post<Event>(this.base, payload);
  }

  update(id: number, payload: UpdateEventPayload): Observable<Event> {
    return this.http.patch<Event>(`${this.base}/${id}`, payload);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  rsvp(
    eventId: number,
    status: RsvpStatus,
    additionalGuests: number,
    guestNames?: string[],
    bringingItem?: string,
  ): Observable<Rsvp> {
    return this.http.post<Rsvp>(`${this.base}/${eventId}/rsvp`, {
      status,
      additionalGuests,
      guestNames,
      bringingItem,
    });
  }

  unrsvp(eventId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${eventId}/rsvp`);
  }

  generateGuestLink(eventId: number, recipientName?: string, recipientEmail?: string): Observable<GuestLink> {
    return this.http.post<GuestLink>(`${this.base}/${eventId}/rsvp/link`, { recipientName, recipientEmail });
  }

  getGuestLinkInfo(token: string): Observable<GuestLinkInfo> {
    return this.http.get<GuestLinkInfo>(`${this.base}/guest-link/${token}`);
  }

  confirmGuestRsvp(token: string, guestName?: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.base}/guest-link/${token}`, { guestName });
  }

  cancelGuestRsvp(token: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/guest-link/${token}`);
  }

  removeGuestLink(eventId: number, linkId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${eventId}/rsvp/link/${linkId}`);
  }

  publicRsvp(eventId: number, name: string, email: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.base}/${eventId}/public-rsvp`, { name, email });
  }

  mapsUrl(lat: number | null, lng: number | null, address: string | null): string | null {
    if (lat && lng) return `https://www.google.com/maps?q=${lat},${lng}`;
    if (!address) return null;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }

  googleCalendarUrl(event: Event): string {
    const [y, m, d] = event.eventDate.split('-').map(Number);
    const [h, min] = event.eventTime.split(':').map(Number);
    const pad = (n: number) => String(n).padStart(2, '0');
    const startDt = `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`;
    const endDt = `${y}${pad(m)}${pad(d)}T${pad(h + 2)}${pad(min)}00`;
    const details: string[] = [`🍽️ ${event.locationName}`];
    if (event.description) details.push(event.description);
    if (event.additionalInfo) details.push(event.additionalInfo);
    details.push(`View event: ${window.location.origin}/events/${event.id}`);
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.title,
      dates: `${startDt}/${endDt}`,
      location: event.locationAddress ?? event.locationName,
      details: details.join('\n\n'),
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  generatePostText(event: Event, invite?: PostTextInvite): string {
    const [y, m, d] = event.eventDate.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const dateStr = date.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const [h, min] = event.eventTime.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const timeStr = `${h % 12 || 12}:${String(min).padStart(2, '0')} ${ampm}`;

    const brandName = this.brandConfig.brand().name;
    const inviteBlock = invite ? this.formatInviteBlock(invite) : null;
    const noInviteLine = `\n${brandName} is invite-only. Interested in joining? Ask a member to invite you!`;

    let text: string;
    if (event.facebookShareText) {
      text = event.facebookShareText;
    } else {
      const lines = [
        `${brandName} ${this.brandConfig.dinnerSingular()} Night!\n`,
        `🍽️ ${event.locationName}`,
        `📅 ${dateStr} at ${timeStr}`,
        `📍 ${event.locationAddress ?? 'Address available after RSVP'}`,
      ];
      if (event.description) lines.push(`\n${event.description}`);
      lines.push(`\nRSVP: ${window.location.origin}/events/${event.id}`);
      lines.push(inviteBlock ? `\n${inviteBlock}` : noInviteLine);
      text = lines.join('\n');
    }

    if (invite && event.facebookShareText) {
      text += `\n\n${inviteBlock}`;
    }

    return text;
  }

  private formatInviteBlock(invite: PostTextInvite): string {
    const roleLine = invite.flavor === 'non_validated'
      ? `Not a ${this.brandConfig.brand().name} member yet? RSVP as a guest using this link:`
      : 'New here? Join using this invite link:';

    const limits: string[] = [];
    if (invite.maxUses != null) limits.push(`limited to ${invite.maxUses} uses`);
    const expiry = new Date(invite.expiresAt);
    const expiryStr = `${expiry.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${expiry.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    limits.push(`expires ${expiryStr}`);
    const limitNote = ` (${limits.join(', ')})`;

    return `${roleLine}${limitNote}\n${invite.url}`;
  }

  setReservation(eventId: number, payload: {
    assigneeId?: number | null;
    contactName?: string | null;
    contactEmail?: string | null;
    confirmed?: boolean;
    confirmedNote?: string | null;
  }): Observable<Event> {
    return this.http.patch<Event>(`${this.base}/${eventId}/reservation`, payload);
  }

  getReservationInfo(token: string): Observable<ReservationConfirmInfo> {
    return this.http.get<ReservationConfirmInfo>(`${this.base}/reservation-confirm/${token}`);
  }

  confirmReservation(token: string): Observable<ReservationConfirmInfo> {
    return this.http.post<ReservationConfirmInfo>(`${this.base}/reservation-confirm/${token}`, {});
  }
}

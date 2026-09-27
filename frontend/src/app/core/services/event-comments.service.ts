import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CommentReply {
  id: number;
  memberId: number;
  memberName: string;
  memberPhoto: string | null;
  body: string | null;
  deleted: boolean;
  editedAt: string | null;
  createdAt: string;
}

export interface Comment {
  id: number;
  memberId: number;
  memberName: string;
  memberPhoto: string | null;
  body: string | null;
  deleted: boolean;
  editedAt: string | null;
  createdAt: string;
  replies: CommentReply[];
}

export interface AttendanceEntry {
  type: 'member' | 'guest' | 'facebook';
  userId?: number;
  guestLinkId?: number;
  // Phase 39: a Facebook-only attendee (not linked to a member yet).
  facebookAttendeeId?: number;
  memberName: string;
  recipientEmail?: string | null;
  attended: boolean | null;
  isWalkin: boolean;
  fromOtherCity: boolean;
  linkUsed: boolean;
  // Who put a member's RSVP in place (Phase 39); absent on guest rows.
  source?: 'member' | 'admin' | 'facebook_sync';
}

export interface MemberSearchResult {
  id: number;
  fullName: string;
}

@Injectable({ providedIn: 'root' })
export class EventCommentsService {
  private readonly http = inject(HttpClient);

  getComments(eventId: number): Observable<Comment[]> {
    return this.http.get<Comment[]>(`/api/v1/events/${eventId}/comments`);
  }

  addComment(eventId: number, body: string): Observable<Comment> {
    return this.http.post<Comment>(`/api/v1/events/${eventId}/comments`, { body });
  }

  editComment(eventId: number, commentId: number, body: string): Observable<Comment> {
    return this.http.patch<Comment>(`/api/v1/events/${eventId}/comments/${commentId}`, { body });
  }

  deleteComment(eventId: number, commentId: number): Observable<void> {
    return this.http.delete<void>(`/api/v1/events/${eventId}/comments/${commentId}`);
  }

  addReply(eventId: number, commentId: number, body: string): Observable<CommentReply> {
    return this.http.post<CommentReply>(`/api/v1/events/${eventId}/comments/${commentId}/replies`, { body });
  }

  editReply(eventId: number, commentId: number, replyId: number, body: string): Observable<CommentReply> {
    return this.http.patch<CommentReply>(
      `/api/v1/events/${eventId}/comments/${commentId}/replies/${replyId}`,
      { body },
    );
  }

  deleteReply(eventId: number, commentId: number, replyId: number): Observable<void> {
    return this.http.delete<void>(`/api/v1/events/${eventId}/comments/${commentId}/replies/${replyId}`);
  }

  getAttendance(eventId: number): Observable<AttendanceEntry[]> {
    return this.http.get<AttendanceEntry[]>(`/api/v1/events/${eventId}/attendance`);
  }

  markAttendance(eventId: number, attendances: { userId: number; attended: boolean; fromOtherCity?: boolean }[]): Observable<void> {
    return this.http.patch<void>(`/api/v1/events/${eventId}/attendance`, { attendances });
  }

  addWalkin(eventId: number, userId: number): Observable<AttendanceEntry> {
    return this.http.post<AttendanceEntry>(`/api/v1/events/${eventId}/attendance/walkin`, { userId });
  }

  addGoing(eventId: number, userId: number): Observable<AttendanceEntry> {
    return this.http.post<AttendanceEntry>(`/api/v1/events/${eventId}/attendance/going`, { userId });
  }

  markFacebookAttendance(facebookAttendeeId: number, attended: boolean): Observable<void> {
    return this.http.patch<void>(`/api/v1/events/facebook-attendees/${facebookAttendeeId}/attendance`, { attended });
  }

  markGuestAttendance(guestLinkId: number, attended: boolean): Observable<void> {
    return this.http.patch<void>(`/api/v1/events/guest-links/${guestLinkId}/attendance`, { attended });
  }

  resendGuestInvite(guestLinkId: number): Observable<void> {
    return this.http.post<void>(`/api/v1/events/guest-links/${guestLinkId}/resend`, {});
  }

  searchMembers(eventId: number, query: string, excludeGoing = true): Observable<MemberSearchResult[]> {
    return this.http.get<MemberSearchResult[]>(`/api/v1/events/${eventId}/members/search`, {
      params: { q: query, excludeGoing: String(excludeGoing) },
    });
  }
}

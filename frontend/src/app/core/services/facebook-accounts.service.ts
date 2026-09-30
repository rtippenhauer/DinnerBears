import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type FacebookAccountStatus = 'unmatched' | 'linked' | 'not_member';

export interface FacebookAccount {
  id: number;
  displayName: string;
  profileUrl: string | null;
  facebookUserId: string | null;
  status: FacebookAccountStatus;
  member: { id: number; fullName: string; status: string } | null;
  lastSeenAt: string | null;
  eventCount: number;
  suggestions: { id: number; fullName: string }[];
}

export interface LinkableMember {
  id: number;
  fullName: string;
  status: string;
  role: string;
}

@Injectable({ providedIn: 'root' })
export class FacebookAccountsService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/admin/facebook-accounts';

  list(): Observable<FacebookAccount[]> {
    return this.http.get<FacebookAccount[]>(this.base);
  }

  link(accountId: number, userId: number): Observable<FacebookAccount> {
    return this.http.post<FacebookAccount>(`${this.base}/${accountId}/link`, { userId });
  }

  unlink(accountId: number): Observable<FacebookAccount> {
    return this.http.post<FacebookAccount>(`${this.base}/${accountId}/unlink`, {});
  }

  markNotMember(accountId: number): Observable<FacebookAccount> {
    return this.http.post<FacebookAccount>(`${this.base}/${accountId}/not-member`, {});
  }

  // Everyone who could be linked: the admin user list, filtered client-side to
  // active people.
  members(): Observable<LinkableMember[]> {
    return this.http.get<LinkableMember[]>('/api/v1/admin/users');
  }
}

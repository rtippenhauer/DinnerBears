import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface IntegrationToken {
  id: number;
  tokenPrefix: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

export type AutomationRole = 'automation' | 'muse';

export interface Integration {
  userId: number;
  name: string;
  role: string;
  status: string;
  createdAt: string;
  activeToken: IntegrationToken | null;
}

export interface SyncHost {
  id: number;
  fullName: string;
}

export interface IssuedToken {
  token: string;
  tokenPrefix: string;
  expiresAt: string;
}

export interface HostCandidate {
  id: number;
  fullName: string;
  status: string;
  role: string;
}

@Injectable({ providedIn: 'root' })
export class IntegrationsService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/admin/integrations';

  list(): Observable<{ integrations: Integration[]; syncHost: SyncHost | null }> {
    return this.http.get<{ integrations: Integration[]; syncHost: SyncHost | null }>(this.base);
  }

  create(name: string, role: AutomationRole): Observable<Integration & { issued: IssuedToken | null }> {
    return this.http.post<Integration & { issued: IssuedToken | null }>(this.base, { name, role });
  }

  regenerate(userId: number): Observable<IssuedToken> {
    return this.http.post<IssuedToken>(`${this.base}/${userId}/token`, {});
  }

  revoke(userId: number): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/${userId}/token`);
  }

  setSyncHost(userId: number): Observable<SyncHost> {
    return this.http.put<SyncHost>(`${this.base}/sync-host`, { userId });
  }

  // Candidates for the sync host: the admin user list, filtered client-side to
  // real, active people.
  hostCandidates(): Observable<HostCandidate[]> {
    return this.http.get<HostCandidate[]>('/api/v1/admin/users');
  }
}

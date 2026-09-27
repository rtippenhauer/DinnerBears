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

export interface IssuedToken {
  token: string;
  tokenPrefix: string;
  expiresAt: string;
}

@Injectable({ providedIn: 'root' })
export class IntegrationsService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/admin/integrations';

  list(): Observable<{ integrations: Integration[] }> {
    return this.http.get<{ integrations: Integration[] }>(this.base);
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
}

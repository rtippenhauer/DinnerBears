import { Component, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { DatePipe, JsonPipe } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { RouterLink } from '@angular/router';
import { MemberHoverDirective } from '../../../shared/directives/member-hover.directive';

interface AuditEntry {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

interface AuditResponse {
  data: AuditEntry[];
  total: number;
}

const AUDIT_ACTIONS = [
  { value: 'user.login', label: 'Login' },
  { value: 'user.login_failed', label: 'Failed Login' },
  { value: 'user.logout', label: 'Logout' },
  { value: 'user.register', label: 'Register' },
  { value: 'auth.rate_limited', label: 'Rate Limited' },
  { value: 'user.ban', label: 'Ban' },
  { value: 'user.unban', label: 'Unban' },
  { value: 'user.force_ban', label: 'Force Ban' },
  { value: 'user.role_change', label: 'Role Change' },
  { value: 'user.admin_delete', label: 'Admin Delete' },
  { value: 'user.link_facebook', label: 'Link Facebook' },
  { value: 'account_deleted', label: 'Self-Deleted' },
  { value: 'account_deleted_by_meta_callback', label: 'Meta Deletion Callback' },
  { value: 'account_hard_deleted', label: 'Hard Deleted' },
  { value: 'facebook_disconnected_by_meta_callback', label: 'Facebook Disconnected (Meta)' },
  { value: 'admin.suppress_email', label: 'Suppress Email' },
  { value: 'admin.lift_suppression', label: 'Lift Suppression' },
  { value: 'rsvp.facebook_sync', label: 'Facebook Sync RSVP' },
  { value: 'rsvp.admin_add_going', label: 'Admin Added to Going' },
  { value: 'integration.create', label: 'Automation Account Created' },
  { value: 'integration.token_issue', label: 'Muse Token Issued' },
  { value: 'integration.token_rotate', label: 'Muse Token Rotated' },
  { value: 'integration.token_revoke', label: 'Muse Token Revoked' },
  { value: 'integration.sync_host_set', label: 'Sync Host Changed' },
  { value: 'muse.invite_create', label: 'Muse Created Invite Link' },
  { value: 'muse.invite_revoke', label: 'Muse Revoked Invite Link' },
];

@Component({
  selector: 'app-admin-audit',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DatePipe,
    JsonPipe,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    RouterLink,
    MemberHoverDirective,
  ],
  template: `
    <div class="audit-container">
      <h2>Audit Log</h2>

      <form [formGroup]="filterForm" (ngSubmit)="applyFilters()" class="filters">
        <mat-form-field appearance="outline" class="filter-field filter-action">
          <mat-label>Event</mat-label>
          <mat-select formControlName="action">
            <mat-option value="">All events</mat-option>
            @for (a of actions; track a.value) {
              <mat-option [value]="a.value">{{ a.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="filter-field filter-user">
          <mat-label>Name or email</mat-label>
          <input matInput formControlName="userSearch" placeholder="Search by name or email…" />
          <mat-icon matSuffix>search</mat-icon>
        </mat-form-field>

        <mat-form-field appearance="outline" class="filter-field filter-id">
          <mat-label>User ID</mat-label>
          <input matInput formControlName="userId" type="number" placeholder="exact ID" />
        </mat-form-field>

        <mat-form-field appearance="outline" class="filter-field filter-date">
          <mat-label>From</mat-label>
          <input matInput formControlName="dateFrom" type="date" />
        </mat-form-field>

        <mat-form-field appearance="outline" class="filter-field filter-date">
          <mat-label>To</mat-label>
          <input matInput formControlName="dateTo" type="date" />
        </mat-form-field>

        <button mat-flat-button color="primary" type="submit">
          <mat-icon>filter_list</mat-icon> Filter
        </button>
        <button mat-stroked-button type="button" (click)="clearFilters()">Clear</button>
      </form>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="36" /></div>
      } @else {
        <div class="table-meta">
          <span>{{ total() }} entries</span>
          <span>Page {{ page() }} of {{ totalPages() }}</span>
        </div>

        <div class="table-wrapper">
          <table class="audit-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Event</th>
                <th>Entity</th>
                <th>Metadata</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              @for (entry of entries(); track entry.id) {
                <tr>
                  <td class="td-time">{{ entry.createdAt | date: 'MM/dd HH:mm:ss' }}</td>
                  <td class="td-user">
                    @if (entry.userId) {
                      <a
                        [routerLink]="['/members', entry.userId]"
                        class="user-link"
                        [appMemberHover]="entry.userId"
                      >
                        {{ entry.userName ?? '—' }}
                      </a>
                      <span class="user-id">#{{ entry.userId }}</span>
                    } @else {
                      <span class="anon">—</span>
                    }
                  </td>
                  <td>
                    <mat-chip [class]="actionClass(entry.action)">{{
                      actionLabel(entry.action)
                    }}</mat-chip>
                  </td>
                  <td class="td-entity">
                    @if (entry.entityType) {
                      <span class="entity-type">{{ entry.entityType }}</span>
                      @if (entry.entityId) {
                        <span class="entity-id">#{{ entry.entityId }}</span>
                      }
                    } @else {
                      <span class="anon">—</span>
                    }
                  </td>
                  <td class="td-meta">
                    @if (entry.metadata) {
                      <span class="meta-text">{{ entry.metadata | json }}</span>
                    } @else {
                      <span class="anon">—</span>
                    }
                  </td>
                  <td class="td-ip">{{ entry.ipAddress ?? '—' }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="empty">No audit entries match your filters.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="pagination">
          <button mat-stroked-button [disabled]="page() <= 1" (click)="goToPage(page() - 1)">
            <mat-icon>chevron_left</mat-icon>
          </button>
          <span>{{ page() }} / {{ totalPages() }}</span>
          <button
            mat-stroked-button
            [disabled]="page() >= totalPages()"
            (click)="goToPage(page() + 1)"
          >
            <mat-icon>chevron_right</mat-icon>
          </button>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .audit-container {
        max-width: 1400px;
        margin: 0 auto;
        padding: 16px;
      }
      h2 {
        margin: 0 0 16px;
      }
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
        margin-bottom: 16px;
      }
      .filter-action {
        width: 200px;
      }
      .filter-user {
        width: 220px;
      }
      .filter-id {
        width: 110px;
      }
      .filter-date {
        width: 150px;
      }
      .table-meta {
        display: flex;
        justify-content: space-between;
        font-size: 0.85rem;
        color: #666;
        margin-bottom: 8px;
      }
      .loading {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
      .table-wrapper {
        overflow-x: auto;
      }
      .audit-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.82rem;
        th {
          text-align: left;
          padding: 8px 10px;
          background: #f5f5f5;
          border-bottom: 2px solid #e0e0e0;
          white-space: nowrap;
        }
        td {
          padding: 6px 10px;
          border-bottom: 1px solid #f0f0f0;
          vertical-align: top;
        }
        tr:hover td {
          background: #fafafa;
        }
      }
      .td-time {
        white-space: nowrap;
        color: #666;
      }
      .td-user {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .user-link {
        color: var(--db-primary);
        text-decoration: none;
        font-weight: 500;
        &:hover {
          text-decoration: underline;
        }
      }
      .user-id {
        font-size: 0.72rem;
        color: #bbb;
        font-family: monospace;
      }
      .anon {
        color: #bbb;
      }
      .td-entity {
        white-space: nowrap;
      }
      .entity-type {
        font-weight: 500;
      }
      .entity-id {
        color: #888;
        margin-left: 4px;
      }
      .td-meta .meta-text {
        display: block;
        max-width: 280px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #555;
        font-family: monospace;
        font-size: 0.78rem;
      }
      .td-ip {
        font-family: monospace;
        color: #888;
        white-space: nowrap;
      }
      .empty {
        text-align: center;
        color: #aaa;
        padding: 32px;
      }
      .pagination {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        margin-top: 16px;
      }
      mat-chip {
        font-size: 0.7rem !important;
        min-height: 20px !important;
      }
      .chip-login {
        background: #e3f2fd !important;
      }
      .chip-ban {
        background: #ffccbc !important;
      }
      .chip-unban {
        background: #c8e6c9 !important;
      }
      .chip-role {
        background: #e8eaf6 !important;
      }
      .chip-suppress {
        background: #fff9c4 !important;
      }
      .chip-delete {
        background: #ffcdd2 !important;
      }
      .chip-warn {
        background: #ffe0b2 !important;
      }
      .chip-rate {
        background: #f3e5f5 !important;
      }
      .chip-default {
        background: #f5f5f5 !important;
      }
    `,
  ],
})
export class AdminAuditComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly actions = AUDIT_ACTIONS.filter(
    (a, i, arr) => arr.findIndex((b) => b.value === a.value) === i,
  );

  readonly loading = signal(true);
  readonly entries = signal<AuditEntry[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly pageSize = 50;

  readonly totalPages = () => Math.max(1, Math.ceil(this.total() / this.pageSize));

  readonly filterForm = new FormGroup({
    action: new FormControl(''),
    userSearch: new FormControl(''),
    userId: new FormControl<number | null>(null),
    dateFrom: new FormControl(''),
    dateTo: new FormControl(''),
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    const f = this.filterForm.value;
    let params = new HttpParams().set('page', this.page()).set('limit', this.pageSize);
    if (f.action) params = params.set('action', f.action);
    if (f.userSearch) params = params.set('userSearch', f.userSearch);
    if (f.userId) params = params.set('userId', f.userId);
    if (f.dateFrom) params = params.set('dateFrom', f.dateFrom);
    if (f.dateTo) params = params.set('dateTo', f.dateTo);

    this.http.get<AuditResponse>('/api/v1/admin/audit', { params }).subscribe({
      next: (res) => {
        this.entries.set(res.data);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  applyFilters(): void {
    this.page.set(1);
    this.load();
  }

  clearFilters(): void {
    this.filterForm.reset({ action: '', userSearch: '', userId: null, dateFrom: '', dateTo: '' });
    this.page.set(1);
    this.load();
  }

  goToPage(p: number): void {
    this.page.set(p);
    this.load();
  }

  actionLabel(action: string): string {
    return AUDIT_ACTIONS.find((a) => a.value === action)?.label ?? action;
  }

  actionClass(action: string): string {
    if (action === 'auth.rate_limited') return 'chip-rate';
    if (action === 'user.login_failed') return 'chip-warn';
    if (action.includes('login') || action.includes('logout') || action.includes('register'))
      return 'chip-login';
    if (
      action.includes('force_ban') ||
      action.includes('admin_delete') ||
      action.includes('hard_deleted')
    )
      return 'chip-delete';
    if (action.includes('ban') && !action.includes('un')) return 'chip-ban';
    if (action.includes('unban')) return 'chip-unban';
    if (action.includes('role')) return 'chip-role';
    if (action.includes('suppress') || action.includes('lift')) return 'chip-suppress';
    return 'chip-default';
  }
}

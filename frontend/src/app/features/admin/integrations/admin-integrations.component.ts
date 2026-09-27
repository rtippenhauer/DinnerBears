import { Component, computed, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  AutomationRole,
  HostCandidate,
  Integration,
  IntegrationsService,
  SyncHost,
} from '../../../core/services/integrations.service';

// Phase 39: automation accounts — Claude's and Muse's. Muse accounts get an
// API token for the /api/v1/muse routes; its plaintext is only ever shown
// here, right after it's issued.
@Component({
  selector: 'app-admin-integrations',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  template: `
    <div class="integrations-container">
      <h2>Automation Accounts</h2>
      <p class="intro">
        Non-person accounts, named <code>&lt;name&gt;-automation</code> and hidden from members and the
        leaderboard. <strong>Muse</strong> accounts get an API token for the Facebook event sync
        (<code>/api/v1/muse</code>, sent as <code>Authorization: Bearer …</code>). Tokens last 60 days, and Muse
        can rotate its own before then. <strong>Claude</strong> accounts use Claude's automation login instead.
        Switch an account between the two from its profile's role picker.
      </p>

      @if (issued(); as t) {
        <div class="issued-token">
          <div class="issued-header">
            <mat-icon>key</mat-icon>
            <strong>New token for {{ t.name }} — copy it now, it won't be shown again.</strong>
          </div>
          <div class="token-row">
            <code class="token-value">{{ t.token }}</code>
            <button mat-stroked-button (click)="copy(t.token)"><mat-icon>content_copy</mat-icon> Copy</button>
          </div>
          <div class="token-meta">Expires {{ t.expiresAt | date: 'mediumDate' }}</div>
          <button mat-button (click)="issued.set(null)">Done</button>
        </div>
      }

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="36" /></div>
      } @else {
        <section class="card">
          <h3>Add an automation account</h3>
          <div class="create-row">
            <mat-form-field appearance="outline" class="name-field">
              <mat-label>Name</mat-label>
              <input matInput [formControl]="nameControl" placeholder="Muse" />
              <mat-hint>Account will be named "{{ nameControl.value || 'Name' }}-automation"</mat-hint>
            </mat-form-field>
            <mat-form-field appearance="outline" class="role-field">
              <mat-label>Type</mat-label>
              <mat-select [formControl]="roleControl">
                <mat-option value="muse">Muse Automation</mat-option>
                <mat-option value="automation">Claude Automation</mat-option>
              </mat-select>
            </mat-form-field>
            <button
              mat-raised-button
              color="primary"
              (click)="create()"
              [disabled]="nameControl.invalid || busy()"
            >
              <mat-icon>add</mat-icon>
              {{ roleControl.value === 'muse' ? 'Create & issue token' : 'Create' }}
            </button>
          </div>
        </section>

        <section class="card">
          <h3>Accounts</h3>
          @if (integrations().length === 0) {
            <p class="empty">No automation accounts yet.</p>
          }
          @for (i of integrations(); track i.userId) {
            <div class="integration-row">
              <div class="integration-info">
                <div class="integration-name">
                  {{ i.name }} <span class="role-chip">{{ roleLabel(i.role) }}</span>
                </div>
                @if (i.role !== 'muse') {
                  <div class="token-meta">No API token — only Muse accounts use one</div>
                } @else if (i.activeToken; as tok) {
                  <div class="token-meta">
                    <code>{{ tok.tokenPrefix }}…</code> · issued {{ tok.createdAt | date: 'mediumDate' }} ·
                    <span [class.expiring]="isExpiringSoon(tok.expiresAt)">expires {{ tok.expiresAt | date: 'mediumDate' }}</span>
                    · last used {{ tok.lastUsedAt ? (tok.lastUsedAt | date: 'short') : 'never' }}
                  </div>
                } @else {
                  <div class="token-meta no-token">No active token — revoked or expired</div>
                }
              </div>
              @if (i.role === 'muse') {
                <div class="integration-actions">
                  <button mat-stroked-button (click)="regenerate(i)" [disabled]="busy()" matTooltip="Revoke the current token and issue a new one">
                    <mat-icon>autorenew</mat-icon> New token
                  </button>
                  @if (i.activeToken) {
                    <button mat-stroked-button color="warn" (click)="revoke(i)" [disabled]="busy()">
                      <mat-icon>block</mat-icon> Revoke
                    </button>
                  }
                </div>
              }
            </div>
          }
        </section>

        <section class="card">
          <h3>Facebook sync host</h3>
          <p class="intro">
            Facebook attendees who don't match a member are recorded as +1 guests on this member's RSVP.
            The sync manages that member's guest list for synced events.
          </p>
          <mat-form-field appearance="outline" class="host-field">
            <mat-label>Sync host</mat-label>
            <mat-select [value]="syncHost()?.id ?? null" (selectionChange)="setHost($event.value)" [disabled]="busy()">
              @for (c of hostCandidates(); track c.id) {
                <mat-option [value]="c.id">{{ c.fullName }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </section>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .integrations-container {
        max-width: 900px;
        margin: 0 auto;
        padding: 16px;
      }
      h2 {
        margin: 0 0 8px;
      }
      h3 {
        margin: 0 0 12px;
        font-size: 1.05rem;
      }
      .intro {
        color: #666;
        font-size: 0.9rem;
        margin: 0 0 16px;
      }
      .loading {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
      .card {
        background: #fff;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.1);
        margin-bottom: 16px;
      }
      .create-row {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        flex-wrap: wrap;
      }
      .create-row button {
        margin-top: 8px;
      }
      .name-field {
        flex: 1;
        min-width: 200px;
      }
      .role-field {
        width: 200px;
      }
      .role-chip {
        display: inline-block;
        font-size: 0.68rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        padding: 1px 6px;
        border-radius: 8px;
        margin-left: 6px;
        background: #ede7f6;
        color: #4527a0;
        vertical-align: middle;
      }
      .host-field {
        width: 100%;
        max-width: 360px;
      }
      .empty {
        color: #999;
        margin: 0;
      }
      .integration-row {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        padding: 12px 0;
        border-bottom: 1px solid #f0ebe3;
      }
      .integration-row:last-child {
        border-bottom: none;
      }
      .integration-info {
        flex: 1;
        min-width: 220px;
      }
      .integration-name {
        font-weight: 600;
        color: var(--db-brown-dark);
      }
      .integration-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .token-meta {
        font-size: 0.8rem;
        color: #777;
        margin-top: 2px;
      }
      .no-token {
        color: #c62828;
      }
      .expiring {
        color: #c62828;
        font-weight: 600;
      }
      .issued-token {
        background: #fff8e7;
        border: 1px solid #f0dca8;
        border-radius: 12px;
        padding: 16px 20px;
        margin-bottom: 16px;
      }
      .issued-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
        color: #6b4226;
      }
      .token-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .token-value {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
        background: #fff;
        border: 1px solid #e8e0d6;
        border-radius: 6px;
        padding: 8px 10px;
        font-size: 0.85rem;
      }
    `,
  ],
})
export class AdminIntegrationsComponent implements OnInit {
  private readonly integrationsService = inject(IntegrationsService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly clipboard = inject(Clipboard);

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly integrations = signal<Integration[]>([]);
  readonly syncHost = signal<SyncHost | null>(null);
  private readonly candidates = signal<HostCandidate[]>([]);
  readonly issued = signal<{ name: string; token: string; expiresAt: string } | null>(null);

  readonly nameControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(2), Validators.maxLength(40), Validators.pattern(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/)],
  });

  readonly roleControl = new FormControl<AutomationRole>('muse', { nonNullable: true });

  readonly hostCandidates = computed(() =>
    this.candidates()
      .filter((c) => c.status === 'active' && c.role !== 'automation' && c.role !== 'muse')
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
  );

  ngOnInit(): void {
    this.load();
    this.integrationsService.hostCandidates().subscribe({
      next: (users) => this.candidates.set(users),
    });
  }

  private load(): void {
    this.integrationsService.list().subscribe({
      next: ({ integrations, syncHost }) => {
        this.integrations.set(integrations);
        this.syncHost.set(syncHost);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Failed to load integrations', 'OK', { duration: 3000 });
      },
    });
  }

  create(): void {
    const name = this.nameControl.value.trim();
    this.busy.set(true);
    this.integrationsService.create(name, this.roleControl.value).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.nameControl.reset();
        if (res.issued) {
          this.issued.set({ name: res.name, token: res.issued.token, expiresAt: res.issued.expiresAt });
        } else {
          this.snackBar.open(`${res.name} created`, 'OK', { duration: 2500 });
        }
        this.load();
      },
      error: (err) => {
        this.busy.set(false);
        this.snackBar.open(err?.error?.message ?? 'Failed to create integration', 'OK', { duration: 4000 });
      },
    });
  }

  regenerate(i: Integration): void {
    if (!confirm(`Issue a new token for ${i.name}? The current token stops working immediately.`)) return;
    this.busy.set(true);
    this.integrationsService.regenerate(i.userId).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.issued.set({ name: i.name, token: res.token, expiresAt: res.expiresAt });
        this.load();
      },
      error: () => {
        this.busy.set(false);
        this.snackBar.open('Failed to issue a new token', 'OK', { duration: 3000 });
      },
    });
  }

  revoke(i: Integration): void {
    if (!confirm(`Revoke ${i.name}'s token? It stops working immediately.`)) return;
    this.busy.set(true);
    this.integrationsService.revoke(i.userId).subscribe({
      next: () => {
        this.busy.set(false);
        this.snackBar.open('Token revoked', 'OK', { duration: 2500 });
        this.load();
      },
      error: () => {
        this.busy.set(false);
        this.snackBar.open('Failed to revoke token', 'OK', { duration: 3000 });
      },
    });
  }

  setHost(userId: number): void {
    this.busy.set(true);
    this.integrationsService.setSyncHost(userId).subscribe({
      next: (host) => {
        this.busy.set(false);
        this.syncHost.set(host);
        this.snackBar.open(`Sync host set to ${host.fullName}`, 'OK', { duration: 2500 });
      },
      error: () => {
        this.busy.set(false);
        this.snackBar.open('Failed to set sync host', 'OK', { duration: 3000 });
      },
    });
  }

  copy(token: string): void {
    this.clipboard.copy(token);
    this.snackBar.open('Token copied', 'OK', { duration: 2000 });
  }

  roleLabel(role: string): string {
    if (role === 'muse') return 'Muse';
    if (role === 'automation') return 'Claude';
    return role; // temporarily elevated for testing (member/moderator/admin)
  }

  isExpiringSoon(expiresAt: string): boolean {
    return new Date(expiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000;
  }
}

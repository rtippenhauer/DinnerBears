import { Component, computed, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FacebookAccount,
  FacebookAccountStatus,
  FacebookAccountsService,
  LinkableMember,
} from '../../../core/services/facebook-accounts.service';

// Phase 39: every Facebook person the sync has seen. Until an account is
// linked to a member it counts as a Facebook-only attendee; once linked, it
// counts through that member's RSVP (and any Attended marks carry over).
@Component({
  selector: 'app-admin-facebook-accounts',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="fb-container">
      <h2>Facebook Accounts</h2>
      <p class="intro">
        People seen on synced Facebook Going lists. Link each to their member account so they count once, through
        their own RSVP. Until then they count as Facebook-only attendees. Attendance marked for them carries over when
        you link them. A member can have more than one Facebook account.
      </p>

      <mat-button-toggle-group [value]="tab()" (change)="tab.set($event.value)" aria-label="Filter">
        <mat-button-toggle value="unmatched">Unmatched ({{ counts().unmatched }})</mat-button-toggle>
        <mat-button-toggle value="linked">Linked ({{ counts().linked }})</mat-button-toggle>
        <mat-button-toggle value="not_member">Not a member ({{ counts().not_member }})</mat-button-toggle>
      </mat-button-toggle-group>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="36" /></div>
      } @else if (visible().length === 0) {
        <p class="empty">
          @switch (tab()) {
            @case ('unmatched') { Nobody waiting to be matched. }
            @case ('linked') { No Facebook accounts linked yet. }
            @default { Nobody marked as not a member. }
          }
        </p>
      } @else {
        <div class="list">
          @for (a of visible(); track a.id) {
            <div class="row">
              <div class="who">
                <div class="name">
                  {{ a.displayName }}
                  @if (a.profileUrl) {
                    <a class="profile" [href]="a.profileUrl" target="_blank" rel="noopener" aria-label="Open Facebook profile">
                      <mat-icon>open_in_new</mat-icon>
                    </a>
                  }
                </div>
                <div class="meta">
                  {{ a.eventCount }} {{ a.eventCount === 1 ? 'dinner' : 'dinners' }}
                  @if (a.lastSeenAt) { · last seen {{ a.lastSeenAt | date: 'mediumDate' }} }
                  @if (a.facebookUserId) { · ID {{ a.facebookUserId }} }
                </div>
                @if (a.member) {
                  <div class="linked-to">
                    <mat-icon>link</mat-icon> {{ a.member.fullName }}
                    @if (a.member.status === 'suspended') {
                      <span class="status-tag">Banned</span>
                    } @else if (a.member.status === 'deleted') {
                      <span class="status-tag">Deleted</span>
                    }
                  </div>
                }
              </div>

              <div class="actions">
                @if (a.status === 'linked') {
                  <button mat-stroked-button (click)="unlink(a)" [disabled]="busyId() === a.id">Unlink</button>
                } @else {
                  @for (s of a.suggestions; track s.id) {
                    <button mat-stroked-button class="suggest" (click)="link(a, s.id, s.fullName)" [disabled]="busyId() === a.id">
                      <mat-icon>person_check</mat-icon> Link to {{ s.fullName }}
                    </button>
                  }
                  @if (pickingId() === a.id) {
                    <mat-form-field appearance="outline" class="picker" subscriptSizing="dynamic">
                      <mat-label>Search members</mat-label>
                      <input
                        matInput
                        [formControl]="search"
                        [matAutocomplete]="auto"
                        [id]="'fb-member-search-' + a.id"
                      />
                      <mat-autocomplete #auto="matAutocomplete" (optionSelected)="link(a, $event.option.value.id, $event.option.value.fullName)">
                        @for (m of matches(); track m.id) {
                          <mat-option [value]="m">{{ m.fullName }}</mat-option>
                        }
                      </mat-autocomplete>
                    </mat-form-field>
                    <button mat-button (click)="pickingId.set(null)">Cancel</button>
                  } @else {
                    <button mat-stroked-button (click)="startPicking(a)" [disabled]="busyId() === a.id">
                      <mat-icon>search</mat-icon> Link to member…
                    </button>
                  }
                  @if (a.status === 'unmatched') {
                    <button mat-button (click)="notMember(a)" [disabled]="busyId() === a.id">Not a member</button>
                  }
                }
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .fb-container {
        max-width: 900px;
        margin: 0 auto;
        padding: 16px;
      }
      h2 {
        margin: 0 0 8px;
      }
      .intro {
        color: #666;
        font-size: 0.9rem;
        margin: 0 0 16px;
        max-width: 70ch;
      }
      .loading {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
      .empty {
        color: #999;
        margin: 24px 0;
      }
      .list {
        margin-top: 16px;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.1);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
        padding: 14px 18px;
        border-bottom: 1px solid #f0ebe3;
      }
      .row:last-child {
        border-bottom: none;
      }
      .who {
        flex: 1 1 240px;
        min-width: 0;
      }
      .name {
        font-weight: 600;
        color: var(--db-brown-dark);
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .profile {
        display: inline-flex;
        color: #1565c0;
      }
      .profile mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
      .meta {
        font-size: 0.8rem;
        color: #777;
        margin-top: 2px;
      }
      .linked-to {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 0.85rem;
        color: #2e7d32;
        margin-top: 4px;
      }
      .linked-to mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .status-tag {
        font-size: 0.68rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        padding: 1px 6px;
        border-radius: 8px;
        background: #ffebee;
        color: #c62828;
      }
      .suggest {
        border-color: #2e7d32 !important;
        color: #2e7d32 !important;
      }
      .picker {
        width: 240px;
        max-width: 100%;
      }
    `,
  ],
})
export class AdminFacebookAccountsComponent implements OnInit {
  private readonly service = inject(FacebookAccountsService);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal(true);
  readonly accounts = signal<FacebookAccount[]>([]);
  readonly tab = signal<FacebookAccountStatus>('unmatched');
  readonly busyId = signal<number | null>(null);
  readonly pickingId = signal<number | null>(null);
  private readonly members = signal<LinkableMember[]>([]);

  readonly search = new FormControl<string | LinkableMember>('', { nonNullable: true });
  private readonly searchValue = toSignal(this.search.valueChanges, { initialValue: '' });

  readonly counts = computed(() => {
    const c = { unmatched: 0, linked: 0, not_member: 0 };
    for (const a of this.accounts()) c[a.status]++;
    return c;
  });

  readonly visible = computed(() => this.accounts().filter((a) => a.status === this.tab()));

  readonly matches = computed(() => {
    const raw = this.searchValue();
    const q = (typeof raw === 'string' ? raw : raw.fullName).trim().toLowerCase();
    return this.members()
      .filter((m) => m.status === 'active' && m.role !== 'automation' && m.role !== 'muse')
      .filter((m) => !q || m.fullName.toLowerCase().includes(q))
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .slice(0, 20);
  });

  ngOnInit(): void {
    this.load();
    this.service.members().subscribe({ next: (m) => this.members.set(m) });
  }

  private load(): void {
    this.service.list().subscribe({
      next: (list) => {
        this.accounts.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Failed to load Facebook accounts', 'OK', { duration: 3000 });
      },
    });
  }

  startPicking(a: FacebookAccount): void {
    this.search.setValue('');
    this.pickingId.set(a.id);
  }

  link(a: FacebookAccount, userId: number, fullName: string): void {
    this.act(a, this.service.link(a.id, userId), `${a.displayName} linked to ${fullName}`);
  }

  unlink(a: FacebookAccount): void {
    this.act(a, this.service.unlink(a.id), `${a.displayName} unlinked`);
  }

  notMember(a: FacebookAccount): void {
    this.act(a, this.service.markNotMember(a.id), `${a.displayName} marked as not a member`);
  }

  private act(a: FacebookAccount, call: ReturnType<FacebookAccountsService['unlink']>, done: string): void {
    this.busyId.set(a.id);
    call.subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.pickingId.set(null);
        this.accounts.update((list) => list.map((x) => (x.id === updated.id ? updated : x)));
        this.snackBar.open(done, 'OK', { duration: 2500 });
      },
      error: (err) => {
        this.busyId.set(null);
        this.snackBar.open(err?.error?.message ?? 'That didn’t work — try again', 'OK', { duration: 3500 });
      },
    });
  }
}

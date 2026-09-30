import {
  Component,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { debounceTime, distinctUntilChanged, Subject, switchMap } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  AttendanceEntry,
  EventCommentsService,
  MemberSearchResult,
} from '../../../core/services/event-comments.service';

export interface AttendanceDialogData {
  eventId: number;
  // "Add to Going" (RSVP on someone's behalf) is admin-only; moderators still
  // get Add Walk-in.
  isAdmin?: boolean;
}

type AddMode = 'walkin' | 'going';

@Component({
  selector: 'app-attendance-dialog',
  standalone: true,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title><mat-icon>how_to_reg</mat-icon> Attendance</h2>
    <mat-dialog-content>
      @if (attendanceLoading()) {
        <div class="att-loading"><mat-spinner diameter="24" /></div>
      } @else {
        @if (attendanceList().length === 0) {
          <p class="no-attendance">No Going RSVPs for this event.</p>
        }
        <div class="attendance-list">
          @for (
            entry of attendanceList();
            track entry.type === 'member'
              ? 'm' + entry.userId
              : entry.type === 'facebook'
                ? 'f' + entry.facebookAttendeeId
                : 'g' + entry.guestLinkId
          ) {
            <div class="attendance-row" [class.att-guest-row]="entry.type === 'guest'">
              <span class="att-name">
                {{ entry.memberName }}
                @if (entry.isWalkin) {
                  <span class="walkin-badge">Walk-in</span>
                }
                @if (entry.source === 'facebook_sync') {
                  <span class="source-badge" matTooltip="Marked Going by the Facebook sync">Facebook</span>
                } @else if (entry.source === 'admin') {
                  <span class="source-badge" matTooltip="Added to Going by an admin">Added</span>
                }
                @if (entry.type === 'facebook') {
                  <span class="source-badge" matTooltip="Going on Facebook, not linked to a member yet">Facebook</span>
                }
                @if (entry.type === 'guest') {
                  <span class="guest-badge">Guest</span>
                  @if (!entry.linkUsed) {
                    <span class="guest-pending-badge">Link not used</span>
                  }
                }
              </span>
              @if (entry.type === 'member') {
                <label class="att-out-of-town">
                  <input
                    type="checkbox"
                    [checked]="entry.fromOtherCity"
                    (change)="setFromOtherCity(entry.userId!, $any($event.target).checked)"
                  />
                  Out of town
                </label>
                <div class="att-btns">
                  <button
                    mat-stroked-button
                    [class.att-yes]="entry.attended === true"
                    (click)="setAttended(entry.userId!, true)"
                  >
                    <mat-icon>check</mat-icon> Attended
                  </button>
                  <button
                    mat-stroked-button
                    [class.att-no]="entry.attended === false"
                    (click)="setAttended(entry.userId!, false)"
                  >
                    <mat-icon>close</mat-icon> No-show
                  </button>
                </div>
              } @else if (entry.type === 'facebook') {
                <div class="att-btns">
                  <button
                    mat-stroked-button
                    [class.att-yes]="entry.attended === true"
                    (click)="setFacebookAttended(entry.facebookAttendeeId!, true)"
                  >
                    <mat-icon>check</mat-icon> Attended
                  </button>
                  <button
                    mat-stroked-button
                    [class.att-no]="entry.attended === false"
                    (click)="setFacebookAttended(entry.facebookAttendeeId!, false)"
                  >
                    <mat-icon>close</mat-icon> No-show
                  </button>
                </div>
              } @else {
                <div class="att-btns">
                  <button
                    mat-stroked-button
                    [class.att-yes]="entry.attended === true"
                    (click)="setGuestAttended(entry.guestLinkId!, true)"
                  >
                    <mat-icon>check</mat-icon> Attended
                  </button>
                  <button
                    mat-stroked-button
                    [class.att-no]="entry.attended === false"
                    (click)="setGuestAttended(entry.guestLinkId!, false)"
                  >
                    <mat-icon>close</mat-icon> No-show
                  </button>
                  @if (entry.recipientEmail) {
                    <button
                      mat-icon-button
                      matTooltip="Resend invite email"
                      (click)="resendGuestInvite(entry.guestLinkId!)"
                    >
                      <mat-icon>send</mat-icon>
                    </button>
                  }
                </div>
              }
            </div>
          }
        </div>

        @if (addMode()) {
          <div class="walkin-form" #walkinFormEl>
            <div class="add-mode-label">
              {{ addMode() === 'going' ? 'Add to Going — RSVPs them and sends a confirmation' : 'Add Walk-in — marks them attended' }}
            </div>
            <mat-form-field appearance="outline" class="walkin-search-field">
              <mat-label>Search member by name</mat-label>
              <input
                matInput
                [value]="walkinSearch()"
                (input)="onWalkinSearchInput($any($event.target).value)"
                autocomplete="off"
              />
              <mat-icon matSuffix>search</mat-icon>
            </mat-form-field>
            @if (walkinResults().length > 0) {
              <div class="walkin-results" #walkinResultsEl>
                @for (m of walkinResults(); track m.id) {
                  <button
                    mat-button
                    class="walkin-result-row"
                    (click)="selectWalkin(m)"
                    [disabled]="addingWalkin()"
                  >
                    <mat-icon>person</mat-icon> {{ m.fullName }}
                  </button>
                }
              </div>
            }
          </div>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (!attendanceLoading()) {
        @if (data.isAdmin) {
          <button mat-stroked-button (click)="toggleAddMode('going')">
            <mat-icon>event_available</mat-icon> Add to Going
          </button>
        }
        <button mat-stroked-button (click)="toggleAddMode('walkin')">
          <mat-icon>person_add</mat-icon> Add Walk-in
        </button>
      }
      <button mat-button mat-dialog-close>Close</button>
      @if (!attendanceLoading() && attendanceList().length > 0) {
        <button
          mat-raised-button
          color="primary"
          (click)="saveAttendance()"
          [disabled]="savingAttendance()"
        >
          @if (savingAttendance()) {
            <mat-spinner diameter="16" />
          }
          Save Attendance
        </button>
      }
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      mat-dialog-content {
        min-width: 320px;
      }
      .att-loading {
        display: flex;
        justify-content: center;
        padding: 16px;
      }
      .no-attendance {
        color: #999;
        font-size: 0.9rem;
        margin: 0;
      }
      .attendance-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .attendance-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        padding: 8px;
        border-bottom: 1px solid #f0ebe3;
      }
      .att-name {
        font-size: 0.95rem;
        font-weight: 500;
        color: var(--db-brown-dark);
        flex: 1;
      }
      .att-out-of-town {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 0.8rem;
        color: #555;
        white-space: nowrap;
      }
      .att-btns {
        display: flex;
        gap: 8px;
      }
      .att-yes {
        border-color: #2e7d32 !important;
        color: #2e7d32 !important;
        background: #e8f5e9 !important;
      }
      .att-no {
        border-color: #c62828 !important;
        color: #c62828 !important;
        background: #ffebee !important;
      }
      .walkin-badge,
      .guest-badge,
      .guest-pending-badge {
        display: inline-block;
        font-size: 0.68rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        padding: 1px 6px;
        border-radius: 8px;
        margin-left: 6px;
      }
      .source-badge {
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
      }
      .add-mode-label {
        font-size: 0.8rem;
        color: #666;
        margin-bottom: 8px;
      }
      .walkin-badge {
        background: #fff3e0;
        color: var(--db-amber-dark, #b8832e);
      }
      .guest-badge {
        background: #e3f2fd;
        color: #1565c0;
      }
      .guest-pending-badge {
        background: #fce4ec;
        color: #c62828;
      }
      .att-guest-row {
        background: #fafcff;
        border-radius: 4px;
        padding-left: 6px;
      }
      .walkin-form {
        margin-top: 12px;
        border-top: 1px dashed #e8e0d6;
        padding-top: 12px;
      }
      .walkin-search-field {
        width: 100%;
      }
      .walkin-results {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 180px;
        overflow-y: auto;
      }
      .walkin-result-row {
        justify-content: flex-start;
      }
    `,
  ],
})
export class AttendanceDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<AttendanceDialogComponent>);
  private readonly commentsService = inject(EventCommentsService);
  private readonly snackBar = inject(MatSnackBar);
  readonly data = inject<AttendanceDialogData>(MAT_DIALOG_DATA);

  readonly attendanceList = signal<AttendanceEntry[]>([]);
  readonly attendanceLoading = signal(false);
  readonly savingAttendance = signal(false);
  readonly addMode = signal<AddMode | null>(null);
  readonly walkinSearch = signal('');
  readonly walkinResults = signal<MemberSearchResult[]>([]);
  readonly addingWalkin = signal(false);
  private readonly walkinSearch$ = new Subject<string>();

  private readonly walkinFormEl = viewChild<ElementRef<HTMLElement>>('walkinFormEl');
  private readonly walkinResultsEl = viewChild<ElementRef<HTMLElement>>('walkinResultsEl');

  constructor() {
    this.walkinSearch$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        // Both modes exclude members already Going — they're on the list.
        switchMap((q) => this.commentsService.searchMembers(this.data.eventId, q)),
      )
      .subscribe((results) => this.walkinResults.set(results));
    this.loadAttendance();

    effect(() => {
      if (this.addMode()) {
        this.walkinFormEl()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
    effect(() => {
      if (this.walkinResults().length > 0) {
        this.walkinResultsEl()?.nativeElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    });
  }

  private loadAttendance(): void {
    this.attendanceLoading.set(true);
    this.commentsService.getAttendance(this.data.eventId).subscribe({
      next: (list) => {
        this.attendanceList.set(list);
        this.attendanceLoading.set(false);
      },
      error: () => this.attendanceLoading.set(false),
    });
  }

  setAttended(userId: number, attended: boolean): void {
    this.attendanceList.update((list) =>
      list.map((e) => (e.userId === userId ? { ...e, attended } : e)),
    );
  }

  setFromOtherCity(userId: number, fromOtherCity: boolean): void {
    this.attendanceList.update((list) =>
      list.map((e) => (e.userId === userId ? { ...e, fromOtherCity } : e)),
    );
  }

  setGuestAttended(guestLinkId: number, attended: boolean): void {
    this.commentsService.markGuestAttendance(guestLinkId, attended).subscribe({
      next: () => {
        this.attendanceList.update((list) =>
          list.map((e) => (e.guestLinkId === guestLinkId ? { ...e, attended } : e)),
        );
      },
      error: () =>
        this.snackBar.open('Failed to update guest attendance', 'OK', { duration: 3000 }),
    });
  }

  // Saved straight away like guest rows. No points until the Facebook
  // account is linked to a member — then this carries over.
  setFacebookAttended(facebookAttendeeId: number, attended: boolean): void {
    this.commentsService.markFacebookAttendance(facebookAttendeeId, attended).subscribe({
      next: () => {
        this.attendanceList.update((list) =>
          list.map((e) => (e.facebookAttendeeId === facebookAttendeeId ? { ...e, attended } : e)),
        );
      },
      error: () =>
        this.snackBar.open('Failed to update Facebook attendance', 'OK', { duration: 3000 }),
    });
  }

  resendGuestInvite(guestLinkId: number): void {
    this.commentsService.resendGuestInvite(guestLinkId).subscribe({
      next: () => this.snackBar.open('Invite resent!', 'OK', { duration: 2500 }),
      error: () => this.snackBar.open('Failed to resend invite', 'OK', { duration: 3000 }),
    });
  }

  onWalkinSearchInput(value: string): void {
    this.walkinSearch.set(value);
    this.walkinSearch$.next(value);
  }

  toggleAddMode(mode: AddMode): void {
    this.addMode.set(this.addMode() === mode ? null : mode);
    this.walkinSearch.set('');
    this.walkinResults.set([]);
  }

  selectWalkin(member: MemberSearchResult): void {
    const mode = this.addMode() ?? 'walkin';
    this.addingWalkin.set(true);
    const add$ =
      mode === 'going'
        ? this.commentsService.addGoing(this.data.eventId, member.id)
        : this.commentsService.addWalkin(this.data.eventId, member.id);
    add$.subscribe({
      next: (entry) => {
        this.attendanceList.update((list) => {
          const existing = list.findIndex((e) => e.userId === entry.userId);
          if (existing >= 0) {
            const updated = [...list];
            updated[existing] = entry;
            return updated;
          }
          return [...list, entry];
        });
        this.addMode.set(null);
        this.walkinSearch.set('');
        this.walkinResults.set([]);
        this.addingWalkin.set(false);
        const done = mode === 'going' ? 'marked Going' : 'added as walk-in';
        this.snackBar.open(`${member.fullName} ${done}`, 'OK', { duration: 3000 });
      },
      error: (err) => {
        this.addingWalkin.set(false);
        const fallback = mode === 'going' ? 'Failed to add to Going' : 'Failed to add walk-in';
        this.snackBar.open(err?.error?.message ?? fallback, 'OK', { duration: 3000 });
      },
    });
  }

  saveAttendance(): void {
    const attendances = this.attendanceList()
      .filter((e) => e.type === 'member' && e.attended !== null)
      .map((e) => ({
        userId: e.userId!,
        attended: e.attended as boolean,
        fromOtherCity: e.fromOtherCity,
      }));
    this.savingAttendance.set(true);
    this.commentsService.markAttendance(this.data.eventId, attendances).subscribe({
      next: () => {
        this.savingAttendance.set(false);
        this.snackBar.open('Attendance saved', 'OK', { duration: 2000 });
      },
      error: () => {
        this.savingAttendance.set(false);
        this.snackBar.open('Failed to save attendance', 'OK', { duration: 3000 });
      },
    });
  }
}

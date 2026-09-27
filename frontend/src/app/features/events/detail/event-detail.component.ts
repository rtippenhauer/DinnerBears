import {
  Component,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { forkJoin } from 'rxjs';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe, TitleCasePipe } from '@angular/common';
import {
  FormArray,
  FormControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
} from '@angular/forms';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  EventsService,
  Event,
  GuestLink,
  Rsvp,
  RsvpStatus,
} from '../../../core/services/events.service';
import { AuthService } from '../../../core/services/auth.service';
import { BrandConfigService } from '../../../core/services/brand-config.service';
import { CommunityService, EventAchievement } from '../../../core/services/community.service';
import {
  EventCommentsService,
  Comment,
  MemberSearchResult,
} from '../../../core/services/event-comments.service';
import { debounceTime, distinctUntilChanged, Subject, switchMap } from 'rxjs';
import { EventFormDialogComponent } from '../form/event-form-dialog.component';
import { ReportButtonComponent } from '../../../shared/components/report-button/report-button.component';
import { HasUnsavedChanges } from '../../../core/guards/unsaved-changes.guard';
import { ShareInvitesDialogComponent } from './share-invites-dialog.component';
import { AttendanceDialogComponent } from './attendance-dialog.component';
import { AchievementAdminDialogComponent } from './achievement-admin-dialog.component';
import { formatEventTime, initials as sharedInitials } from '../../../shared/utils/format-event';

@Component({
  selector: 'app-event-detail',
  standalone: true,
  imports: [
    DatePipe,
    TitleCasePipe,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatChipsModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTooltipModule,
    ReportButtonComponent,
  ],
  template: `
    @if (loading()) {
      <div class="center"><mat-spinner /></div>
    } @else if (event()) {
      <div class="detail-layout">
        <!-- Photo -->
        @if (event()!.location?.photos?.length) {
          <div class="hero-photo">
            <img [src]="event()!.location!.photos[0].filePath" [alt]="event()!.locationName" />
          </div>
        } @else if (isPrivateHidden()) {
          <div class="hero-photo hero-private">
            <mat-icon>lock</mat-icon>
            <span>Photo available after you RSVP Going</span>
          </div>
        }

        <div class="detail-content">
          <!-- Status chip -->
          @if (event()!.status !== 'published') {
            <div class="status-row">
              <mat-chip [class]="'status-chip status-' + event()!.status">
                {{ event()!.status | titlecase }}
              </mat-chip>
            </div>
          }

          <!-- Title & date -->
          <div class="title-row">
            <h1 class="event-title">{{ event()!.title }}</h1>
            @if (isAdminOrMod()) {
              <button
                mat-icon-button
                class="admin-menu-btn"
                [matMenuTriggerFor]="adminMenu"
                matTooltip="Admin tools"
                aria-label="Admin tools menu"
              >
                <mat-icon>more_vert</mat-icon>
              </button>
              <mat-menu #adminMenu="matMenu">
                @if (event()!.status === 'published') {
                  <button mat-menu-item (click)="openShareInvitesDialog()">
                    <mat-icon>share</mat-icon> Share &amp; Invite Links
                  </button>
                }
                @if (isPastEvent() && event()!.status === 'published') {
                  <button mat-menu-item (click)="openAttendanceDialog()">
                    <mat-icon>how_to_reg</mat-icon> Attendance
                  </button>
                }
                @if (isAdmin()) {
                  <button mat-menu-item (click)="openAchievementAdminDialog()">
                    <mat-icon>local_activity</mat-icon> Special {{ brand.dinnerSingular() }} Achievement
                  </button>
                }
              </mat-menu>
            }
          </div>
          <div class="event-datetime">
            <mat-icon>event</mat-icon>
            <span
              >{{ event()!.eventDate + 'T12:00:00' | date: 'EEEE, MMMM d, y' }} at
              {{ formatTime(event()!.eventTime) }}</span
            >
            @if (event()!.status === 'published') {
              <button mat-stroked-button class="cal-add-btn" [matMenuTriggerFor]="calMenu">
                <mat-icon>calendar_add_on</mat-icon> Add to Calendar
              </button>
              <mat-menu #calMenu="matMenu">
                <a mat-menu-item [href]="googleCalendarUrl()" target="_blank" rel="noopener">
                  <mat-icon>event</mat-icon> Google Calendar
                </a>
                <a mat-menu-item [href]="appleCalendarUrl()" target="_blank" rel="noopener">
                  <mat-icon>calendar_today</mat-icon> Apple Calendar
                </a>
                <a mat-menu-item [href]="icsUrl()" download>
                  <mat-icon>download</mat-icon> Download .ics
                </a>
              </mat-menu>
            }
          </div>

          <!-- Special dinner achievement badge (public) -->
          @if (eventAchievement()) {
            <div class="special-dinner-badge">
              @if (eventAchievement()!.icon.startsWith('img:')) {
                <img
                  class="special-dinner-icon-img"
                  [src]="eventAchievement()!.icon.slice(4)"
                  alt=""
                />
              } @else {
                <mat-icon>{{ eventAchievement()!.icon || 'local_activity' }}</mat-icon>
              }
              <div class="special-dinner-text">
                <span class="special-dinner-label">Special {{ brand.dinnerSingular() }}</span>
                <span class="special-dinner-name">{{ eventAchievement()!.name }}</span>
                <span class="special-dinner-desc">{{ eventAchievement()!.description }}</span>
                @if (eventAchievement()!.title) {
                  <span class="special-dinner-title"
                    >Earns title: "{{ eventAchievement()!.title }}"</span
                  >
                }
              </div>
              @if (eventAchievement()!.imagePath) {
                <img
                  [src]="eventAchievement()!.imagePath!"
                  class="special-dinner-img"
                  alt="Achievement"
                />
              }
            </div>
          }

          <!-- Restaurant info -->
          <mat-card class="info-card">
            <mat-card-content>
              <div class="info-row">
                <mat-icon>restaurant</mat-icon>
                <div>
                  <div class="info-label">{{ brand.locationSingular() }}</div>
                  @if (event()!.location?.websiteUrl) {
                    <a
                      class="info-value map-link"
                      [href]="event()!.location!.websiteUrl!"
                      target="_blank"
                      rel="noopener"
                    >
                      {{ event()!.locationName }}
                    </a>
                  } @else {
                    <div class="info-value">{{ event()!.locationName }}</div>
                  }
                </div>
              </div>
              <div class="info-row">
                <mat-icon>location_on</mat-icon>
                <div>
                  <div class="info-label">Address</div>
                  @if (event()!.locationAddress) {
                    <a
                      class="info-value map-link"
                      [href]="mapsUrl()"
                      target="_blank"
                      rel="noopener"
                      >{{ event()!.locationAddress }}</a
                    >
                  } @else {
                    <div class="info-value address-hidden">
                      <mat-icon class="lock-icon">lock</mat-icon> Available after you RSVP Going
                    </div>
                  }
                </div>
              </div>
            </mat-card-content>
          </mat-card>

          <!-- Reservation status — members only (not guest/non-validated accounts) -->
          @if (isLoggedIn() && !isNonValidated() && event()!.status === 'published') {
            @if (event()!.reservationConfirmed) {
              <div class="reservation-confirmed-badge">
                <mat-icon>check_circle</mat-icon>
                <div class="res-badge-text">
                  <span>Reservation Confirmed</span>
                  @if (event()!.reservationConfirmedBy) {
                    <span class="res-badge-by">by {{ event()!.reservationConfirmedBy }}</span>
                  }
                  @if (event()!.reservationConfirmedNote) {
                    <span class="res-badge-note">"{{ event()!.reservationConfirmedNote }}"</span>
                  }
                </div>
              </div>
            } @else if (event()!.reservationAssigneeId || event()!.reservationContactName) {
              <div class="reservation-pending-badge">
                <mat-icon>hourglass_empty</mat-icon>
                <span>
                  Reservation being handled by
                  <strong>{{
                    event()!.reservationAssignee?.fullName ?? event()!.reservationContactName
                  }}</strong>
                </span>
              </div>
            }

            <!-- Assignee self-confirm button (for the logged-in member who was assigned) -->
            @if (
              event()!.reservationAssigneeId === currentUserId() &&
              !event()!.reservationConfirmed &&
              !isAdminOrMod()
            ) {
              <div class="assignee-confirm-banner">
                <mat-icon>phone</mat-icon>
                <span>You've been asked to make the reservation for this event.</span>
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="reservationSaving()"
                  (click)="memberMarkReservationConfirmed()"
                >
                  @if (reservationSaving()) {
                    <mat-spinner diameter="16" />
                  } @else {
                    <mat-icon>check</mat-icon>
                  }
                  I Made the Reservation
                </button>
              </div>
            }
          }

          <!-- Description -->
          @if (event()!.description) {
            <div class="section">
              <h3>About this event</h3>
              <p class="description">{{ event()!.description }}</p>
            </div>
          }

          <!-- Additional info -->
          @if (event()!.additionalInfo) {
            <div class="section">
              <h3>Additional info</h3>
              <p class="description">{{ event()!.additionalInfo }}</p>
            </div>
          }

          <!-- Cancelled reason -->
          @if (event()!.status === 'cancelled' && event()!.cancelledReason) {
            <div class="cancelled-reason">
              <mat-icon>cancel</mat-icon>
              <span>{{ event()!.cancelledReason }}</span>
            </div>
          }

          <!-- RSVP section (published events only) -->
          @if (event()!.status === 'published') {
            <mat-card class="rsvp-card">
              <mat-card-content>
                <div class="rsvp-header">
                  <h3>Who's coming</h3>
                  <div class="rsvp-counts">
                    <span class="seat-count"
                      >{{ totalSeats() }} seat{{ totalSeats() === 1 ? '' : 's' }} needed</span
                    >
                    @if (maybeCount() > 0) {
                      <span class="maybe-count">{{ maybeCount() }} maybe</span>
                    }
                  </div>
                </div>

                <!-- Timing & deadline info -->
                <div class="rsvp-disclaimer">
                  <div class="disclaimer-row">
                    <mat-icon class="disc-icon">schedule</mat-icon>
                    <span
                      >RSVP deadline: <strong>{{ cutoffTimeLabel() }}</strong> day-of</span
                    >
                  </div>
                </div>

                <!-- RSVP action for logged-in members -->
                @if (isLoggedIn()) {
                  <div class="rsvp-action">
                    @if (isPastEvent()) {
                      <div class="cutoff-banner">
                        <mat-icon>event_busy</mat-icon>
                        <span>This event has already passed</span>
                      </div>
                    } @else if (myRsvp()) {
                      <div class="rsvp-controls">
                        <!-- Three-state toggle -->
                        <mat-button-toggle-group
                          [value]="myRsvp()!.status"
                          (change)="onRsvpStatusChange($event.value)"
                          [disabled]="rsvpLoading()"
                          class="rsvp-toggle"
                        >
                          <mat-button-toggle
                            value="going"
                            class="toggle-going"
                            [disabled]="
                              !isAdminOrMod() && isPastCutoff() && myRsvp()!.status !== 'going'
                            "
                          >
                            <mat-icon>check_circle</mat-icon> Going
                          </mat-button-toggle>
                          <mat-button-toggle value="maybe" class="toggle-maybe">
                            <mat-icon>help_outline</mat-icon> Maybe
                          </mat-button-toggle>
                          <mat-button-toggle value="not_going" class="toggle-not-going">
                            <mat-icon>cancel</mat-icon> Not Going
                          </mat-button-toggle>
                        </mat-button-toggle-group>

                        @if (myRsvp()!.status === 'going' && !isNonValidated()) {
                          <mat-select
                            [formControl]="guestsCtrl"
                            class="guests-select"
                            (selectionChange)="updateGuests($event.value)"
                          >
                            <mat-option [value]="0">Just me</mat-option>
                            @for (n of guestOptions.slice(1); track n) {
                              <mat-option
                                [value]="n"
                                [disabled]="
                                  !isAdminOrMod() &&
                                  isPastCutoff() &&
                                  n > myRsvp()!.additionalGuests
                                "
                              >
                                +{{ n }} guest{{ n === 1 ? '' : 's' }}
                              </mat-option>
                            }
                          </mat-select>
                        }
                      </div>

                      @if (myRsvp()!.status === 'going' && isResidenceEvent() && !isNonValidated()) {
                        <mat-form-field appearance="outline" class="bringing-field">
                          <mat-label>What are you bringing? (optional)</mat-label>
                          <input
                            matInput
                            [formControl]="bringingCtrl"
                            maxlength="200"
                            (blur)="updateBringingItem()"
                          />
                        </mat-form-field>
                      }

                      <!-- Guest panel -->
                      @if (myRsvp()!.additionalGuests > 0 && !isNonValidated()) {
                        <div class="guest-panel">
                          <div class="guest-panel-header">
                            <mat-icon class="guest-panel-icon">group_add</mat-icon>
                            <span class="guest-panel-title">Your Guests</span>
                          </div>

                          <div class="guest-compact-list">
                            @for (idx of guestIndices; track idx) {
                              <div class="guest-compact-row">
                                <mat-icon
                                  class="guest-row-icon"
                                  [class.link-ready-icon]="
                                    guestLinkAt(myRsvp()!, idx) &&
                                    !guestLinkAt(myRsvp()!, idx)?.usedAt &&
                                    !guestLinkAt(myRsvp()!, idx)?.cancelledAt
                                  "
                                  [class.link-used-icon]="
                                    guestLinkAt(myRsvp()!, idx)?.usedAt &&
                                    !guestLinkAt(myRsvp()!, idx)?.cancelledAt
                                  "
                                  [class.link-cancelled-icon]="
                                    !!guestLinkAt(myRsvp()!, idx)?.cancelledAt
                                  "
                                >
                                  {{
                                    guestLinkAt(myRsvp()!, idx)?.cancelledAt
                                      ? 'person_off'
                                      : guestLinkAt(myRsvp()!, idx)?.usedAt
                                        ? 'how_to_reg'
                                        : guestLinkAt(myRsvp()!, idx)
                                          ? 'link'
                                          : 'person_outline'
                                  }}
                                </mat-icon>
                                <span
                                  class="guest-compact-name"
                                  [class.unnamed]="!guestNameControls[idx].value.trim()"
                                >
                                  {{ guestNameControls[idx].value.trim() || 'Guest ' + (idx + 1) }}
                                </span>
                                @if (guestLinkAt(myRsvp()!, idx); as link) {
                                  <span
                                    class="link-status-badge"
                                    [class.used]="link.usedAt && !link.cancelledAt"
                                    [class.cancelled]="link.cancelledAt"
                                  >
                                    {{
                                      link.cancelledAt
                                        ? "Can't Make It"
                                        : link.usedAt
                                          ? 'Confirmed'
                                          : 'Pending'
                                    }}
                                  </span>
                                }
                                <div class="guest-row-actions">
                                  <button
                                    mat-icon-button
                                    class="copy-link-btn"
                                    [matTooltip]="guestLinkTooltip(idx)"
                                    [disabled]="generatingLinkIndex() === idx"
                                    (click)="generateAndCopyLink(idx)"
                                  >
                                    @if (generatingLinkIndex() === idx) {
                                      <mat-spinner diameter="16" />
                                    } @else if (guestLinkAt(myRsvp()!, idx)?.cancelledAt) {
                                      <mat-icon class="link-cancelled-icon">person_off</mat-icon>
                                    } @else if (guestLinkAt(myRsvp()!, idx)?.usedAt) {
                                      <mat-icon class="link-used-icon">how_to_reg</mat-icon>
                                    } @else if (guestLinkAt(myRsvp()!, idx)) {
                                      <mat-icon class="link-ready-icon">content_copy</mat-icon>
                                    } @else {
                                      <mat-icon>link</mat-icon>
                                    }
                                  </button>
                                  <button
                                    mat-icon-button
                                    class="edit-guest-btn"
                                    matTooltip="Edit guest"
                                    (click)="toggleEditGuest(idx)"
                                  >
                                    <mat-icon>{{
                                      editingGuestIndex() === idx ? 'close' : 'edit'
                                    }}</mat-icon>
                                  </button>
                                  @if (guestLinkAt(myRsvp()!, idx)) {
                                    <button
                                      mat-icon-button
                                      class="remove-link-btn"
                                      matTooltip="Remove guest"
                                      [disabled]="
                                        removingLinkId() === guestLinkAt(myRsvp()!, idx)!.id
                                      "
                                      (click)="removeLink(guestLinkAt(myRsvp()!, idx)!.id)"
                                    >
                                      @if (removingLinkId() === guestLinkAt(myRsvp()!, idx)!.id) {
                                        <mat-spinner diameter="16" />
                                      } @else {
                                        <mat-icon>person_remove</mat-icon>
                                      }
                                    </button>
                                  }
                                </div>
                              </div>

                              @if (editingGuestIndex() === idx) {
                                <div class="guest-edit-expansion">
                                  <mat-form-field appearance="outline" class="guest-name-field">
                                    <mat-label>Name (optional)</mat-label>
                                    <input
                                      matInput
                                      [formControl]="guestNameControls[idx]"
                                      maxlength="200"
                                    />
                                  </mat-form-field>
                                  @if (!guestLinkAt(myRsvp()!, idx)) {
                                    <mat-form-field appearance="outline" class="guest-email-field">
                                      <mat-label>Email (optional)</mat-label>
                                      <mat-icon matPrefix>mail_outline</mat-icon>
                                      <input
                                        matInput
                                        [formControl]="guestEmailControls[idx]"
                                        type="email"
                                        maxlength="255"
                                      />
                                    </mat-form-field>
                                  }
                                  <div class="guest-edit-save-row">
                                    <button
                                      mat-icon-button
                                      color="primary"
                                      matTooltip="Save"
                                      [disabled]="savingNames()"
                                      (click)="saveAndCloseEdit()"
                                    >
                                      @if (savingNames()) {
                                        <mat-spinner diameter="18" />
                                      } @else {
                                        <mat-icon>check</mat-icon>
                                      }
                                    </button>
                                  </div>
                                </div>
                              }
                            }
                          </div>
                        </div>
                      }
                    } @else {
                      @if (!isAdminOrMod() && isPastCutoff()) {
                        <div class="cutoff-banner">
                          <mat-icon>lock_clock</mat-icon>
                          <span>RSVP closed — deadline was {{ cutoffTimeLabel() }} today</span>
                        </div>
                      } @else {
                        <div class="rsvp-initial-toggle">
                          <mat-button-toggle-group class="rsvp-toggle" [disabled]="rsvpLoading()">
                            <mat-button-toggle
                              value="going"
                              class="toggle-going"
                              (click)="addRsvp('going')"
                            >
                              <mat-icon>check_circle</mat-icon> Going
                            </mat-button-toggle>
                            <mat-button-toggle
                              value="maybe"
                              class="toggle-maybe"
                              (click)="addRsvp('maybe')"
                            >
                              <mat-icon>help_outline</mat-icon> Maybe
                            </mat-button-toggle>
                          </mat-button-toggle-group>
                        </div>
                      }
                    }
                  </div>
                } @else {
                  <div class="rsvp-guest-cta">
                    <a mat-stroked-button routerLink="/login">Sign in to RSVP</a>
                    <span class="rsvp-or">or</span>
                    @if (publicRsvpDone()) {
                      <div class="public-rsvp-success">
                        <mat-icon>check_circle</mat-icon>
                        You're on the list! Check your email for your confirmation link.
                      </div>
                    } @else {
                      <div class="public-rsvp-form">
                        <p class="public-rsvp-label">Attending without an account?</p>
                        <div class="public-rsvp-fields">
                          <mat-form-field appearance="outline" class="pub-field">
                            <mat-label>Your name</mat-label>
                            <input
                              matInput
                              [value]="publicRsvpName()"
                              (input)="publicRsvpName.set($any($event.target).value)"
                              maxlength="200"
                            />
                          </mat-form-field>
                          <mat-form-field appearance="outline" class="pub-field">
                            <mat-label>Email address</mat-label>
                            <input
                              matInput
                              type="email"
                              [value]="publicRsvpEmail()"
                              (input)="publicRsvpEmail.set($any($event.target).value)"
                              maxlength="255"
                            />
                          </mat-form-field>
                        </div>
                        @if (publicRsvpError()) {
                          <div class="public-rsvp-error">{{ publicRsvpError() }}</div>
                        }
                        <button
                          mat-stroked-button
                          [disabled]="
                            publicRsvpLoading() ||
                            !publicRsvpName().trim() ||
                            !publicRsvpEmail().trim()
                          "
                          (click)="submitPublicRsvp()"
                        >
                          @if (publicRsvpLoading()) {
                            <mat-spinner diameter="16" />
                          }
                          I'm going!
                        </button>
                      </div>
                    }
                  </div>
                }

                <mat-divider class="rsvp-divider" />

                <!-- Attendee list -->
                @if (
                  event()!.rsvps.length === 0 &&
                  event()!.publicRsvps.length === 0 &&
                  (event()!.facebookAttendees ?? []).length === 0
                ) {
                  <p class="no-rsvps">No RSVPs yet — be the first!</p>
                } @else if (!isLoggedIn()) {
                  <p class="no-rsvps"><a routerLink="/login">Sign in</a> to see who's going.</p>
                } @else if (isNonValidated()) {
                  <ul class="attendee-list">
                    @for (r of event()!.rsvps; track r.id) {
                      <li class="attendee-row attendee-mystery">
                        <div class="attendee-avatar attendee-avatar-mystery">
                          <img src="/assets/default-avatar.svg" alt="Mystery member" />
                        </div>
                        <div class="attendee-info">
                          <span class="attendee-name mystery-name">Mystery Bear</span>
                        </div>
                      </li>
                    }
                  </ul>
                } @else {
                  <ul class="attendee-list">
                    @for (r of event()!.rsvps; track r.id) {
                      <li class="attendee-row" [class.attendee-maybe]="r.status === 'maybe'">
                        <div class="attendee-avatar">
                          @if (r.user.profilePhotoPath) {
                            <img [src]="r.user.profilePhotoPath" [alt]="r.user.fullName" />
                          } @else {
                            <span class="avatar-initials">{{ initials(r.user.fullName) }}</span>
                          }
                        </div>
                        <div class="attendee-info">
                          <div class="attendee-name-row">
                            <span class="attendee-name">{{ r.user.fullName }}</span>
                            @if (r.status === 'maybe') {
                              <span class="maybe-badge">Maybe</span>
                            }
                          </div>
                          @if (r.additionalGuests > 0 && r.status === 'going') {
                            <span class="attendee-guests">
                              +{{ r.additionalGuests }}
                              @if (namedGuests(r.guestNames)) {
                                <span class="guest-names-inline"
                                  >({{ namedGuests(r.guestNames) }})</span
                                >
                              }
                            </span>
                          }
                          @if (r.status === 'going' && isResidenceEvent() && r.bringingItem) {
                            <span class="attendee-bringing">🍴 {{ r.bringingItem }}</span>
                          }
                        </div>
                      </li>
                    }
                    @for (p of event()!.publicRsvps; track p.id) {
                      <li class="attendee-row">
                        <div class="attendee-avatar attendee-avatar-guest">
                          <mat-icon class="guest-avatar-icon">person</mat-icon>
                        </div>
                        <div class="attendee-info">
                          <span class="attendee-name">{{ p.recipientName || 'Guest' }}</span>
                          <span class="attendee-guest-badge">guest</span>
                        </div>
                      </li>
                    }
                    @for (f of event()!.facebookAttendees ?? []; track f.id) {
                      <li class="attendee-row">
                        <div class="attendee-avatar attendee-avatar-guest">
                          <mat-icon class="guest-avatar-icon">person</mat-icon>
                        </div>
                        <div class="attendee-info">
                          <div class="attendee-name-row">
                            <span class="attendee-name">{{ f.name }}</span>
                            <span class="attendee-facebook-badge">Facebook</span>
                          </div>
                          @if (f.plusOnes > 0) {
                            <span class="attendee-guests">+{{ f.plusOnes }}</span>
                          }
                        </div>
                      </li>
                    }
                  </ul>
                }
              </mat-card-content>
            </mat-card>
          }

          <!-- Reservation Coordinator panel — members only (incl. admin/mod); assign/manage is admin/mod only -->
          @if (event()!.status === 'published' && isLoggedIn() && !isNonValidated()) {
            <mat-card class="reservation-card">
              <mat-card-content>
                <div class="reservation-header">
                  <h4 class="reservation-title">
                    <mat-icon>phone</mat-icon> Reservation Coordinator
                  </h4>
                  @if (isAdminOrMod()) {
                    <div class="res-header-actions">
                      @if (
                        (event()!.reservationAssignee ||
                          event()!.reservationAssigneeId ||
                          event()!.reservationContactEmail) &&
                        !reservationReassigning()
                      ) {
                        <button
                          mat-stroked-button
                          class="res-reassign-btn"
                          (click)="startReassign()"
                        >
                          <mat-icon>swap_horiz</mat-icon> Reassign
                        </button>
                      }
                      @if (
                        event()!.reservationAssignee ||
                        event()!.reservationAssigneeId ||
                        event()!.reservationContactEmail
                      ) {
                        <button
                          mat-icon-button
                          matTooltip="Clear assignment"
                          color="warn"
                          (click)="clearReservation()"
                        >
                          <mat-icon>close</mat-icon>
                        </button>
                      }
                    </div>
                  }
                </div>

                <!-- Current assignment display -->
                @if (
                  (event()!.reservationAssignee ||
                    event()!.reservationAssigneeId ||
                    event()!.reservationContactEmail) &&
                  !reservationReassigning()
                ) {
                  <div class="reservation-assigned">
                    <mat-icon class="res-person-icon">person</mat-icon>
                    <div class="res-person-info">
                      <span class="res-person-name">
                        {{
                          event()!.reservationAssignee?.fullName ??
                            event()!.reservationContactName ??
                            event()!.reservationContactEmail
                        }}
                      </span>
                      @if (
                        isAdminOrMod() &&
                        event()!.reservationContactEmail &&
                        !event()!.reservationAssigneeId
                      ) {
                        <span class="res-person-email">{{ event()!.reservationContactEmail }}</span>
                      }
                    </div>
                    <div class="res-status" [class.confirmed]="event()!.reservationConfirmed">
                      <mat-icon>{{
                        event()!.reservationConfirmed ? 'check_circle' : 'hourglass_empty'
                      }}</mat-icon>
                      {{ event()!.reservationConfirmed ? 'Confirmed' : 'Pending' }}
                    </div>
                  </div>

                  @if (isAdminOrMod()) {
                    <!-- Mark confirmed / unconfirm -->
                    @if (!event()!.reservationConfirmed) {
                      @if (!showConfirmNoteInput()) {
                        <div class="res-confirm-toggle">
                          <button
                            mat-stroked-button
                            color="primary"
                            (click)="showConfirmNoteInput.set(true)"
                          >
                            <mat-icon>check</mat-icon> Mark as Confirmed
                          </button>
                        </div>
                      } @else {
                        <div class="res-note-form">
                          <mat-form-field appearance="outline" class="res-field">
                            <mat-label
                              >Note (optional) — e.g. "Spoke with Jane, confirmed for 22
                              people"</mat-label
                            >
                            <textarea
                              matInput
                              rows="2"
                              maxlength="500"
                              [value]="reservationConfirmNote()"
                              (input)="reservationConfirmNote.set($any($event.target).value)"
                            ></textarea>
                          </mat-form-field>
                          <div class="res-note-actions">
                            <button
                              mat-raised-button
                              color="primary"
                              [disabled]="reservationSaving()"
                              (click)="toggleReservationConfirmed(true)"
                            >
                              @if (reservationSaving()) {
                                <mat-spinner diameter="16" />
                              } @else {
                                <mat-icon>check</mat-icon>
                              }
                              Confirm
                            </button>
                            <button
                              mat-button
                              (click)="
                                showConfirmNoteInput.set(false); reservationConfirmNote.set('')
                              "
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      }
                    } @else {
                      <div class="res-confirm-toggle">
                        <button
                          mat-stroked-button
                          color="warn"
                          (click)="toggleReservationConfirmed(false)"
                        >
                          <mat-icon>undo</mat-icon> Unmark Confirmed
                        </button>
                      </div>
                    }
                  }
                } @else if (isAdminOrMod()) {
                  <!-- No assignment yet: show Assign button, expand to form on click -->
                  @if (!reservationReassigning() && !showCoordinatorAssignForm()) {
                    <div class="res-no-assignee">
                      <button mat-stroked-button (click)="showCoordinatorAssignForm.set(true)">
                        <mat-icon>person_add</mat-icon> Assign Coordinator
                      </button>
                    </div>
                  } @else {
                    <!-- Assignment form (shown when no assignment and form open, or when reassigning) -->
                    @if (reservationReassigning()) {
                      <p class="res-reassign-label">
                        Select a new coordinator to replace the current one:
                      </p>
                    }
                    <mat-button-toggle-group
                      [value]="reservationMode()"
                      (change)="reservationMode.set($event.value)"
                      class="res-mode-toggle"
                    >
                      <mat-button-toggle value="member">Assign Member</mat-button-toggle>
                      <mat-button-toggle value="contact">Outside Contact</mat-button-toggle>
                    </mat-button-toggle-group>

                    @if (reservationMode() === 'member') {
                      <div class="res-member-search">
                        <mat-form-field appearance="outline" class="res-search-field">
                          <mat-label>Search member by name</mat-label>
                          <input
                            matInput
                            [value]="reservationMemberSearch()"
                            (input)="onReservationMemberSearch($any($event.target).value)"
                            autocomplete="off"
                          />
                          <mat-icon matSuffix>search</mat-icon>
                        </mat-form-field>
                        @if (reservationMemberResults().length > 0) {
                          <div class="res-member-results">
                            @for (m of reservationMemberResults(); track m.id) {
                              <button
                                mat-button
                                class="res-member-row"
                                (click)="assignReservationMember(m)"
                                [disabled]="reservationSaving()"
                              >
                                <mat-icon>person</mat-icon> {{ m.fullName }}
                              </button>
                            }
                          </div>
                        }
                      </div>
                    } @else {
                      <div class="res-contact-form">
                        <mat-form-field appearance="outline" class="res-field">
                          <mat-label>Contact name</mat-label>
                          <input
                            matInput
                            [value]="reservationContactName()"
                            (input)="reservationContactName.set($any($event.target).value)"
                            maxlength="150"
                          />
                        </mat-form-field>
                        <mat-form-field appearance="outline" class="res-field">
                          <mat-label>Email address</mat-label>
                          <input
                            matInput
                            type="email"
                            [value]="reservationContactEmail()"
                            (input)="reservationContactEmail.set($any($event.target).value)"
                            maxlength="255"
                          />
                        </mat-form-field>
                        <button
                          mat-raised-button
                          color="primary"
                          [disabled]="
                            reservationSaving() ||
                            !reservationContactName().trim() ||
                            !reservationContactEmail().trim()
                          "
                          (click)="sendReservationToContact()"
                        >
                          @if (reservationSaving()) {
                            <mat-spinner diameter="16" />
                          }
                          <mat-icon>send</mat-icon> Send Reservation Request
                        </button>
                      </div>
                    }

                    <button
                      mat-button
                      class="res-cancel-reassign"
                      (click)="
                        reservationReassigning()
                          ? reservationReassigning.set(false)
                          : showCoordinatorAssignForm.set(false)
                      "
                    >
                      Cancel
                    </button>
                  }
                } @else {
                  <p class="res-no-assignee-text">No coordinator assigned yet.</p>
                }
              </mat-card-content>
            </mat-card>
          }

          <!-- Discussion -->
          @if (isLoggedIn() && event()!.status === 'published') {
            <div class="discussion-section">
              <h4 class="section-heading"><mat-icon>forum</mat-icon> Discussion</h4>
              @if (commentsLoading()) {
                <div class="att-loading"><mat-spinner diameter="24" /></div>
              } @else if (comments().length === 0 && isNonValidated()) {
                <p class="no-comments">No comments yet.</p>
              } @else {
                <div class="comments-list">
                  @for (comment of comments(); track comment.id) {
                    <div class="comment-block">
                      @if (comment.deleted) {
                        <p class="comment-removed">
                          <mat-icon>remove_circle_outline</mat-icon> This comment was removed.
                        </p>
                      } @else {
                        <div class="comment-header">
                          <span class="comment-author">{{ comment.memberName }}</span>
                          <span class="comment-time">{{
                            comment.createdAt | date: 'MMM d, y · h:mm a'
                          }}</span>
                          @if (comment.editedAt) {
                            <span
                              class="comment-edited"
                              [matTooltip]="
                                'Edited ' + (comment.editedAt | date: 'MMM d, y · h:mm a')
                              "
                              >(edited)</span
                            >
                          }
                          @if (
                            comment.memberId === currentUserId() && !isEditing('comment', comment.id)
                          ) {
                            <button
                              mat-icon-button
                              class="comment-edit-btn"
                              matTooltip="Edit"
                              (click)="startEdit('comment', comment.id, comment.body)"
                            >
                              <mat-icon>edit</mat-icon>
                            </button>
                          }
                          @if (comment.memberId === currentUserId() || isAdminOrMod()) {
                            <button
                              mat-icon-button
                              class="comment-delete-btn"
                              matTooltip="Remove"
                              (click)="deleteComment(comment.id)"
                            >
                              <mat-icon>delete_outline</mat-icon>
                            </button>
                          }
                          <app-report-button
                            contentType="event_comment"
                            [contentId]="comment.id"
                            [authorId]="comment.memberId"
                          />
                        </div>
                        @if (isEditing('comment', comment.id)) {
                          <div class="edit-form">
                            <mat-form-field appearance="outline" class="comment-field">
                              <mat-label>Edit your comment…</mat-label>
                              <textarea
                                matInput
                                [value]="editBody()"
                                (input)="editBody.set($any($event.target).value)"
                                rows="3"
                                maxlength="2000"
                              ></textarea>
                            </mat-form-field>
                            <div class="comment-form-actions">
                              <button mat-button (click)="cancelEdit()">Cancel</button>
                              <button
                                mat-raised-button
                                color="primary"
                                (click)="saveEdit(comment.id)"
                                [disabled]="!editBody().trim() || savingEdit()"
                              >
                                @if (savingEdit()) {
                                  <mat-spinner diameter="16" />
                                }
                                Save
                              </button>
                            </div>
                          </div>
                        } @else {
                          <p class="comment-body">{{ comment.body }}</p>
                          @if (!isNonValidated()) {
                            <button
                              mat-button
                              class="reply-toggle-btn"
                              (click)="
                                replyingToId.set(replyingToId() === comment.id ? null : comment.id);
                                newReplyBody.set('')
                              "
                            >
                              <mat-icon>reply</mat-icon> Reply
                            </button>
                          }
                        }
                      }
                      @if (comment.replies.length > 0) {
                        <div class="replies-list">
                          @for (reply of comment.replies; track reply.id) {
                            <div class="reply-block">
                              @if (reply.deleted) {
                                <p class="comment-removed">
                                  <mat-icon>remove_circle_outline</mat-icon> This reply was removed.
                                </p>
                              } @else {
                                <div class="comment-header">
                                  <span class="comment-author">{{ reply.memberName }}</span>
                                  <span class="comment-time">{{
                                    reply.createdAt | date: 'MMM d, y · h:mm a'
                                  }}</span>
                                  @if (reply.editedAt) {
                                    <span
                                      class="comment-edited"
                                      [matTooltip]="
                                        'Edited ' + (reply.editedAt | date: 'MMM d, y · h:mm a')
                                      "
                                      >(edited)</span
                                    >
                                  }
                                  @if (
                                    reply.memberId === currentUserId() && !isEditing('reply', reply.id)
                                  ) {
                                    <button
                                      mat-icon-button
                                      class="comment-edit-btn"
                                      matTooltip="Edit"
                                      (click)="startEdit('reply', reply.id, reply.body)"
                                    >
                                      <mat-icon>edit</mat-icon>
                                    </button>
                                  }
                                  @if (reply.memberId === currentUserId() || isAdminOrMod()) {
                                    <button
                                      mat-icon-button
                                      class="comment-delete-btn"
                                      matTooltip="Remove"
                                      (click)="deleteReply(comment.id, reply.id)"
                                    >
                                      <mat-icon>delete_outline</mat-icon>
                                    </button>
                                  }
                                  <app-report-button
                                    contentType="event_comment_reply"
                                    [contentId]="reply.id"
                                    [authorId]="reply.memberId"
                                  />
                                </div>
                                @if (isEditing('reply', reply.id)) {
                                  <div class="edit-form">
                                    <mat-form-field appearance="outline" class="comment-field">
                                      <mat-label>Edit your reply…</mat-label>
                                      <textarea
                                        matInput
                                        [value]="editBody()"
                                        (input)="editBody.set($any($event.target).value)"
                                        rows="2"
                                        maxlength="2000"
                                      ></textarea>
                                    </mat-form-field>
                                    <div class="comment-form-actions">
                                      <button mat-button (click)="cancelEdit()">Cancel</button>
                                      <button
                                        mat-raised-button
                                        color="primary"
                                        (click)="saveEdit(comment.id, reply.id)"
                                        [disabled]="!editBody().trim() || savingEdit()"
                                      >
                                        @if (savingEdit()) {
                                          <mat-spinner diameter="16" />
                                        }
                                        Save
                                      </button>
                                    </div>
                                  </div>
                                } @else {
                                  <p class="comment-body">{{ reply.body }}</p>
                                }
                              }
                            </div>
                          }
                        </div>
                      }
                      @if (replyingToId() === comment.id && !isNonValidated()) {
                        <div class="reply-form">
                          <mat-form-field appearance="outline" class="comment-field">
                            <mat-label>Your reply…</mat-label>
                            <textarea
                              matInput
                              [value]="newReplyBody()"
                              (input)="newReplyBody.set($any($event.target).value)"
                              rows="2"
                              maxlength="2000"
                            ></textarea>
                          </mat-form-field>
                          <div class="comment-form-actions">
                            <button
                              mat-button
                              (click)="replyingToId.set(null); newReplyBody.set('')"
                            >
                              Cancel
                            </button>
                            <button
                              mat-raised-button
                              color="primary"
                              (click)="submitReply(comment.id)"
                              [disabled]="!newReplyBody().trim() || submittingReply()"
                            >
                              @if (submittingReply()) {
                                <mat-spinner diameter="16" />
                              }
                              Post Reply
                            </button>
                          </div>
                        </div>
                      }
                    </div>
                  }
                </div>
              }
              @if (!isNonValidated()) {
                <div class="new-comment-form">
                  <mat-form-field appearance="outline" class="comment-field">
                    <mat-label>Add a comment…</mat-label>
                    <textarea
                      matInput
                      [value]="newCommentBody()"
                      (input)="newCommentBody.set($any($event.target).value)"
                      rows="3"
                      maxlength="2000"
                    ></textarea>
                  </mat-form-field>
                  <div class="comment-form-actions">
                    <button
                      mat-raised-button
                      color="primary"
                      (click)="submitComment()"
                      [disabled]="!newCommentBody().trim() || submittingComment()"
                    >
                      @if (submittingComment()) {
                        <mat-spinner diameter="16" />
                      }
                      Post
                    </button>
                  </div>
                </div>
              }
            </div>
          }

          <!-- Admin actions -->
          @if (isAdminOrMod()) {
            <div class="admin-actions">
              <button mat-stroked-button (click)="openEdit()">
                <mat-icon>edit</mat-icon> Edit
              </button>
              @if (event()!.status === 'draft') {
                <button mat-raised-button color="primary" (click)="publish()">
                  <mat-icon>publish</mat-icon> Publish
                </button>
                @if (isAdmin()) {
                  <button mat-stroked-button color="warn" (click)="deleteEvent()">
                    <mat-icon>delete</mat-icon> Delete
                  </button>
                }
              }
              @if (event()!.status === 'published') {
                <button mat-stroked-button color="warn" (click)="cancel()">
                  <mat-icon>cancel</mat-icon> Cancel Event
                </button>
              }
              @if (event()!.status === 'cancelled') {
                <button mat-stroked-button color="primary" (click)="restore()">
                  <mat-icon>undo</mat-icon> Restore to Draft
                </button>
                @if (isAdmin()) {
                  <button mat-stroked-button color="warn" (click)="deleteEvent()">
                    <mat-icon>delete</mat-icon> Delete
                  </button>
                }
              }
            </div>
          }

          <!-- Back -->
          <div class="back-row">
            <button mat-button (click)="goBack()">
              <mat-icon>arrow_back</mat-icon> All Events
            </button>
          </div>
        </div>
      </div>
    } @else {
      <p class="center">Event not found.</p>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .center {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
      .detail-layout {
        max-width: 760px;
        margin: 0 auto;
      }
      .hero-photo {
        width: 100%;
        height: 280px;
        overflow: hidden;
        border-radius: 12px;
        margin-bottom: 24px;
        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
      }
      .hero-private {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        background: linear-gradient(135deg, var(--db-brown-dark) 0%, var(--db-brown-mid) 100%);
        color: #fff;
        font-size: 0.9rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        mat-icon {
          font-size: 34px;
          width: 34px;
          height: 34px;
          opacity: 0.9;
        }
      }
      .status-row {
        margin-bottom: 12px;
      }
      .status-chip {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        &.status-draft {
          background: #e3f2fd;
          color: #1565c0;
        }
        &.status-cancelled {
          background: #ffebee;
          color: #c62828;
        }
      }
      .title-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }
      .event-title {
        margin: 0 0 12px;
        font-size: 2rem;
        font-weight: 700;
        color: var(--db-brown-dark);
        line-height: 1.2;
      }
      .admin-menu-btn {
        flex-shrink: 0;
        margin-top: -4px;
        color: var(--db-brown-dark);
      }
      .event-datetime {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        font-size: 1.05rem;
        color: var(--db-primary);
        font-weight: 500;
        margin-bottom: 20px;
        mat-icon {
          color: var(--db-primary);
        }
      }
      .cal-add-btn {
        flex-shrink: 0;
        white-space: nowrap;
        height: 28px !important;
        min-height: 28px !important;
        line-height: 26px !important;
        font-size: 0.75rem !important;
        padding: 0 10px !important;
        color: var(--db-primary) !important;
        border-color: var(--db-primary) !important;
        mat-icon {
          font-size: 0.9rem;
          width: 0.9rem;
          height: 0.9rem;
          margin-right: 2px;
        }
      }
      .info-card {
        margin-bottom: 24px;
      }
      .info-row {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 10px 0;
        border-bottom: 1px solid #f0ebe3;
        &:last-child {
          border-bottom: none;
        }
        mat-icon {
          color: #999;
          margin-top: 2px;
          flex-shrink: 0;
        }
      }
      .info-label {
        font-size: 0.75rem;
        color: #999;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .info-value {
        font-size: 0.95rem;
        color: var(--db-brown-dark);
        margin-top: 2px;
      }
      .map-link {
        color: var(--db-primary);
        text-decoration: none;
        &:hover {
          text-decoration: underline;
        }
      }
      .address-hidden {
        display: flex;
        align-items: center;
        gap: 4px;
        font-style: italic;
        color: #999;
        .lock-icon {
          font-size: 0.95rem;
          width: 0.95rem;
          height: 0.95rem;
        }
      }
      .section {
        margin-bottom: 24px;
        h3 {
          margin: 0 0 8px;
          color: var(--db-brown-dark);
        }
      }
      .description {
        margin: 0;
        color: #444;
        line-height: 1.6;
        white-space: pre-wrap;
      }
      .cancelled-reason {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        background: #ffebee;
        border-radius: 8px;
        color: #c62828;
        margin-bottom: 24px;
        mat-icon {
          color: #c62828;
        }
      }
      .rsvp-card {
        margin-bottom: 24px;
      }
      .rsvp-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: 16px;
        h3 {
          margin: 0;
          color: var(--db-brown-dark);
        }
      }
      .seat-count {
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--db-primary);
      }
      .rsvp-disclaimer {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px 12px;
        margin-bottom: 14px;
        background: #faf7f2;
        border: 1px solid #e8e0d6;
        border-radius: 8px;
      }
      .disclaimer-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.82rem;
        color: #666;
      }
      .disc-icon {
        font-size: 0.95rem;
        width: 0.95rem;
        height: 0.95rem;
        color: var(--db-amber);
        flex-shrink: 0;
      }
      .cutoff-banner {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        background: #fff3e0;
        border: 1px solid #ffb74d;
        border-radius: 8px;
        font-size: 0.88rem;
        font-weight: 500;
        color: #e65100;
        mat-icon {
          font-size: 1.1rem;
          width: 1.1rem;
          height: 1.1rem;
        }
      }
      .rsvp-action {
        margin-bottom: 16px;
      }
      .rsvp-guest-cta {
        margin-bottom: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .rsvp-or {
        font-size: 0.8rem;
        color: #aaa;
        text-align: center;
      }
      .public-rsvp-form {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .public-rsvp-label {
        margin: 0;
        font-size: 0.82rem;
        color: #666;
        font-weight: 500;
      }
      .public-rsvp-fields {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        .pub-field {
          flex: 1;
          min-width: 140px;
          font-size: 0.88rem;
          .mat-mdc-form-field-subscript-wrapper {
            display: none;
          }
        }
      }
      .public-rsvp-error {
        font-size: 0.8rem;
        color: #c62828;
      }
      .public-rsvp-success {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: #e8f5e9;
        border-radius: 8px;
        font-size: 0.88rem;
        color: #2e7d32;
        font-weight: 500;
        mat-icon {
          color: #2e7d32;
          font-size: 1.1rem;
          width: 1.1rem;
          height: 1.1rem;
        }
      }
      .rsvp-controls {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .going-icon {
        color: #2e7d32;
        font-size: 1.4rem;
        width: 1.4rem;
        height: 1.4rem;
      }
      .going-label {
        font-weight: 600;
        color: #2e7d32;
      }
      .guests-select {
        width: 130px;
      }
      .bringing-field {
        width: 100%;
        margin-top: 8px;
      }
      .cancel-rsvp-btn {
        font-size: 0.8rem;
      }

      // ── Guest panel ───────────────────────────────────────────────────────────

      .guest-panel {
        margin-top: 16px;
        padding: 16px;
        background: #faf7f2;
        border: 1px solid #e8e0d6;
        border-radius: 10px;
      }

      .guest-panel-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
      }

      .guest-panel-icon {
        color: var(--db-amber);
        font-size: 1.2rem;
        width: 1.2rem;
        height: 1.2rem;
      }

      .guest-panel-title {
        font-size: 0.85rem;
        font-weight: 700;
        color: var(--db-brown-dark);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .guest-compact-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .guest-compact-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 8px 4px 4px;
        border-radius: 6px;
        background: #fff;
        border: 1px solid #e8e0d6;
      }

      .guest-row-icon {
        font-size: 1rem;
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
        color: #bbb;
      }

      .guest-compact-name {
        flex: 1;
        font-size: 0.9rem;
        color: var(--db-brown-dark);
        &.unnamed {
          color: #aaa;
          font-style: italic;
        }
      }

      .guest-row-actions {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        .mat-mdc-icon-button {
          width: 32px;
          height: 32px;
          padding: 4px;
        }
      }

      .copy-link-btn {
        color: var(--db-amber) !important;
      }
      .edit-guest-btn {
        color: #888 !important;
      }

      .link-ready-icon {
        color: #2e7d32 !important;
      }
      .link-used-icon {
        color: #999 !important;
      }
      .link-cancelled-icon {
        color: #c62828 !important;
      }
      .remove-link-btn {
        color: #c62828 !important;
        opacity: 0.7;
        &:hover {
          opacity: 1;
        }
      }

      .link-status-badge {
        font-size: 0.68rem;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 10px;
        white-space: nowrap;
        background: #fff3e0;
        color: var(--db-amber-dark);
        &.used {
          background: #e8f5e9;
          color: #2e7d32;
        }
        &.cancelled {
          background: #ffebee;
          color: #c62828;
        }
      }

      .guest-edit-expansion {
        padding: 10px 12px 4px;
        background: #fff;
        border: 1px solid #e8e0d6;
        border-top: none;
        border-radius: 0 0 6px 6px;
        margin-top: -4px;
        display: flex;
        flex-direction: column;
      }

      .guest-name-field,
      .guest-email-field {
        width: 100%;
        font-size: 0.88rem;
        .mat-mdc-form-field-subscript-wrapper {
          display: none;
        }
      }

      .guest-edit-save-row {
        display: flex;
        justify-content: flex-end;
        margin-top: -4px;
      }

      // ── Attendee list ─────────────────────────────────────────────────────────

      .rsvp-divider {
        margin: 16px 0;
      }
      .no-rsvps {
        color: #999;
        font-size: 0.9rem;
        margin: 0;
      }
      .attendee-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .attendee-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .attendee-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        overflow: hidden;
        flex-shrink: 0;
        background: var(--db-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
      }
      .avatar-initials {
        color: #fff;
        font-size: 0.8rem;
        font-weight: 700;
      }
      .attendee-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
      }
      .attendee-name {
        font-size: 0.95rem;
        color: var(--db-brown-dark);
      }
      .attendee-guests {
        font-size: 0.8rem;
        color: #888;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .guest-names-inline {
        color: #666;
        font-style: italic;
      }
      .attendee-bringing {
        display: block;
        font-size: 0.8rem;
        color: #888;
        margin-top: 2px;
      }
      .attendee-avatar-guest {
        background: #e8e0d6;
        .guest-avatar-icon {
          color: #999;
          font-size: 1.2rem;
          width: 1.2rem;
          height: 1.2rem;
        }
      }
      .attendee-avatar-mystery {
        filter: grayscale(1);
        opacity: 0.4;
      }
      .attendee-mystery {
        pointer-events: none;
      }
      .mystery-name {
        color: #bbb;
        font-style: italic;
      }
      .attendee-facebook-badge {
        display: inline-block;
        font-size: 0.68rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        padding: 1px 6px;
        border-radius: 8px;
        background: #e3eafc;
        color: #1b4db1;
      }
      .attendee-guest-badge {
        font-size: 0.68rem;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: 8px;
        background: #f5edd8;
        color: var(--db-brown-mid);
        align-self: flex-start;
      }

      // ── RSVP toggle ──────────────────────────────────────────────────────────

      .rsvp-counts {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .maybe-count {
        font-size: 0.78rem;
        font-weight: 600;
        color: var(--db-amber-dark, #e65100);
        background: #fff3e0;
        padding: 2px 8px;
        border-radius: 10px;
      }

      .rsvp-toggle {
        .mat-button-toggle-button {
          font-size: 0.85rem;
        }
        .toggle-going.mat-button-toggle-checked {
          background: #e8f5e9;
          color: #2e7d32;
        }
        .toggle-maybe.mat-button-toggle-checked {
          background: #fff3e0;
          color: #e65100;
        }
        .toggle-not-going.mat-button-toggle-checked {
          background: #ffebee;
          color: #c62828;
        }
        mat-icon {
          font-size: 1rem;
          width: 1rem;
          height: 1rem;
          vertical-align: middle;
          margin-right: 4px;
        }
      }

      .rsvp-initial-toggle {
        margin-bottom: 4px;
      }

      .attendee-maybe {
        opacity: 0.75;
      }

      .attendee-name-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .maybe-badge {
        font-size: 0.65rem;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: 8px;
        background: #fff3e0;
        color: #e65100;
      }

      .res-no-assignee-text {
        color: #999;
        font-size: 0.88rem;
        margin: 0;
      }

      // ── Reservation status badges ─────────────────────────────────────────────

      .reservation-confirmed-badge {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 10px 16px;
        background: #e8f5e9;
        border: 1px solid #a5d6a7;
        border-radius: 8px;
        margin-bottom: 16px;
        color: #2e7d32;
        mat-icon {
          color: #2e7d32;
          font-size: 1.1rem;
          width: 1.1rem;
          height: 1.1rem;
          flex-shrink: 0;
          margin-top: 1px;
        }
      }

      .res-badge-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 0.9rem;
        font-weight: 600;
      }

      .res-badge-by {
        font-size: 0.8rem;
        font-weight: 400;
        color: #388e3c;
      }

      .res-badge-note {
        font-size: 0.8rem;
        font-weight: 400;
        font-style: italic;
        color: #555;
        margin-top: 2px;
      }

      .reservation-pending-badge {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        background: #fff8e1;
        border: 1px solid #ffe082;
        border-radius: 8px;
        margin-bottom: 16px;
        font-size: 0.88rem;
        color: #5d4037;
        mat-icon {
          color: #e65100;
          font-size: 1.1rem;
          width: 1.1rem;
          height: 1.1rem;
          flex-shrink: 0;
        }
      }

      .assignee-confirm-banner {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        padding: 12px 16px;
        background: #e3f2fd;
        border: 1px solid #90caf9;
        border-radius: 8px;
        margin-bottom: 16px;
        font-size: 0.88rem;
        color: #1565c0;
        mat-icon {
          color: #1976d2;
          font-size: 1.2rem;
          width: 1.2rem;
          height: 1.2rem;
          flex-shrink: 0;
        }
        span {
          flex: 1;
          min-width: 180px;
        }
      }

      // ── Reservation Coordinator panel ─────────────────────────────────────────

      .reservation-card {
        margin-bottom: 24px;
      }

      .reservation-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }

      .res-header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .res-reassign-btn {
        font-size: 0.78rem;
        height: 30px;
        line-height: 28px;
        padding: 0 10px;
        mat-icon {
          font-size: 0.9rem;
          width: 0.9rem;
          height: 0.9rem;
          margin-right: 2px;
        }
      }

      .reservation-title {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0;
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--db-brown-dark);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        mat-icon {
          font-size: 1rem;
          width: 1rem;
          height: 1rem;
          color: var(--db-amber);
        }
      }

      .res-reassign-label {
        font-size: 0.82rem;
        color: #888;
        margin: 0 0 10px;
        font-style: italic;
      }

      .res-cancel-reassign {
        margin-top: 4px;
      }
      .res-no-assignee {
        padding: 4px 0 8px;
      }

      .res-mode-toggle {
        margin-bottom: 14px;
        .mat-button-toggle-button {
          font-size: 0.82rem;
        }
      }

      .reservation-assigned {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: #faf7f2;
        border: 1px solid #e8e0d6;
        border-radius: 8px;
        margin-bottom: 12px;
      }

      .res-person-icon {
        color: var(--db-amber);
        font-size: 1.3rem;
        width: 1.3rem;
        height: 1.3rem;
        flex-shrink: 0;
      }

      .res-person-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .res-person-name {
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--db-brown-dark);
      }
      .res-person-email {
        font-size: 0.78rem;
        color: #888;
      }

      .res-status {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 0.78rem;
        font-weight: 600;
        color: #e65100;
        mat-icon {
          font-size: 1rem;
          width: 1rem;
          height: 1rem;
        }
        &.confirmed {
          color: #2e7d32;
        }
      }

      .res-confirm-toggle {
        display: flex;
        margin-bottom: 4px;
      }

      .res-note-form {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 4px;
      }

      .res-note-actions {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .res-member-search {
        margin-top: 10px;
      }

      .res-search-field {
        width: 100%;
        font-size: 0.88rem;
        .mat-mdc-form-field-subscript-wrapper {
          display: none;
        }
      }

      .res-member-results {
        display: flex;
        flex-direction: column;
        border: 1px solid #e8e0d6;
        border-radius: 4px;
        overflow: hidden;
        margin-top: -8px;
      }

      .res-member-row {
        justify-content: flex-start !important;
        border-radius: 0 !important;
        border-bottom: 1px solid #f0ebe3;
        font-size: 0.9rem;
        &:last-child {
          border-bottom: none;
        }
      }

      .res-contact-form {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 10px;
      }

      .res-field {
        width: 100%;
        font-size: 0.88rem;
        .mat-mdc-form-field-subscript-wrapper {
          display: none;
        }
      }

      // ── Admin actions ─────────────────────────────────────────────────────────

      .admin-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 24px;
        padding: 16px;
        background: var(--db-cream-dark);
        border-radius: 8px;
      }
      .back-row {
        margin-top: 8px;
      }

      // ── Special Dinner Achievement Badge ──────────────────────────────────────
      .special-dinner-badge {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        background: linear-gradient(135deg, var(--db-primary) 0%, #2a6bbf 100%);
        color: #fff;
        border-radius: 12px;
        padding: 14px 16px;
        margin-bottom: 16px;
        box-shadow: 0 2px 10px rgba(30, 77, 140, 0.25);
        mat-icon {
          color: var(--db-primary);
          font-size: 2rem;
          width: 2rem;
          height: 2rem;
          flex-shrink: 0;
          margin-top: 2px;
        }
      }
      .special-dinner-icon-img {
        width: 2rem;
        height: 2rem;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
        margin-top: 2px;
      }
      .special-dinner-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
      }
      .special-dinner-label {
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0.75;
      }
      .special-dinner-name {
        font-size: 1rem;
        font-weight: 700;
      }
      .special-dinner-desc {
        font-size: 0.82rem;
        opacity: 0.85;
      }
      .special-dinner-title {
        font-size: 0.78rem;
        color: var(--db-primary);
        font-weight: 600;
        font-style: italic;
      }
      .special-dinner-img {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
        border: 2px solid rgba(255, 255, 255, 0.3);
      }

      // ── Discussion ────────────────────────────────────────────────────────────
      .section-heading {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 1rem;
        font-weight: 600;
        color: var(--db-brown-dark);
        margin: 0 0 16px;
        mat-icon {
          font-size: 1.1rem;
          width: 1.1rem;
          height: 1.1rem;
        }
      }
      .discussion-section {
        margin-top: 24px;
        padding-top: 20px;
        border-top: 1px solid #e8e0d6;
      }
      .no-comments {
        color: #999;
        font-size: 0.9rem;
        margin: 0 0 16px;
      }
      .comments-list {
        display: flex;
        flex-direction: column;
        margin-bottom: 20px;
      }
      .comment-block {
        padding: 14px 0;
        border-bottom: 1px solid #f0ebe3;
        &:last-child {
          border-bottom: none;
        }
      }
      .reply-block {
        padding: 10px 0 10px 16px;
        border-left: 2px solid #e8e0d6;
        margin-top: 8px;
      }
      .replies-list {
        margin-top: 4px;
        display: flex;
        flex-direction: column;
      }
      .comment-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }
      .comment-author {
        font-weight: 600;
        font-size: 0.88rem;
        color: var(--db-brown-dark);
      }
      .comment-time {
        font-size: 0.78rem;
        color: #999;
        flex: 1;
      }
      .comment-edited {
        font-size: 0.72rem;
        color: #999;
        font-style: italic;
      }
      .edit-form {
        margin-top: 8px;
      }
      .comment-edit-btn {
        width: 28px;
        height: 28px;
        line-height: 28px;
        mat-icon {
          font-size: 0.95rem;
        }
        color: #bbb !important;
        &:hover {
          color: var(--db-brown-dark) !important;
        }
      }
      .comment-delete-btn {
        width: 28px;
        height: 28px;
        line-height: 28px;
        mat-icon {
          font-size: 0.95rem;
        }
        color: #bbb !important;
        &:hover {
          color: #c62828 !important;
        }
      }
      .comment-body {
        font-size: 0.92rem;
        line-height: 1.6;
        color: #444;
        margin: 0 0 6px;
        white-space: pre-wrap;
      }
      .comment-removed {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.83rem;
        color: #bbb;
        font-style: italic;
        margin: 0;
        mat-icon {
          font-size: 0.9rem;
          width: 0.9rem;
          height: 0.9rem;
        }
      }
      .reply-toggle-btn {
        font-size: 0.8rem;
        color: #888 !important;
        padding: 0 4px;
        min-width: 0;
        height: 28px;
        line-height: 28px;
        mat-icon {
          font-size: 0.85rem;
        }
      }
      .reply-form,
      .new-comment-form {
        margin-top: 12px;
      }
      .comment-field {
        width: 100%;
        font-size: 0.9rem;
      }
      .comment-form-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: -8px;
      }
      .new-comment-form {
        padding-top: 16px;
        border-top: 1px dashed #e8e0d6;
        margin-top: 8px;
      }
    `,
  ],
})
export class EventDetailComponent implements OnInit, OnDestroy, HasUnsavedChanges {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly eventsService = inject(EventsService);
  private readonly authService = inject(AuthService);
  readonly brand = inject(BrandConfigService);
  private readonly communityService = inject(CommunityService);
  private readonly commentsService = inject(EventCommentsService);
  private readonly clipboard = inject(Clipboard);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly event = signal<Event | null>(null);
  readonly isResidenceEvent = computed(() => !!this.event()?.location?.isResidence);
  readonly loading = signal(true);
  readonly rsvpLoading = signal(false);
  readonly savingNames = signal(false);
  readonly generatingLinkIndex = signal<number | null>(null);
  readonly removingLinkId = signal<number | null>(null);
  readonly publicRsvpName = signal('');
  readonly publicRsvpEmail = signal('');
  readonly publicRsvpLoading = signal(false);
  readonly publicRsvpDone = signal(false);
  readonly publicRsvpError = signal<string | null>(null);

  // Comments state
  readonly comments = signal<Comment[]>([]);
  readonly commentsLoading = signal(false);
  readonly newCommentBody = signal('');
  readonly submittingComment = signal(false);
  // A single edit slot: only one comment or reply is editable at a time, so
  // the target is identified by kind + id rather than a per-item signal.
  readonly editingTarget = signal<{ kind: 'comment' | 'reply'; id: number } | null>(null);
  readonly editBody = signal('');
  readonly savingEdit = signal(false);
  readonly replyingToId = signal<number | null>(null);
  readonly newReplyBody = signal('');
  readonly submittingReply = signal(false);

  // Reservation coordinator state
  readonly reservationMode = signal<'member' | 'contact'>('member');
  readonly reservationMemberSearch = signal('');
  readonly reservationMemberResults = signal<MemberSearchResult[]>([]);
  readonly reservationContactName = signal('');
  readonly reservationContactEmail = signal('');
  readonly reservationSaving = signal(false);
  readonly reservationReassigning = signal(false);
  readonly showConfirmNoteInput = signal(false);
  readonly reservationConfirmNote = signal('');
  readonly showCoordinatorAssignForm = signal(false);
  private readonly reservationSearch$ = new Subject<string>();

  // Event achievement (public badge display; admin management lives in AchievementAdminDialogComponent)
  readonly eventAchievement = signal<EventAchievement | null>(null);

  // Clock signal — ticks every minute so isPastEvent / isPastCutoff recompute reactively
  private readonly nowSignal = signal(new Date());
  private clockInterval!: ReturnType<typeof setInterval>;

  readonly editingGuestIndex = signal<number | null>(null);

  readonly guestOptions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  readonly guestsCtrl = new FormControl<number>(0, { nonNullable: true });
  // Residence events only (Phase 35) — optional note on what a member is bringing.
  readonly bringingCtrl = new FormControl<string>('', { nonNullable: true });

  readonly guestNamesForm = this.fb.group({ names: this.fb.array<string>([]) });
  readonly guestEmailsForm = this.fb.group({ emails: this.fb.array<string>([]) });

  get guestNameControls(): FormControl<string>[] {
    return (this.guestNamesForm.get('names') as FormArray<FormControl<string>>).controls;
  }

  get guestEmailControls(): FormControl<string>[] {
    return (this.guestEmailsForm.get('emails') as FormArray<FormControl<string>>).controls;
  }

  get guestIndices(): number[] {
    return Array.from({ length: this.guestNameControls.length }, (_, i) => i);
  }

  toggleEditGuest(idx: number): void {
    this.editingGuestIndex.set(this.editingGuestIndex() === idx ? null : idx);
  }

  saveAndCloseEdit(): void {
    this.editingGuestIndex.set(null);
    this.saveGuestNames();
  }

  readonly myRsvp = computed<Rsvp | null>(() => {
    const e = this.event();
    const me = this.authService.currentUser();
    if (!e || !me) return null;
    return e.rsvps.find((r) => r.userId === me.id) ?? null;
  });

  readonly totalSeats = computed<number>(() => {
    const e = this.event();
    if (!e) return 0;
    // Only Going RSVPs count toward venue seat numbers
    const memberSeats = e.rsvps
      .filter((r) => r.status === 'going')
      .reduce((sum, r) => {
        const cancelled = (r.guestLinks ?? []).filter((l) => l.cancelledAt).length;
        return sum + 1 + r.additionalGuests - cancelled;
      }, 0);
    const publicSeats = (e.publicRsvps ?? []).length;
    const facebookSeats = (e.facebookAttendees ?? []).reduce((sum, f) => sum + 1 + f.plusOnes, 0);
    return memberSeats + publicSeats + facebookSeats;
  });

  readonly maybeCount = computed<number>(() => {
    const e = this.event();
    if (!e) return 0;
    return e.rsvps.filter((r) => r.status === 'maybe').length;
  });

  readonly isPastEvent = computed<boolean>(() => {
    const e = this.event();
    if (!e) return false;
    const now = this.nowSignal();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (e.eventDate < todayStr) return true;
    if (e.eventDate === todayStr) {
      const [h, min] = e.eventTime.split(':').map(Number);
      return now.getHours() * 60 + now.getMinutes() >= h * 60 + min;
    }
    return false;
  });

  readonly isPastCutoff = computed<boolean>(() => {
    const e = this.event();
    if (!e) return false;
    const now = this.nowSignal();
    const [y, m, d] = e.eventDate.split('-').map(Number);
    const [h, min] = e.eventTime.split(':').map(Number);
    const cutoffMinutes = h * 60 + min - 150;
    if (cutoffMinutes < 0) {
      // Cutoff is the night before — check if we're past that point on the prior day
      const prevDay = new Date(y, m - 1, d - 1);
      const prevDayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      if (prevDay.getTime() === prevDayStart.getTime()) {
        return now.getHours() * 60 + now.getMinutes() >= cutoffMinutes + 24 * 60;
      }
      return now > new Date(y, m - 1, d - 1, 0, 0, 0);
    }
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const eventDay = new Date(y, m - 1, d);
    if (today.getTime() !== eventDay.getTime()) return false;
    return now.getHours() * 60 + now.getMinutes() >= cutoffMinutes;
  });

  readonly cutoffTimeLabel = computed<string>(() => {
    const e = this.event();
    if (!e) return '';
    const [h, min] = e.eventTime.split(':').map(Number);
    let cm = h * 60 + min - 150;
    const prevNight = cm < 0;
    if (prevNight) cm += 24 * 60;
    const ch = Math.floor(cm / 60);
    const cmin = cm % 60;
    const ampm = ch >= 12 ? 'PM' : 'AM';
    const timeStr = `${ch % 12 || 12}:${String(cmin).padStart(2, '0')} ${ampm}`;
    return prevNight ? `${timeStr} (night before)` : timeStr;
  });

  hasUnsavedChanges(): boolean {
    const idx = this.editingGuestIndex();
    if (idx === null) return false;
    const email = this.guestEmailControls[idx]?.value?.trim() ?? '';
    if (email) return true;
    const savedName = this.myRsvp()?.guestNames?.[idx] ?? '';
    const currentName = this.guestNameControls[idx]?.value ?? '';
    return currentName.trim() !== savedName.trim();
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
    }
  }

  ngOnDestroy(): void {
    clearInterval(this.clockInterval);
  }

  ngOnInit(): void {
    this.clockInterval = setInterval(() => this.nowSignal.set(new Date()), 60_000);
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.reservationSearch$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        // Unlike the walk-in search, don't exclude members already RSVP'd Going —
        // the reservation coordinator is very often already attending their own event.
        switchMap((q) => this.commentsService.searchMembers(id, q, false)),
      )
      .subscribe((results) => this.reservationMemberResults.set(results));
    this.communityService.getEventAchievement(id).subscribe({
      next: (a) => this.eventAchievement.set(a),
      error: () => {},
    });
    this.eventsService.getOne(id).subscribe({
      next: (e) => {
        this.event.set(e);
        this.loading.set(false);
        const my = e.rsvps.find((r) => r.userId === this.authService.currentUser()?.id);
        if (my) {
          this.guestsCtrl.setValue(my.additionalGuests);
          this.bringingCtrl.setValue(my.bringingItem ?? '');
          this.rebuildNameControls(my.additionalGuests, my.guestNames);
        }
        if (e.status === 'published' && this.authService.isLoggedIn()) {
          this.loadComments(id);
        }
      },
      error: () => this.loading.set(false),
    });
  }

  private rebuildNameControls(
    count: number,
    existing: string[] | null,
    preservedEmails?: string[],
  ): void {
    const arr = this.guestNamesForm.get('names') as FormArray<FormControl<string>>;
    arr.clear();
    for (let i = 0; i < count; i++) {
      arr.push(this.fb.control(existing?.[i] ?? ''));
    }
    const emailArr = this.guestEmailsForm.get('emails') as FormArray<FormControl<string>>;
    emailArr.clear();
    for (let i = 0; i < count; i++) {
      emailArr.push(this.fb.control(preservedEmails?.[i] ?? ''));
    }
  }

  formatTime(time: string): string {
    return formatEventTime(time);
  }

  mapsUrl(): string | null {
    const e = this.event()!;
    return this.eventsService.mapsUrl(e.locationLat, e.locationLng, e.locationAddress);
  }

  // Private venue whose address (and, server-side, photos) are withheld from
  // this viewer until they RSVP Going.
  isPrivateHidden(): boolean {
    const loc = this.event()!.location;
    return !!loc?.isPrivate && !loc.address;
  }

  googleCalendarUrl(): string {
    return this.eventsService.googleCalendarUrl(this.event()!);
  }

  icsUrl(): string {
    return `/api/v1/events/${this.event()!.id}/ics`;
  }

  appleCalendarUrl(): string {
    const ics = `${window.location.origin}/api/v1/events/${this.event()!.id}/ics`;
    return `webcal://${ics.replace(/^https?:\/\//, '')}`;
  }

  isLoggedIn(): boolean {
    return this.authService.isLoggedIn();
  }

  isNonValidated(): boolean {
    return this.authService.isNonValidated();
  }

  initials(name: string): string {
    return sharedInitials(name);
  }

  namedGuests(names: string[] | null): string {
    if (!names) return '';
    return names.filter((n) => n.trim()).join(', ');
  }

  guestLinkAt(rsvp: Rsvp, index: number): GuestLink | undefined {
    return rsvp.guestLinks?.[index];
  }

  guestLinkTooltip(index: number): string {
    const rsvp = this.myRsvp();
    if (!rsvp) return 'Generate guest link';
    const link = rsvp.guestLinks?.[index];
    if (!link) return 'Generate & copy guest link';
    if (link.cancelledAt) return "Guest can't make it";
    if (link.usedAt) return 'Guest confirmed';
    return 'Copy guest link';
  }

  private refreshEvent(id: number, preservedEmails?: string[], expandIndex?: number | null): void {
    this.eventsService.getOne(id).subscribe({
      next: (e) => {
        this.event.set(e);
        const my = e.rsvps.find((r) => r.userId === this.authService.currentUser()?.id);
        this.guestsCtrl.setValue(my?.additionalGuests ?? 0);
        this.bringingCtrl.setValue(my?.bringingItem ?? '');
        this.rebuildNameControls(
          my?.additionalGuests ?? 0,
          my?.guestNames ?? null,
          preservedEmails,
        );
        this.rsvpLoading.set(false);
        if (expandIndex != null) this.editingGuestIndex.set(expandIndex);
      },
      error: () => this.rsvpLoading.set(false),
    });
  }

  addRsvp(status: RsvpStatus = 'going'): void {
    const id = this.event()!.id;
    this.rsvpLoading.set(true);
    this.eventsService.rsvp(id, status, 0, undefined, this.bringingCtrl.value || undefined).subscribe({
      next: () => {
        this.refreshEvent(id);
        const msg = status === 'going' ? "You're going! 🎉" : 'Marked as Maybe!';
        this.snackBar.open(msg, 'OK', { duration: 3000 });
      },
      error: (err) => {
        this.rsvpLoading.set(false);
        this.snackBar.open(err?.error?.message ?? 'RSVP failed', 'OK', { duration: 4000 });
      },
    });
  }

  onRsvpStatusChange(newStatus: RsvpStatus): void {
    if (newStatus === 'not_going') {
      this.removeRsvp();
      return;
    }
    const id = this.event()!.id;
    const rsvp = this.myRsvp()!;
    this.rsvpLoading.set(true);
    this.eventsService
      .rsvp(id, newStatus, rsvp.additionalGuests, rsvp.guestNames ?? undefined, rsvp.bringingItem ?? undefined)
      .subscribe({
        next: () => {
          this.refreshEvent(id);
          const msg = newStatus === 'going' ? 'Changed to Going!' : 'Changed to Maybe!';
          this.snackBar.open(msg, 'OK', { duration: 2000 });
        },
        error: (err) => {
          this.rsvpLoading.set(false);
          this.snackBar.open(err?.error?.message ?? 'Failed to update', 'OK', { duration: 4000 });
        },
      });
  }

  updateGuests(additionalGuests: number): void {
    const id = this.event()!.id;
    const oldCount = this.guestNameControls.length;
    const names = this.guestNameControls.map((c) => c.value);
    const emails = this.guestEmailControls.map((c) => c.value);
    const status = this.myRsvp()?.status ?? 'going';
    this.eventsService.rsvp(id, status, additionalGuests, names, this.bringingCtrl.value || undefined).subscribe({
      next: () =>
        this.refreshEvent(id, emails, additionalGuests > oldCount ? additionalGuests - 1 : null),
      error: () => this.snackBar.open('Failed to update guests', 'OK', { duration: 3000 }),
    });
  }

  // Residence events only (Phase 35) — saved on blur so a member can type
  // freely without re-submitting the whole RSVP on every keystroke.
  updateBringingItem(): void {
    const id = this.event()!.id;
    const rsvp = this.myRsvp();
    if (!rsvp) return;
    const value = this.bringingCtrl.value;
    if ((rsvp.bringingItem ?? '') === value) return; // unchanged, skip the request
    this.eventsService
      .rsvp(id, rsvp.status, rsvp.additionalGuests, rsvp.guestNames ?? undefined, value || undefined)
      .subscribe({
        next: () => this.refreshEvent(id),
        error: (err) =>
          this.snackBar.open(err?.error?.message ?? 'Failed to save', 'OK', { duration: 3000 }),
      });
  }

  removeRsvp(): void {
    const id = this.event()!.id;
    this.rsvpLoading.set(true);
    this.eventsService.unrsvp(id).subscribe({
      next: () => {
        this.refreshEvent(id);
        this.snackBar.open('RSVP removed', 'OK', { duration: 3000 });
      },
      error: () => {
        this.rsvpLoading.set(false);
        this.snackBar.open('Failed to remove RSVP', 'OK', { duration: 3000 });
      },
    });
  }

  saveGuestNames(): void {
    const id = this.event()!.id;
    const rsvp = this.myRsvp()!;
    const names = this.guestNameControls.map((c) => c.value);
    const emails = this.guestEmailControls.map((c) => c.value);
    this.savingNames.set(true);
    this.eventsService.rsvp(id, rsvp.status, rsvp.additionalGuests, names).subscribe({
      next: () => {
        // Auto-generate links (and queue invite emails) for guests who have an email but no link yet
        const linkTasks = emails
          .map((email, i) => ({ email: email.trim(), i }))
          .filter(({ email, i }) => email && !this.guestLinkAt(rsvp, i))
          .map(({ email, i }) =>
            this.eventsService.generateGuestLink(id, names[i] || undefined, email),
          );

        if (linkTasks.length === 0) {
          this.refreshEvent(id, emails);
          this.savingNames.set(false);
          this.snackBar.open('Guest names saved', 'OK', { duration: 2000 });
          return;
        }

        forkJoin(linkTasks).subscribe({
          next: () => {
            this.refreshEvent(id, emails);
            this.savingNames.set(false);
            const n = linkTasks.length;
            this.snackBar.open(
              `Names saved — ${n} invite email${n !== 1 ? 's' : ''} queued`,
              'OK',
              { duration: 3000 },
            );
          },
          error: () => {
            this.refreshEvent(id, emails);
            this.savingNames.set(false);
            this.snackBar.open('Names saved — some invites may have failed to send', 'OK', {
              duration: 3000,
            });
          },
        });
      },
      error: () => {
        this.savingNames.set(false);
        this.snackBar.open('Failed to save names', 'OK', { duration: 3000 });
      },
    });
  }

  generateAndCopyLink(index: number): void {
    const rsvp = this.myRsvp()!;
    const existingLink = rsvp.guestLinks?.[index];

    // Always allow copying an existing link so the member can re-send it
    if (existingLink) {
      const url = `${window.location.origin}/rsvp-guest?token=${existingLink.token}`;
      this.clipboard.copy(url);
      const msg = existingLink.cancelledAt
        ? 'Link copied — guest can re-RSVP with this'
        : existingLink.usedAt
          ? 'Link copied — guest already confirmed'
          : 'Link copied!';
      this.snackBar.open(msg, 'OK', { duration: 3000 });
      return;
    }

    const id = this.event()!.id;
    const recipientName = this.guestNameControls[index]?.value || undefined;
    const recipientEmail = this.guestEmailControls[index]?.value || undefined;
    this.generatingLinkIndex.set(index);

    this.eventsService.generateGuestLink(id, recipientName, recipientEmail).subscribe({
      next: (link) => {
        this.generatingLinkIndex.set(null);
        const url = `${window.location.origin}/rsvp-guest?token=${link.token}`;
        this.clipboard.copy(url);
        this.snackBar.open('Guest link copied to clipboard!', 'OK', { duration: 3000 });
        this.refreshEvent(id);
      },
      error: (err) => {
        this.generatingLinkIndex.set(null);
        const msg = err?.error?.message ?? 'Failed to generate link';
        this.snackBar.open(msg, 'OK', { duration: 4000 });
      },
    });
  }

  removeLink(linkId: number): void {
    if (
      !window.confirm(
        'Remove this guest? Their link will stop working and your guest count will decrease by 1.',
      )
    )
      return;
    const id = this.event()!.id;
    this.removingLinkId.set(linkId);
    this.eventsService.removeGuestLink(id, linkId).subscribe({
      next: () => {
        this.removingLinkId.set(null);
        this.refreshEvent(id);
        this.snackBar.open('Guest removed', 'OK', { duration: 2000 });
      },
      error: () => {
        this.removingLinkId.set(null);
        this.snackBar.open('Failed to remove guest', 'OK', { duration: 3000 });
      },
    });
  }

  copyExistingLink(token: string): void {
    const url = `${window.location.origin}/rsvp-guest?token=${token}`;
    this.clipboard.copy(url);
    this.snackBar.open('Link copied to clipboard!', 'OK', { duration: 2000 });
  }

  isAdminOrMod(): boolean {
    const role = this.authService.currentUser()?.role;
    return role === 'admin' || role === 'moderator';
  }

  openEdit(): void {
    const ref = this.dialog.open(EventFormDialogComponent, {
      data: { event: this.event() },
      width: '600px',
      maxWidth: '95vw',
    });
    ref.afterClosed().subscribe((updated: Event | undefined) => {
      if (updated) {
        this.eventsService.getOne(updated.id).subscribe((fresh) => this.event.set(fresh));
        const resync = updated.secretDinnerResync;
        if (resync?.enabled === true && resync.awarded > 0) {
          this.snackBar.open(
            `Secret ${this.brand.dinnerSingularLower()} marked — awarded ${resync.awarded} already-attended member${resync.awarded === 1 ? '' : 's'}`,
            'OK',
            { duration: 4000 },
          );
        } else if (resync?.enabled === false && resync.removed > 0) {
          this.snackBar.open(
            `Secret ${this.brand.dinnerSingularLower()} unmarked — removed points from ${resync.removed} member${resync.removed === 1 ? '' : 's'}`,
            'OK',
            { duration: 4000 },
          );
        }
      }
    });
  }

  publish(): void {
    const e = this.event()!;
    this.eventsService.update(e.id, { status: 'published' }).subscribe({
      next: (updated) => {
        this.event.set(updated);
        this.snackBar.open('Event published', 'OK', { duration: 3000 });
      },
      error: () => this.snackBar.open('Failed to publish event', 'OK', { duration: 3000 }),
    });
  }

  cancel(): void {
    const reason = window.prompt('Cancellation reason (optional):') ?? '';
    const e = this.event()!;
    this.eventsService
      .update(e.id, { status: 'cancelled', cancelledReason: reason || null })
      .subscribe({
        next: (updated) => {
          this.event.set(updated);
          this.snackBar.open('Event cancelled', 'OK', { duration: 3000 });
        },
        error: () => this.snackBar.open('Failed to cancel event', 'OK', { duration: 3000 }),
      });
  }

  restore(): void {
    const e = this.event()!;
    this.eventsService.update(e.id, { status: 'draft' }).subscribe({
      next: (updated) => {
        this.event.set(updated);
        this.snackBar.open('Event restored to draft', 'OK', { duration: 3000 });
      },
      error: () => this.snackBar.open('Failed to restore event', 'OK', { duration: 3000 }),
    });
  }

  deleteEvent(): void {
    if (!window.confirm('Permanently delete this event? This cannot be undone.')) return;
    const e = this.event()!;
    this.eventsService.delete(e.id).subscribe({
      next: () => {
        this.snackBar.open('Event deleted', 'OK', { duration: 3000 });
        void this.router.navigate(['/events']);
      },
      error: () => this.snackBar.open('Failed to delete event', 'OK', { duration: 3000 }),
    });
  }

  submitPublicRsvp(): void {
    const name = this.publicRsvpName().trim();
    const email = this.publicRsvpEmail().trim();
    if (!name || !email) return;
    this.publicRsvpLoading.set(true);
    this.publicRsvpError.set(null);
    this.eventsService.publicRsvp(this.event()!.id, name, email).subscribe({
      next: () => {
        this.publicRsvpLoading.set(false);
        this.publicRsvpDone.set(true);
      },
      error: (err) => {
        this.publicRsvpLoading.set(false);
        const msg = err?.error?.message;
        this.publicRsvpError.set(
          msg === 'already_a_member'
            ? 'This email belongs to a member — please log in to RSVP.'
            : (msg ?? 'Something went wrong. Please try again.'),
        );
      },
    });
  }

  isAdmin(): boolean {
    return this.authService.currentUser()?.role === 'admin';
  }

  startReassign(): void {
    this.reservationReassigning.set(true);
    this.reservationMemberSearch.set('');
    this.reservationMemberResults.set([]);
    this.reservationContactName.set('');
    this.reservationContactEmail.set('');
  }

  memberMarkReservationConfirmed(): void {
    const id = this.event()!.id;
    this.reservationSaving.set(true);
    this.eventsService.setReservation(id, { confirmed: true }).subscribe({
      next: (updated) => {
        this.event.set(updated);
        this.reservationSaving.set(false);
        this.snackBar.open('Reservation marked as confirmed!', 'OK', { duration: 2000 });
      },
      error: () => {
        this.reservationSaving.set(false);
        this.snackBar.open('Failed to update', 'OK', { duration: 3000 });
      },
    });
  }

  onReservationMemberSearch(value: string): void {
    this.reservationMemberSearch.set(value);
    this.reservationSearch$.next(value);
  }

  assignReservationMember(member: MemberSearchResult): void {
    const id = this.event()!.id;
    this.reservationSaving.set(true);
    this.eventsService.setReservation(id, { assigneeId: member.id }).subscribe({
      next: (updated) => {
        this.event.set(updated);
        this.reservationSaving.set(false);
        this.reservationReassigning.set(false);
        this.showCoordinatorAssignForm.set(false);
        this.reservationMemberSearch.set('');
        this.reservationMemberResults.set([]);
        this.snackBar.open(`${member.fullName} assigned — email sent`, 'OK', { duration: 3000 });
      },
      error: () => {
        this.reservationSaving.set(false);
        this.snackBar.open('Failed to assign', 'OK', { duration: 3000 });
      },
    });
  }

  sendReservationToContact(): void {
    const name = this.reservationContactName().trim();
    const email = this.reservationContactEmail().trim();
    if (!name || !email) return;
    const id = this.event()!.id;
    this.reservationSaving.set(true);
    this.eventsService.setReservation(id, { contactName: name, contactEmail: email }).subscribe({
      next: (updated) => {
        this.event.set(updated);
        this.reservationSaving.set(false);
        this.reservationReassigning.set(false);
        this.showCoordinatorAssignForm.set(false);
        this.reservationContactName.set('');
        this.reservationContactEmail.set('');
        this.snackBar.open('Contact assigned — email sent', 'OK', { duration: 3000 });
      },
      error: () => {
        this.reservationSaving.set(false);
        this.snackBar.open('Failed to assign contact', 'OK', { duration: 3000 });
      },
    });
  }

  clearReservation(): void {
    if (!window.confirm('Clear the current reservation assignment?')) return;
    const id = this.event()!.id;
    this.eventsService
      .setReservation(id, { assigneeId: null, contactName: null, contactEmail: null })
      .subscribe({
        next: (updated) => {
          this.event.set(updated);
          this.snackBar.open('Reservation cleared', 'OK', { duration: 2000 });
        },
        error: () => this.snackBar.open('Failed to clear', 'OK', { duration: 3000 }),
      });
  }

  toggleReservationConfirmed(confirmed: boolean): void {
    const id = this.event()!.id;
    const note = confirmed ? this.reservationConfirmNote().trim() || null : null;
    this.reservationSaving.set(true);
    this.eventsService.setReservation(id, { confirmed, confirmedNote: note }).subscribe({
      next: (updated) => {
        this.event.set(updated);
        this.reservationSaving.set(false);
        this.showConfirmNoteInput.set(false);
        this.reservationConfirmNote.set('');
        this.snackBar.open(
          confirmed ? 'Reservation marked as confirmed!' : 'Confirmation cleared',
          'OK',
          { duration: 2000 },
        );
      },
      error: () => {
        this.reservationSaving.set(false);
        this.snackBar.open('Failed to update', 'OK', { duration: 3000 });
      },
    });
  }

  goBack(): void {
    void this.router.navigate(['/events']);
  }

  currentUserId(): number | null {
    return this.authService.currentUser()?.id ?? null;
  }

  private loadComments(eventId: number): void {
    this.commentsLoading.set(true);
    this.commentsService.getComments(eventId).subscribe({
      next: (c) => {
        this.comments.set(c);
        this.commentsLoading.set(false);
      },
      error: () => this.commentsLoading.set(false),
    });
  }

  submitComment(): void {
    const body = this.newCommentBody().trim();
    if (!body) return;
    const id = this.event()!.id;
    this.submittingComment.set(true);
    this.commentsService.addComment(id, body).subscribe({
      next: (c) => {
        this.comments.update((list) => [...list, c]);
        this.newCommentBody.set('');
        this.submittingComment.set(false);
      },
      error: () => {
        this.submittingComment.set(false);
        this.snackBar.open('Failed to post comment', 'OK', { duration: 3000 });
      },
    });
  }

  isEditing(kind: 'comment' | 'reply', id: number): boolean {
    const t = this.editingTarget();
    return t !== null && t.kind === kind && t.id === id;
  }

  startEdit(kind: 'comment' | 'reply', id: number, body: string | null): void {
    this.editingTarget.set({ kind, id });
    this.editBody.set(body ?? '');
    this.replyingToId.set(null);
  }

  cancelEdit(): void {
    this.editingTarget.set(null);
    this.editBody.set('');
  }

  // replyId omitted edits the top-level comment; supplied edits that reply.
  saveEdit(commentId: number, replyId?: number): void {
    const body = this.editBody().trim();
    if (!body || this.savingEdit()) return;
    const id = this.event()!.id;
    this.savingEdit.set(true);

    const done = () => {
      this.savingEdit.set(false);
      this.cancelEdit();
    };
    const fail = (err: { error?: { message?: string } }) => {
      this.savingEdit.set(false);
      this.snackBar.open(err?.error?.message ?? 'Failed to save changes', 'OK', { duration: 3000 });
    };

    if (replyId === undefined) {
      this.commentsService.editComment(id, commentId, body).subscribe({
        next: (updated) => {
          this.comments.update((list) =>
            list.map((c) =>
              c.id === commentId ? { ...c, body: updated.body, editedAt: updated.editedAt } : c,
            ),
          );
          done();
        },
        error: fail,
      });
    } else {
      this.commentsService.editReply(id, commentId, replyId, body).subscribe({
        next: (updated) => {
          this.comments.update((list) =>
            list.map((c) =>
              c.id === commentId
                ? {
                    ...c,
                    replies: c.replies.map((r) =>
                      r.id === replyId ? { ...r, body: updated.body, editedAt: updated.editedAt } : r,
                    ),
                  }
                : c,
            ),
          );
          done();
        },
        error: fail,
      });
    }
  }

  deleteComment(commentId: number): void {
    if (!window.confirm('Remove this comment?')) return;
    const id = this.event()!.id;
    this.commentsService.deleteComment(id, commentId).subscribe({
      next: () =>
        this.comments.update((list) =>
          list.map((c) => (c.id === commentId ? { ...c, body: null, deleted: true } : c)),
        ),
      error: () => this.snackBar.open('Failed to remove comment', 'OK', { duration: 3000 }),
    });
  }

  submitReply(commentId: number): void {
    const body = this.newReplyBody().trim();
    if (!body) return;
    const id = this.event()!.id;
    this.submittingReply.set(true);
    this.commentsService.addReply(id, commentId, body).subscribe({
      next: (reply) => {
        this.comments.update((list) =>
          list.map((c) => (c.id === commentId ? { ...c, replies: [...c.replies, reply] } : c)),
        );
        this.newReplyBody.set('');
        this.replyingToId.set(null);
        this.submittingReply.set(false);
      },
      error: () => {
        this.submittingReply.set(false);
        this.snackBar.open('Failed to post reply', 'OK', { duration: 3000 });
      },
    });
  }

  deleteReply(commentId: number, replyId: number): void {
    if (!window.confirm('Remove this reply?')) return;
    const id = this.event()!.id;
    this.commentsService.deleteReply(id, commentId, replyId).subscribe({
      next: () =>
        this.comments.update((list) =>
          list.map((c) =>
            c.id === commentId
              ? {
                  ...c,
                  replies: c.replies.map((r) =>
                    r.id === replyId ? { ...r, body: null, deleted: true } : r,
                  ),
                }
              : c,
          ),
        ),
      error: () => this.snackBar.open('Failed to remove reply', 'OK', { duration: 3000 }),
    });
  }

  openShareInvitesDialog(): void {
    this.dialog.open(ShareInvitesDialogComponent, {
      data: { event: this.event()!, isAdmin: this.isAdmin() },
      width: '480px',
      maxWidth: '95vw',
    });
  }

  openAttendanceDialog(): void {
    this.dialog.open(AttendanceDialogComponent, {
      data: { eventId: this.event()!.id, isAdmin: this.isAdmin() },
      width: '520px',
      maxWidth: '95vw',
    });
  }

  openAchievementAdminDialog(): void {
    this.dialog.open(AchievementAdminDialogComponent, {
      data: {
        eventId: this.event()!.id,
        achievement: this.eventAchievement(),
        onChange: (a: EventAchievement | null) => this.eventAchievement.set(a),
      },
      width: '480px',
      maxWidth: '95vw',
    });
  }
}

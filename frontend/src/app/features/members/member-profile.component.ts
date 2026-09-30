import {
  Component,
  computed,
  inject,
  OnInit,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/services/auth.service';
import { BrandConfigService } from '../../core/services/brand-config.service';
import { CommunityService, Achievement, PointSummary } from '../../core/services/community.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { PointsHistoryDialogComponent } from './points-history-dialog.component';

interface MiniMember {
  id: number;
  fullName: string;
  profilePhotoPath: string | null;
}

interface MemberProfile {
  id: number;
  fullName: string;
  profilePhotoPath: string | null;
  cityName: string | null;
  joinedAt: string;
  isAdmin?: boolean;
  role?: string;
  status?: string;
  inviteSource?: string | null;
  invitedBy: MiniMember | null;
  invitedMembers?: MiniMember[];
  hasFacebook?: boolean;
  facebookProfileUrl?: string | null;
  googleEmail?: string | null;
  isAutomationAccount?: boolean;
}

// Built from the configured terminology (see brand-config) so labels track a
// renamed instance's venue/gathering terms.
function buildProgressLabels(b: BrandConfigService): Record<string, string> {
  return {
    attendance: `${b.dinnerPlural()} Attended`,
    coordinator: 'Events Coordinated',
    new_location_coordinator: `New ${b.locationPlural()} Coordinated`,
    invite: 'Members Invited',
    rating: `${b.locationSingular()} Ratings`,
    founding: b.foundingLabel(),
    event: `Special ${b.dinnerSingular()}`,
  };
}

function buildAchievementCategories(
  b: BrandConfigService,
): Record<string, { label: string; icon: string }> {
  return {
    attendance: { label: 'Attendance', icon: 'local_dining' },
    coordinator: { label: 'Coordinator', icon: 'event_available' },
    new_location_coordinator: { label: 'Scout', icon: 'travel_explore' },
    invite: { label: 'Invites', icon: 'person_add' },
    rating: { label: 'Ratings', icon: 'star' },
    city_hopper: { label: 'City Hopper', icon: 'flight' },
    secret_dinner: { label: `Secret ${b.dinnerPlural()}`, icon: 'lock' },
    founding: { label: b.foundingLabel(), icon: 'history_edu' },
    event: { label: `Special ${b.dinnerPlural()}`, icon: 'celebration' },
    login: { label: 'Site Visits', icon: 'login' },
    other: { label: 'Special', icon: 'emoji_events' },
  };
}

const ACHIEVEMENT_CATEGORY_ORDER = [
  'attendance',
  'coordinator',
  'new_location_coordinator',
  'invite',
  'rating',
  'city_hopper',
  'secret_dinner',
  'login',
  'founding',
  'event',
  'other',
];

interface AchievementGroup {
  category: string;
  label: string;
  icon: string;
  earned: Achievement[];
  next: Achievement | null;
  allComplete: boolean;
  isProgressive: boolean;
}

@Component({
  selector: 'app-member-profile',
  standalone: true,
  imports: [
    RouterLink,
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDialogModule,
    MatIconModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  template: `
    <div class="profile-view-container">
      @if (loading()) {
        <div class="loading"><mat-spinner diameter="40" /></div>
      } @else if (profile()) {
        <!-- Profile card with paw badge -->
        <div class="card-wrap">
          @if ((points()?.total ?? 0) > 0 && !profile()?.isAdmin) {
            <div
              class="paw-badge"
              [class.paw-badge-clickable]="isSelf() || showElevated()"
              [attr.role]="isSelf() || showElevated() ? 'button' : null"
              [attr.tabindex]="isSelf() || showElevated() ? 0 : null"
              (click)="openPointsHistory()"
              (keydown.enter)="openPointsHistory()"
            >
              <svg viewBox="0 0 56 54" xmlns="http://www.w3.org/2000/svg" class="paw-svg">
                <circle cx="10" cy="20" r="7" fill="#8B5E3C" />
                <circle cx="21" cy="13" r="7" fill="#8B5E3C" />
                <circle cx="35" cy="13" r="7" fill="#8B5E3C" />
                <circle cx="46" cy="20" r="7" fill="#8B5E3C" />
                <circle cx="28" cy="38" r="14" fill="#8B5E3C" />
                <text
                  x="28"
                  y="38"
                  text-anchor="middle"
                  dominant-baseline="central"
                  fill="white"
                  font-size="13"
                  font-weight="800"
                  font-family="system-ui,sans-serif"
                >
                  {{ points()!.total }}
                </text>
              </svg>
            </div>
          }
          <mat-card>
            <mat-card-content>
              <div class="profile-header">
                <div class="avatar-wrap">
                  @if (profile()!.profilePhotoPath) {
                    <img
                      [src]="profile()!.profilePhotoPath"
                      alt="Profile photo"
                      class="profile-photo"
                      [class.photo-banned]="profile()!.status === 'suspended'"
                    />
                  } @else {
                    <img
                      src="/assets/default-avatar.svg"
                      alt="Member"
                      class="profile-photo"
                      [class.photo-banned]="profile()!.status === 'suspended'"
                    />
                  }
                </div>
                <div class="profile-meta">
                  <h2 class="profile-name">{{ profile()!.fullName }}</h2>
                  @if (profile()!.cityName) {
                    <span class="profile-city">{{ profile()!.cityName }}</span>
                  }
                  <span class="profile-joined"
                    >Member since {{ profile()!.joinedAt | date: 'MMMM yyyy' }}</span
                  >
                  <div class="profile-badges">
                    @if (showElevated() && profile()!.role && profile()!.role !== 'member') {
                      <mat-chip [class]="'role-' + profile()!.role">{{ profile()!.role }}</mat-chip>
                    }
                    @if (showElevated() && profile()!.role === 'non_validated') {
                      <mat-chip class="chip-non-validated">Non-Validated</mat-chip>
                    }
                    @if (profile()!.status === 'suspended') {
                      <mat-chip class="chip-banned">Banned</mat-chip>
                    }
                  </div>
                  @if (showElevated()) {
                    <div class="provider-badges">
                      @if (profile()!.hasFacebook) {
                        @if (profile()!.facebookProfileUrl) {
                          <a
                            [href]="profile()!.facebookProfileUrl!"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="provider-badge badge-fb"
                            title="View Facebook profile"
                            >fb</a
                          >
                        } @else {
                          <span class="provider-badge badge-fb" title="Facebook connected">fb</span>
                        }
                      }
                      @if (profile()!.googleEmail) {
                        <a
                          [href]="
                            'https://mail.google.com/mail/?view=cm&fs=1&to=' +
                            profile()!.googleEmail!
                          "
                          target="_blank"
                          rel="noopener noreferrer"
                          class="provider-badge badge-g"
                          title="Send Gmail to {{ profile()!.googleEmail }}"
                          >G</a
                        >
                      }
                    </div>
                  }
                </div>
              </div>

              <!-- Edit own profile link -->
              @if (isSelf()) {
                <div class="edit-row">
                  <a mat-stroked-button routerLink="/profile">
                    <mat-icon>edit</mat-icon> Edit My Profile
                  </a>
                </div>
              }

              <!-- Invited by / Self-Invited -->
              @if (showElevated() && profile()!.inviteSource === 'non_validated_link') {
                <div class="invited-section">
                  <span class="invited-label">Joined via</span>
                  <span class="self-invited-badge">
                    <mat-icon class="self-invited-icon">link</mat-icon> Self-Invited via event link
                  </span>
                </div>
              } @else if (profile()!.invitedBy) {
                <div class="invited-section">
                  <span class="invited-label">Invited by</span>
                  <a class="mini-member" [routerLink]="['/members', profile()!.invitedBy!.id]">
                    <div class="mini-avatar">
                      @if (profile()!.invitedBy!.profilePhotoPath) {
                        <img
                          [src]="profile()!.invitedBy!.profilePhotoPath"
                          [alt]="profile()!.invitedBy!.fullName"
                        />
                      } @else {
                        <img
                          src="/assets/default-avatar.svg"
                          [alt]="profile()!.invitedBy!.fullName"
                        />
                      }
                    </div>
                    <span>{{ profile()!.invitedBy!.fullName }}</span>
                  </a>
                </div>
              }

              <!-- Members they invited -->
              @if ((profile()!.invitedMembers?.length ?? 0) > 0) {
                <div class="invited-section">
                  <span class="invited-label">Brought to the table</span>
                  <div class="mini-members-list">
                    @for (m of profile()!.invitedMembers!; track m.id) {
                      <a class="mini-member" [routerLink]="['/members', m.id]">
                        <div class="mini-avatar">
                          @if (m.profilePhotoPath) {
                            <img [src]="m.profilePhotoPath" [alt]="m.fullName" />
                          } @else {
                            <img src="/assets/default-avatar.svg" [alt]="m.fullName" />
                          }
                        </div>
                        <span>{{ m.fullName }}</span>
                      </a>
                    }
                  </div>
                </div>
              }

              <!-- Role selector (admin only, not own profile, not other admins —
                   except the automation account, which can be flipped back down) -->
              @if (isAdmin() && !isSelf() && (profile()!.role !== 'admin' || profile()!.isAutomationAccount)) {
                <div class="role-section">
                  <span class="role-section-label">Role</span>
                  <mat-select
                    [value]="profile()!.role"
                    (selectionChange)="setRole($event.value)"
                    class="role-select"
                  >
                    <mat-option value="member">Member</mat-option>
                    <mat-option value="moderator">Moderator</mat-option>
                    @if (profile()!.isAutomationAccount) {
                      <mat-option value="admin">Admin</mat-option>
                      <mat-option value="automation">Claude Automation</mat-option>
                      <mat-option value="muse">Muse Automation</mat-option>
                    }
                  </mat-select>
                </div>
              }

              <!-- Validate Member (mod/admin only, non-validated status) -->
              @if (showElevated() && !isSelf() && profile()!.role === 'non_validated') {
                <div class="validate-section">
                  <p class="validate-info">
                    <mat-icon class="validate-info-icon">info_outline</mat-icon>
                    This member joined via a self-serve event link. Validate them to grant full
                    membership.
                  </p>
                  <button
                    mat-raised-button
                    color="primary"
                    (click)="validateMember()"
                    [disabled]="validating()"
                  >
                    @if (validating()) {
                      <mat-spinner diameter="18" />
                    }
                    <mat-icon>verified_user</mat-icon> Validate Member
                  </button>
                </div>
              }

              <!-- Ban controls (mod/admin only, not own profile) -->
              @if (showBanControls()) {
                <div class="ban-section">
                  @if (profile()!.status === 'active') {
                    <button mat-stroked-button color="warn" (click)="ban()">
                      <mat-icon>block</mat-icon> Ban Member
                    </button>
                    @if (isAdmin()) {
                      <button
                        mat-stroked-button
                        color="warn"
                        (click)="forceBan()"
                        class="force-ban-btn"
                        matTooltip="Removes from member list, kept for audit"
                      >
                        <mat-icon>gavel</mat-icon> Forceful Ban
                      </button>
                    }
                  } @else if (profile()!.status === 'suspended') {
                    @if (isAdmin()) {
                      <button mat-stroked-button (click)="unban()">
                        <mat-icon>check_circle</mat-icon> Unban Member
                      </button>
                      <button
                        mat-stroked-button
                        color="warn"
                        (click)="forceBan()"
                        class="force-ban-btn"
                        matTooltip="Permanently removes from member list"
                      >
                        <mat-icon>gavel</mat-icon> Forceful Ban
                      </button>
                    }
                  }
                </div>
              }
            </mat-card-content>
          </mat-card>
        </div>

        <!-- Achievements -->
        @if (groupedAchievements().length > 0) {
          <div class="achievements-section">
            <h3 class="section-title">Achievements</h3>
            @for (group of groupedAchievements(); track group.category) {
              <mat-card class="ach-group-card">
                <div class="ach-group-header">
                  <mat-icon class="ach-group-icon">{{ group.icon }}</mat-icon>
                  <span class="ach-group-label">{{ group.label }}</span>
                  @if (group.isProgressive && group.allComplete) {
                    <span class="ach-complete-badge">All unlocked</span>
                  }
                </div>

                @if (group.earned.length > 0) {
                  <div class="ach-earned-list">
                    @for (a of group.earned; track a.id) {
                      <div class="ach-earned-row">
                        @if (a.imagePath) {
                          <img [src]="a.imagePath" [alt]="a.name" class="ach-row-img" />
                        } @else if (isImgIcon(a.icon)) {
                          <img [src]="imgIconSrc(a.icon)" [alt]="a.name" class="ach-row-img" />
                        } @else {
                          <mat-icon class="ach-icon">{{ a.icon }}</mat-icon>
                        }
                        <div class="ach-earned-info">
                          <span class="ach-earned-name">{{ a.name }}</span>
                          @if (a.title) {
                            <span class="ach-title-badge">{{ a.title }}</span>
                          }
                        </div>
                        @if (a.earnedAt) {
                          <span class="ach-earned-when">{{ a.earnedAt | date: 'MMM d, y' }}</span>
                        }
                      </div>
                    }
                  </div>
                }

                @if (group.next; as next) {
                  <div class="ach-next" [class.with-divider]="group.earned.length > 0">
                    <div class="ach-next-row">
                      <mat-icon class="ach-lock-icon">lock</mat-icon>
                      <div class="ach-next-info">
                        <span class="ach-next-name">{{ next.name }}</span>
                        @if (next.title) {
                          <span class="ach-next-title-hint">Unlocks title: {{ next.title }}</span>
                        }
                        <span class="ach-next-desc">{{ next.description }}</span>
                      </div>
                    </div>
                    @if (
                      next.progressTarget &&
                      next.progressType !== 'founding' &&
                      next.progressType !== 'event'
                    ) {
                      <div class="ach-next-progress">
                        <mat-progress-bar
                          mode="determinate"
                          [value]="progressPct(next)"
                        ></mat-progress-bar>
                        <div class="ach-progress-label">
                          {{ next.progressCurrent }} of {{ next.progressTarget }}
                          {{ progressLabel(next.progressType) }}
                        </div>
                      </div>
                    }
                  </div>
                }
              </mat-card>
            }
          </div>
        }
      } @else {
        <p>Member not found.</p>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .profile-view-container {
        max-width: 600px;
        margin: 0 auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .loading {
        display: flex;
        justify-content: center;
        padding: 48px;
      }

      /* Card wrap for paw badge positioning */
      .card-wrap {
        position: relative;
      }
      .paw-badge {
        position: absolute;
        top: -12px;
        right: 12px;
        z-index: 2;
      }
      .paw-badge-clickable {
        cursor: pointer;
      }
      .paw-svg {
        width: 46px;
        height: 46px;
        filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.18));
      }

      .profile-header {
        display: flex;
        gap: 24px;
        align-items: flex-start;
        padding: 8px 0 16px;
      }
      .avatar-wrap {
        flex-shrink: 0;
      }
      .profile-photo,
      .photo-placeholder {
        width: 96px;
        height: 96px;
        border-radius: 50%;
        object-fit: cover;
        border: 3px solid #eee;
      }
      .photo-placeholder {
        background: #f0f0f0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2.5rem;
      }
      .photo-banned {
        opacity: 0.5;
        filter: grayscale(1);
      }
      .profile-meta {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .profile-name {
        margin: 0;
        font-size: 1.4rem;
      }
      .profile-city {
        color: #777;
        font-size: 0.9rem;
      }
      .profile-joined {
        color: #aaa;
        font-size: 0.8rem;
      }
      .profile-badges {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 4px;
      }
      .provider-badges {
        display: flex;
        gap: 6px;
        margin-top: 8px;
      }
      .provider-badge {
        font-size: 0.8rem;
        font-weight: 700;
        padding: 4px 12px;
        border-radius: 20px;
        text-decoration: none;
        letter-spacing: 0.03em;
        display: inline-flex;
        align-items: center;
      }
      .badge-fb {
        background: #1877f2;
        color: #fff;
      }
      .badge-g {
        background: #ea4335;
        color: #fff;
      }
      .edit-row {
        margin: 12px 0;
      }
      .invited-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 20px;
      }
      .invited-label {
        font-size: 0.8rem;
        font-weight: 600;
        color: #999;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .mini-members-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .mini-member {
        display: flex;
        align-items: center;
        gap: 8px;
        text-decoration: none;
        color: inherit;
        padding: 6px 10px;
        border-radius: 8px;
        background: #f5f5f5;
        font-size: 0.88rem;
        transition: background 0.12s;
        &:hover {
          background: #ebebeb;
        }
      }
      .mini-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        overflow: hidden;
        background: #e0e0e0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1rem;
        flex-shrink: 0;
        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
      }
      .role-section {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid #f0f0f0;
      }
      .role-section-label {
        font-size: 0.8rem;
        font-weight: 600;
        color: #999;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        white-space: nowrap;
      }
      .role-select {
        width: 160px;
      }
      .ban-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid #f0f0f0;
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .force-ban-btn {
        margin-left: 4px;
      }
      mat-chip {
        font-size: 0.72rem !important;
        min-height: 22px !important;
      }
      .role-admin {
        --mat-chip-label-text-color: #fff;
        background: var(--db-primary) !important;
      }
      .role-moderator {
        --mat-chip-label-text-color: #fff;
        background: var(--db-primary) !important;
      }
      .chip-banned {
        background: #ffccbc !important;
      }
      .chip-non-validated {
        background: #f3e5f5 !important;
        color: #6a1b9a !important;
      }
      .self-invited-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 0.85rem;
        color: #6a1b9a;
        background: #f3e5f5;
        padding: 4px 10px;
        border-radius: 20px;
        .self-invited-icon {
          font-size: 0.9rem;
          width: 0.9rem;
          height: 0.9rem;
        }
      }
      .validate-section {
        margin-top: 16px;
        padding: 16px;
        background: #e8f5e9;
        border: 1px solid #a5d6a7;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .validate-info {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        margin: 0;
        font-size: 0.88rem;
        color: #1b5e20;
        .validate-info-icon {
          font-size: 1rem;
          width: 1rem;
          height: 1rem;
          flex-shrink: 0;
          margin-top: 1px;
        }
      }

      /* Achievements */
      .achievements-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .section-title {
        margin: 0 0 4px;
        font-size: 1.1rem;
        font-weight: 700;
        color: #333;
      }
      .ach-group-card {
        padding: 0 !important;
        overflow: hidden;
      }
      .ach-group-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        background: var(--db-primary);
        color: #fff;
      }
      .ach-group-icon {
        font-size: 1.2rem;
        width: 1.2rem;
        height: 1.2rem;
        flex-shrink: 0;
        opacity: 0.9;
      }
      .ach-group-label {
        font-weight: 700;
        font-size: 0.95rem;
        flex: 1;
      }
      .ach-complete-badge {
        font-size: 0.7rem;
        font-weight: 700;
        background: var(--db-primary);
        color: #fff;
        border-radius: 10px;
        padding: 2px 8px;
        white-space: nowrap;
      }
      .ach-earned-list {
        padding: 4px 0;
      }
      .ach-earned-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 16px;
        &:not(:last-child) {
          border-bottom: 1px solid #f0f0f0;
        }
      }
      .ach-icon {
        color: var(--db-primary);
        font-size: 1.5rem;
        width: 1.5rem;
        height: 1.5rem;
        flex-shrink: 0;
      }
      .ach-row-img {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
      }
      .ach-earned-info {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
        min-width: 0;
        flex-wrap: wrap;
      }
      .ach-earned-name {
        font-size: 0.88rem;
        font-weight: 600;
        color: #222;
      }
      .ach-title-badge {
        font-size: 0.68rem;
        font-weight: 700;
        background: var(--db-primary);
        color: #fff;
        border-radius: 8px;
        padding: 1px 7px;
      }
      .ach-earned-when {
        font-size: 0.72rem;
        color: #aaa;
        white-space: nowrap;
        flex-shrink: 0;
        margin-left: auto;
      }
      .ach-next {
        padding: 10px 16px 12px;
        background: #fafafa;
        &.with-divider {
          border-top: 2px dashed #e8e8e8;
        }
      }
      .ach-next-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin-bottom: 6px;
      }
      .ach-lock-icon {
        color: #bbb;
        font-size: 1.1rem;
        width: 1.1rem;
        height: 1.1rem;
        flex-shrink: 0;
        margin-top: 2px;
      }
      .ach-next-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
      }
      .ach-next-name {
        font-size: 0.88rem;
        font-weight: 600;
        color: #555;
      }
      .ach-next-title-hint {
        font-size: 0.7rem;
        color: var(--db-primary);
        font-weight: 600;
      }
      .ach-next-desc {
        font-size: 0.78rem;
        color: #999;
        line-height: 1.35;
      }
      .ach-next-progress {
        padding-left: 21px;
      }
      .ach-progress-label {
        font-size: 0.72rem;
        color: #888;
        margin-top: 4px;
      }
    `,
  ],
})
export class MemberProfileComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly communityService = inject(CommunityService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  readonly brand = inject(BrandConfigService);

  readonly loading = signal(true);
  readonly validating = signal(false);
  readonly profile = signal<MemberProfile | null>(null);
  readonly points = signal<PointSummary | null>(null);
  readonly achievements = signal<Achievement[] | null>(null);

  readonly groupedAchievements = computed<AchievementGroup[]>(() => {
    const all = this.achievements();
    if (!all) return [];

    const byType = new Map<string, Achievement[]>();
    for (const a of all) {
      if (a.isSecret && !a.earned) continue;
      const key = a.progressType ?? 'other';
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key)!.push(a);
    }

    const groups: AchievementGroup[] = [];

    for (const cat of ACHIEVEMENT_CATEGORY_ORDER) {
      const items = byType.get(cat);
      if (!items || items.length === 0) continue;

      const sorted = [...items].sort((a, b) => (a.progressTarget ?? 0) - (b.progressTarget ?? 0));
      const earned = sorted.filter((a) => a.earned);
      const unearned = sorted.filter((a) => !a.earned);
      const next = unearned[0] ?? null;
      const isProgressive = cat !== 'founding' && cat !== 'event' && cat !== 'other';

      if (earned.length === 0) {
        if (!isProgressive) continue;
        if ((next?.progressCurrent ?? 0) === 0) continue;
      }

      const config = buildAchievementCategories(this.brand)[cat] ?? {
        label: cat,
        icon: 'emoji_events',
      };
      groups.push({
        category: cat,
        label: config.label,
        icon: config.icon,
        earned,
        next,
        allComplete: unearned.length === 0,
        isProgressive,
      });
    }

    return groups;
  });

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.load(id);
  }

  private load(id: number): void {
    this.loading.set(true);
    this.http.get<MemberProfile>(`/api/v1/users/${id}`).subscribe({
      next: (p) => {
        this.profile.set(p);
        this.loading.set(false);
      },
      error: () => {
        this.profile.set(null);
        this.loading.set(false);
      },
    });
    this.communityService.getMemberPoints(id).subscribe({
      next: (p) => this.points.set(p),
      error: () => {},
    });
    this.communityService.getMemberAchievements(id).subscribe({
      next: (a) => this.achievements.set(a),
      error: () => {},
    });
  }

  progressPct(a: Achievement): number {
    if (!a.progressTarget || a.progressTarget === 0) return 0;
    return Math.min(100, Math.round((a.progressCurrent / a.progressTarget) * 100));
  }

  progressLabel(type: string | null): string {
    return type ? (buildProgressLabels(this.brand)[type] ?? type) : '';
  }

  isImgIcon(icon: string): boolean {
    return icon.startsWith('img:');
  }

  imgIconSrc(icon: string): string {
    return icon.slice(4);
  }

  isSelf(): boolean {
    return this.authService.currentUser()?.id === this.profile()?.id;
  }

  isAdmin(): boolean {
    return this.authService.currentUser()?.role === 'admin';
  }

  showElevated(): boolean {
    const role = this.authService.currentUser()?.role;
    return role === 'admin' || role === 'moderator';
  }

  openPointsHistory(): void {
    const p = this.profile();
    if (!p || !(this.isSelf() || this.showElevated())) return;
    this.dialog.open(PointsHistoryDialogComponent, { data: { memberId: p.id } });
  }

  showBanControls(): boolean {
    if (this.isSelf()) return false;
    if (!this.showElevated()) return false;
    const targetRole = this.profile()?.role;
    if (targetRole === 'admin') return false;
    if (!this.isAdmin() && targetRole !== 'member') return false;
    return true;
  }

  ban(): void {
    const p = this.profile();
    if (!p) return;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Ban Member',
        message: `Ban ${p.fullName}? They will be unable to log in but will remain visible in the member list.`,
        confirmLabel: 'Ban',
        confirmColor: 'warn',
      },
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.http.post(`/api/v1/admin/users/${p.id}/ban`, {}).subscribe({
        next: () => {
          this.snackBar.open('Member banned', 'OK', { duration: 3000 });
          this.load(p.id);
        },
        error: (e) => this.snackBar.open(e?.error?.message ?? 'Failed', 'OK', { duration: 4000 }),
      });
    });
  }

  forceBan(): void {
    const p = this.profile();
    if (!p) return;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Forceful Ban',
        message: `Forcefully ban ${p.fullName}? They will be removed from the member list and cannot log in. This is recorded for audit.`,
        confirmLabel: 'Force Ban',
        confirmColor: 'warn',
      },
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.http.post(`/api/v1/admin/users/${p.id}/ban/force`, {}).subscribe({
        next: () => {
          this.snackBar.open('Member forcefully banned', 'OK', { duration: 3000 });
          this.load(p.id);
        },
        error: (e) => this.snackBar.open(e?.error?.message ?? 'Failed', 'OK', { duration: 4000 }),
      });
    });
  }

  unban(): void {
    const p = this.profile();
    if (!p) return;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Unban Member',
        message: `Unban ${p.fullName}? They will be able to log in again.`,
        confirmLabel: 'Unban',
      },
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.http.post(`/api/v1/admin/users/${p.id}/unban`, {}).subscribe({
        next: () => {
          this.snackBar.open('Member unbanned', 'OK', { duration: 3000 });
          this.load(p.id);
        },
        error: (e) => this.snackBar.open(e?.error?.message ?? 'Failed', 'OK', { duration: 4000 }),
      });
    });
  }

  setRole(role: string): void {
    const p = this.profile();
    if (!p) return;
    this.http.post(`/api/v1/admin/users/${p.id}/role`, { role }).subscribe({
      next: () => {
        this.snackBar.open(`Role updated to ${role}`, 'OK', { duration: 3000 });
        this.load(p.id);
      },
      error: (e) =>
        this.snackBar.open(e?.error?.message ?? 'Failed to update role', 'OK', { duration: 4000 }),
    });
  }

  validateMember(): void {
    const p = this.profile();
    if (!p) return;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Validate Member',
        message: `Vouching for ${p.fullName} upgrades them to full membership. They'll be able to invite guests, submit feedback, and post comments. Only validate someone you've met in person.`,
        confirmLabel: 'I vouch for this person',
        confirmColor: 'primary',
      },
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.validating.set(true);
      this.http.patch(`/api/v1/users/${p.id}/validate`, {}).subscribe({
        next: () => {
          this.validating.set(false);
          this.snackBar.open(`${p.fullName} validated as full member`, 'OK', { duration: 4000 });
          this.load(p.id);
        },
        error: (e) => {
          this.validating.set(false);
          this.snackBar.open(e?.error?.message ?? 'Failed to validate member', 'OK', {
            duration: 4000,
          });
        },
      });
    });
  }
}

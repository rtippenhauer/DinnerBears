import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';
import { moderatorGuard } from './core/guards/moderator.guard';
import { validatedMemberGuard } from './core/guards/validated-member.guard';
import { unsavedChangesGuard } from './core/guards/unsaved-changes.guard';
import { featureGuard } from './core/guards/feature.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./features/home/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./features/auth/callback/callback.component').then((m) => m.CallbackComponent),
  },
  {
    path: 'auth/error',
    loadComponent: () =>
      import('./features/auth/error/auth-error.component').then((m) => m.AuthErrorComponent),
  },
  {
    path: 'auth/verify-email',
    loadComponent: () =>
      import('./features/auth/verify-email/verify-email.component').then((m) => m.VerifyEmailComponent),
  },
  {
    path: 'auth/verify-email-sent',
    loadComponent: () =>
      import('./features/auth/verify-email-sent/verify-email-sent.component').then((m) => m.VerifyEmailSentComponent),
  },
  {
    path: 'auth/forgot-password',
    loadComponent: () =>
      import('./features/auth/forgot-password/forgot-password.component').then((m) => m.ForgotPasswordComponent),
  },
  {
    path: 'auth/reset-password',
    loadComponent: () =>
      import('./features/auth/reset-password/reset-password.component').then((m) => m.ResetPasswordComponent),
  },
  {
    path: 'profile',
    loadComponent: () =>
      import('./features/profile/profile.component').then((m) => m.ProfileComponent),
    canActivate: [authGuard],
  },
  {
    path: 'profile/settings',
    loadComponent: () =>
      import('./features/profile/profile-settings.component').then((m) => m.ProfileSettingsComponent),
    canActivate: [authGuard],
  },
  {
    path: 'profile/notifications',
    loadComponent: () =>
      import('./features/profile/profile-notifications.component').then((m) => m.ProfileNotificationsComponent),
    canActivate: [authGuard],
  },
  {
    path: 'profile/calendar',
    loadComponent: () =>
      import('./features/profile/profile-calendar.component').then((m) => m.ProfileCalendarComponent),
    canActivate: [authGuard],
  },
  {
    path: 'account/settings',
    loadComponent: () =>
      import('./features/account/account-settings.component').then((m) => m.AccountSettingsComponent),
    canActivate: [authGuard],
  },
  // Public account deletion info page — no auth required (Meta App Review)
  {
    path: 'account-deletion',
    loadComponent: () =>
      import('./features/account/account-deletion.component').then((m) => m.AccountDeletionComponent),
  },
  {
    path: 'account-deletion/status',
    loadComponent: () =>
      import('./features/facebook-deletion/facebook-deletion.component').then(
        (m) => m.FacebookDeletionComponent,
      ),
  },
  {
    path: 'locations',
    loadComponent: () =>
      import('./features/locations/list/locations-list.component').then(
        (m) => m.LocationsListComponent,
      ),
    canActivate: [validatedMemberGuard],
  },
  {
    path: 'locations/:id',
    loadComponent: () =>
      import('./features/locations/detail/location-detail.component').then(
        (m) => m.LocationDetailComponent,
      ),
    canActivate: [validatedMemberGuard],
  },
  // Pre-rename URLs (restaurants -> locations) — keeps old bookmarks/shared
  // links/emails from 404ing after the Phase 29 rename.
  { path: 'restaurants', redirectTo: '/locations' },
  {
    path: 'restaurants/:id',
    redirectTo: (redirectData) => `/locations/${redirectData.params['id']}`,
  },
  {
    path: 'merch',
    loadComponent: () =>
      import('./features/merch/merch.component').then((m) => m.MerchComponent),
    canActivate: [validatedMemberGuard, featureGuard('merch')],
  },
  {
    path: 'calendar',
    loadComponent: () =>
      import('./features/calendar/calendar.component').then((m) => m.CalendarComponent),
    canActivate: [validatedMemberGuard],
  },
  {
    path: 'ratings',
    loadComponent: () =>
      import('./features/ratings/ratings-queue.component').then((m) => m.RatingsQueueComponent),
    canActivate: [validatedMemberGuard, featureGuard('ratings')],
  },
  {
    path: 'rsvp-guest',
    loadComponent: () =>
      import('./features/events/guest-rsvp/guest-rsvp.component').then(
        (m) => m.GuestRsvpComponent,
      ),
  },
  {
    path: 'events',
    loadComponent: () =>
      import('./features/events/list/events-list.component').then(
        (m) => m.EventsListComponent,
      ),
  },
  {
    path: 'events/reservation-confirm/:token',
    loadComponent: () =>
      import('./features/events/reservation-confirm/reservation-confirm.component').then(
        (m) => m.ReservationConfirmComponent,
      ),
  },
  {
    path: 'events/:id',
    loadComponent: () =>
      import('./features/events/detail/event-detail.component').then(
        (m) => m.EventDetailComponent,
      ),
    canDeactivate: [unsavedChangesGuard],
  },
  {
    path: 'leaderboard',
    loadComponent: () =>
      import('./features/leaderboard/leaderboard.component').then((m) => m.LeaderboardComponent),
    canActivate: [validatedMemberGuard, featureGuard('leaderboard')],
  },
  {
    path: 'members',
    loadComponent: () =>
      import('./features/members/members.component').then((m) => m.MembersComponent),
    canActivate: [authGuard, featureGuard('members')],
  },
  {
    path: 'members/:id',
    loadComponent: () =>
      import('./features/members/member-profile.component').then((m) => m.MemberProfileComponent),
    canActivate: [validatedMemberGuard],
  },
  {
    path: 'invite',
    loadComponent: () =>
      import('./features/invite/invite.component').then((m) => m.InviteComponent),
    canActivate: [validatedMemberGuard],
  },
  {
    path: 'join/:code',
    loadComponent: () =>
      import('./features/join/join.component').then((m) => m.JoinComponent),
  },
  // Feedback board
  {
    path: 'feedback',
    loadComponent: () =>
      import('./features/feedback/feedback-board.component').then((m) => m.FeedbackBoardComponent),
    canActivate: [validatedMemberGuard],
  },
  {
    path: 'feedback/new',
    loadComponent: () =>
      import('./features/feedback/feedback-new.component').then((m) => m.FeedbackNewComponent),
    canActivate: [validatedMemberGuard],
  },
  {
    path: 'feedback/:id',
    loadComponent: () =>
      import('./features/feedback/feedback-detail.component').then((m) => m.FeedbackDetailComponent),
    canActivate: [validatedMemberGuard],
  },
  // Legacy Facebook data deletion URL — redirect to new canonical path
  {
    path: 'facebook-data-deletion',
    redirectTo: '/account-deletion/status',
    pathMatch: 'full',
  },
  // Announcements — public read, no auth required
  {
    path: 'announcements',
    loadComponent: () =>
      import('./features/announcements/announcements-list.component').then(
        (m) => m.AnnouncementsListComponent,
      ),
  },
  {
    path: 'announcements/:id',
    loadComponent: () =>
      import('./features/announcements/announcement-detail.component').then(
        (m) => m.AnnouncementDetailComponent,
      ),
  },
  // Changelog — validated members and above only (2026-07-05: was public)
  {
    path: 'updates',
    loadComponent: () =>
      import('./features/updates/updates.component').then((m) => m.UpdatesComponent),
    canActivate: [validatedMemberGuard],
  },
  // Legal pages — no auth required
  {
    path: 'terms',
    loadComponent: () =>
      import('./features/legal/terms.component').then((m) => m.TermsComponent),
  },
  {
    path: 'privacy',
    loadComponent: () =>
      import('./features/legal/privacy.component').then((m) => m.PrivacyComponent),
  },
  // Admin
  {
    path: 'admin/invites',
    loadComponent: () =>
      import('./features/admin/invites/admin-invites.component').then(
        (m) => m.AdminInvitesComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/users',
    loadComponent: () =>
      import('./features/admin/users/admin-users.component').then(
        (m) => m.AdminUsersComponent,
      ),
    canActivate: [authGuard, moderatorGuard],
  },
  {
    path: 'admin/email',
    loadComponent: () =>
      import('./features/admin/email/admin-email.component').then(
        (m) => m.AdminEmailComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/legal',
    loadComponent: () =>
      import('./features/admin/legal/admin-legal.component').then(
        (m) => m.AdminLegalComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/settings',
    loadComponent: () =>
      import('./features/admin/settings/admin-settings.component').then(
        (m) => m.AdminSettingsComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/feedback',
    loadComponent: () =>
      import('./features/admin/feedback/admin-feedback.component').then(
        (m) => m.AdminFeedbackComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/releases/new',
    loadComponent: () =>
      import('./features/admin/releases/admin-releases.component').then(
        (m) => m.AdminReleasesComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/announcements',
    loadComponent: () =>
      import('./features/admin/announcements/admin-announcements.component').then(
        (m) => m.AdminAnnouncementsComponent,
      ),
    canActivate: [authGuard, moderatorGuard],
  },
  {
    path: 'admin/moderation',
    loadComponent: () =>
      import('./features/admin/moderation/admin-moderation.component').then(
        (m) => m.AdminModerationComponent,
      ),
    canActivate: [authGuard, moderatorGuard],
  },
  {
    path: 'admin/audit',
    loadComponent: () =>
      import('./features/admin/audit/admin-audit.component').then(
        (m) => m.AdminAuditComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/invites/lineage',
    loadComponent: () =>
      import('./features/admin/invite-lineage/admin-invite-lineage.component').then(
        (m) => m.AdminInviteLineageComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/facebook-accounts',
    loadComponent: () =>
      import('./features/admin/facebook-accounts/admin-facebook-accounts.component').then(
        (m) => m.AdminFacebookAccountsComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/integrations',
    loadComponent: () =>
      import('./features/admin/integrations/admin-integrations.component').then(
        (m) => m.AdminIntegrationsComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/cities',
    loadComponent: () =>
      import('./features/admin/cities/admin-cities.component').then(
        (m) => m.AdminCitiesComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/merch',
    loadComponent: () =>
      import('./features/admin/merch/admin-merch.component').then(
        (m) => m.AdminMerchComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/achievements',
    loadComponent: () =>
      import('./features/admin/achievements/admin-achievements.component').then(
        (m) => m.AdminAchievementsComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/icons',
    loadComponent: () =>
      import('./features/admin/icons/admin-icons.component').then(
        (m) => m.AdminIconsComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/members/:id/community',
    loadComponent: () =>
      import('./features/admin/community/admin-community.component').then(
        (m) => m.AdminCommunityComponent,
      ),
    canActivate: [authGuard, moderatorGuard],
  },
  {
    path: 'feature-unavailable',
    loadComponent: () =>
      import('./features/feature-unavailable/feature-unavailable.component').then(
        (m) => m.FeatureUnavailableComponent,
      ),
  },
  {
    path: '**',
    loadComponent: () =>
      import('./features/not-found/not-found.component').then((m) => m.NotFoundComponent),
  },
];

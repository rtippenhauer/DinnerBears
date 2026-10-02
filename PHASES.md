# DinnerBears — Development Phases

Update `CLAUDE.md` "Current Development Phase" when moving to a new phase.

---

## Phase 1 — Project Foundation & Design System ✅ Complete

- Docker Compose scaffold (nginx, angular, nestjs-api, mysql)
- Angular 19 project init — standalone, routing, SCSS
- Angular Material custom theme (DinnerBears blue #1E4D8C)
- Responsive shell layout: MatToolbar nav, MatSidenav mobile, footer
- City selector dropdown in nav
- NGINX internal proxy: /api/\* → nestjs-api container
- NestJS project init with TypeORM + MySQL connection
- Health check: GET /api/v1/health → 200 with database status
- VS Code workspace settings committed
- ESLint + Prettier configured and passing
- .env.example with all required keys documented
- Placeholder static site deployed at dinnerbears.com (landing, privacy, terms)

**Definition of done:** `docker compose up` → Angular shell at localhost,
/api/v1/health returns 200 with database: "connected", ESLint passes,
responsive at 375px + 1280px, dinnerbears.com live with placeholder site.

---

## Phase 2 — Google Auth & Invite System ✅ Complete

- Google OAuth (Passport strategy, /api/auth/google redirect)
- Invite link system — all five types:
  - `member` — single-use, 48 hours, tied to specific invitee email
  - `admin` — multi-use, up to 30 days, revocable
  - `campaign_facebook` — multi-use, up to 30 days, tied to a configured
    Facebook group, admin-only creation
  - `guest_rsvp` — single-use, expires at event date (Phase 4)
  - `shareable_rsvp` — single-use, expires at event date (Phase 4)
- Invite lineage tracking (invited_by, invite_source on users table)
- Campaign link admin UI: select Facebook group, set expiry (1–30 days),
  set use cap or unlimited, generate and copy link
- Only one active pending invite per invitee email at a time
- Expired link handling: friendly message, no silent failures
- Basic member profile page (name, email, city, photo)
- Device fingerprinting (login_sessions + geoip-lite)
- Security alert in-app notification on new device login
- Admin Invites tab: generate, view, revoke, view lineage tree

**Definition of done:** Admin can log in with Google, generate all invite
types, post a campaign link to Facebook, and new members can register via
that link with correct lineage recorded. Single-use invites expire after
48 hours and are tied to the invitee's email.

---

## Phase 3 — Restaurant Database UI ✅ Complete

- NestJS RestaurantsModule (CRUD, role-gated to admin/moderator)
- Geocoding integration (address → lat/lng on save)
- Photo upload (@nestjs/multer, stored to Unraid volume)
- Angular restaurant list (search by name, filter by city, MatCard layout)
- Restaurant detail page (photo carousel, description, map link, website)
- Admin/moderator create and edit forms
- Soft delete (is_active flag, not hard delete)

**Definition of done:** Admins and moderators can create, edit, and manage
restaurants. Members can browse and search. Photos upload and display.
Geocoded map links generate from addresses.

---

## Phase 3.5 — Historical Restaurant Import ✅ Complete

- Facebook OAuth token setup (admin logs in with Facebook to generate token)
- One-time script: pull all past events from Group 1 via Facebook Graph API
- Export to .xlsx: Event Title, Date, Location Name, Address, Notes
- Admin reviews and cleans spreadsheet in Excel/Google Sheets
- Import script: read cleaned .xlsx → insert into restaurants table
- Geocoding runs automatically on each imported address
- Duplicate detection by name (case-insensitive); existing records skipped
- Admin reviews final data in HeidiSQL, edits or removes as needed

**Definition of done:** restaurants table populated from historical Facebook
events, all records geocoded, admin has reviewed and cleaned the data.

**Note:** Facebook OAuth token obtained here is stored and reused in
Phase 11 when Facebook login is added for members.

---

## Phase 4.1 — Event Core ✅ Complete

- NestJS EventsModule — CRUD, restaurant snapshot on creation
- Event states: draft → published → cancelled
- Event list page — city filter, upcoming/past toggle, MatCard layout
- Event detail page — restaurant, date/time, description
- Admin create/edit event form

**Definition of done:** Admin can create, edit, publish, and cancel events.
Members can view the event list and detail page. Restaurant snapshot is
captured on publish.

---

## Phase 4.2 — Member RSVP ✅ Complete

- Member RSVP — add/remove, 0–9 additional guests dropdown
- +1 options: name them, send by email, copy shareable link
- `shareable_rsvp` invite type activated
- RSVP display: member names, additional guest count, Total Seats Needed

**Definition of done:** Members can RSVP and add additional guests. Shareable
+1 links work. Total Seats Needed is accurate.

---

## Phase 4.3 — Sharing & Calendar Export ✅ Complete

- Share to Facebook button (admin only — pre-fills FB composer)
- Copy Post Text button
- Calendar export — .ics, Google Calendar URL, Apple Calendar deep link

**Definition of done:** Admin can share event to Facebook with pre-filled
text. All three calendar export formats work correctly.

---

## Phase 4.4 — Event RSVP Disclaimer & Cutoff ✅ Complete

- Add platform disclaimer constant (not hardcoded in template) to event detail page:
  - GOING by 5:00 PM day-of
  - MAYBE not counted for reservations
  - Dinner starts 6:30 PM, members arrive ~6:00 PM
- Hard-block new GOING RSVPs after 5:00 PM on event day
- Cutoff message shown to members; moderators retain full override
- Admin/mod RSVP controls bypass the cutoff check

**Definition of done:** Disclaimer visible on all event detail pages. GOING
RSVP hard-blocked after 5:00 PM day-of for standard members. Moderators
can still adjust RSVPs after cutoff.

---

## Phase 4.6 — Avatar System (dynamic) ✅ Complete

- NestJS `GET /api/v1/avatars` endpoint: scans avatar asset directory for
  `*.png` and `*.jpg`, returns `[{ filename, displayName }]`, no auth required
- Display name utility: strip `bear-` prefix, strip extension, capitalize first
  letter — pure function on frontend, no server-side mapping
- Profile avatar picker refactored: remove hardcoded `PRESET_AVATARS` array,
  load from `/api/v1/avatars` on init
- "I Feel Lucky" button: picks a random avatar excluding the current one,
  previews it immediately, saves only on normal save action

**Definition of done:** Adding a new `bear-*.jpg` to the avatar directory
makes it appear in the picker without any code change or redeployment.
"I Feel Lucky" always produces a different avatar. Display names derive
correctly from filenames.

---

## Phase 5 — Email System ✅ Complete

- Brevo SDK integration (EmailService)
- MySQL email queue (email_queue table)
- EmailDispatcherService cron (every 5 min, priority ordering)
- Gmail SMTP fallback (Nodemailer)
- email_provider_config toggle
- Brevo send-event webhooks: delivery, open, bounce, block, spam complaint
- email_status field lifecycle: pending → active → unsubscribed/bounced/complained
- email_suppressions table: hash-based post-deletion suppression
- Re-subscribe flow: Brevo suppression list API call + status reset
- Suppression check on new registration
- Unsubscribe banner on login for unsubscribed members
- Spam complaint banner with instructions (not self-service reversible)
- All 11 transactional email templates created and tested in Brevo
- Member notification preferences (notification_preferences table)
- Profile → Notifications tab with per-template opt-in/out toggles
- Admin email dashboard: send counts, overflow toggle, retry failed,
  bounce and complaint log
- Inactivity cron: 60-day re-engagement, 90-day final warning,
  120-day soft delete, 150-day hard delete

**Definition of done:** All 11 templates send via Brevo, Gmail fallback
activates on toggle, Brevo webhooks update delivery status, bounce/complaint/
unsubscribe flows work end-to-end, inactivity cron runs correctly, member
preferences respected, suppression survives hard delete and re-registration.

---

## Phase 5.5 — Guest RSVP (email-complete) ✅ Complete

- Guest confirmation email with cancel link + optional DinnerBears invite offer
- Guest invite link (30-day expiry) generated on confirmation, linked to inviting member for lineage
- `guest_rsvp` invite type activated
- Admin event page: full attendee breakdown — names, emails, who invited whom
- RSVP display updated to include confirmed guest count

**Definition of done:** Guests can RSVP without an account, receive a
confirmation email with a cancel link, and optionally join DinnerBears via
the invite offer. Admin sees the full attendee breakdown with lineage.

---

## Phase 6 — Feedback Board, Release Notes & Versioning ✅ Complete

- DB migrations: add `title` (varchar 200), `is_private` (boolean default false),
  `upvote_count` (int default 0) to existing `feedback` table; reconcile status
  enum to `open`, `in_progress`, `resolved`, `shipped`, `closed`, `wont_fix`;
  keep existing `seen_at` and `comment` category
- DB: `feedback_notes` table (id, feedback_id FK, author_id FK, content text,
  is_admin_only boolean default false, created_at)
- DB: `feedback_upvotes` table (id, feedback_id FK, member_id FK, created_at;
  UNIQUE on feedback_id + member_id)
- DB: `releases` table (id, version varchar 20, title varchar 200, body text,
  released_at datetime, created_by FK members)
- DB: `release_feedback` join table (release_id FK, feedback_id FK)
- NestJS: extend FeedbackModule — upvote toggle, threaded notes (with
  is_admin_only), privacy flag, open-bugs admin query
- NestJS: ReleasesModule — public list + detail, admin create/publish with
  package.json version bump in both frontend/ and api/
- Quill rich text editor installed and integrated for description, notes,
  and release body fields; server-side HTML sanitization (sanitize-html)
- Member feedback board `/feedback` — list with upvote counts, type/status
  badges, private lock icon; filter tabs (All / Bugs / Features / Comments);
  sort by Most Upvoted or Newest
- `/feedback/new` — submit form (type, title, Quill description, private toggle)
- `/feedback/:id` — ticket detail with upvote button, status banner ("Shipped
  in vX.X.X" links to release), threaded notes, add-note form
- `/updates` — public changelog, no auth required; lists releases newest-first
  with rich text body and community credit section (name or "a community member"
  for private tickets)
- Admin `/admin/feedback` enhanced — full list including private, inline status
  dropdown, admin-only note capability
- Admin `/admin/releases/new` — version field (semver validated), title, Quill
  release notes, ticket linker for resolved tickets, community credit preview,
  publish button
- Member profile stats: bugs reported, features requested, shipped count
- CLAUDE.md updated with Bug-Driven Development and Versioning Workflow sections

**Definition of done:** Members can submit, upvote, and discuss feedback.
Admin can manage status and publish releases linked to resolved tickets.
`/updates` is publicly visible with community credit. Publishing a release
auto-bumps `package.json` in both workspaces. Open-bugs API endpoint
returns current open bug tickets for the agentic workflow.

---

## Phase 7 — Push Notifications & Announcements ✅ Complete

- Web Push: VAPID key pair, push_subscriptions table, PushService
- Angular PWA service worker upgrade (push event handler)
- iOS Add-to-Home-Screen onboarding banner
- NotificationBellComponent (badge, dropdown, mark-as-read)
- SSE or 60-second polling for real-time bell updates
- Announcements system (draft/publish, city-scoped, comments)
- Content flagging (content_flags table, moderation queue)
- Moderator in-app notification on new flag

**Definition of done:** Push notifications deliver on desktop and iOS PWA,
bell component shows unread count, announcements publish with comments,
flagged content appears in moderation queue.

---

## Phase 7.5 — Non-Validated Members & Event Invite Links ✅ Complete

Replaces the earlier Public Event Interest concept. Non-Validated users are real accounts
with limited access — suitable for public Facebook posts where membership can't be
pre-screened.

### Non-Validated User Status

- DB: add `non_validated` to `UserStatus` enum via migration
- Non-Validated users can: view upcoming events, RSVP (Going/Maybe/Not Going),
  view release notes (`/updates`)
- Non-Validated users cannot: invite +1s, invite members, submit feedback,
  post comments or notes on any content
- API guards enforce all restrictions server-side (not just UI)
- Moderator/admin member profile page: shows "Self-Invited" badge instead of
  "Invited By" when `invite_source = 'non_validated_link'`
- Moderator/admin can upgrade Non-Validated → Member via a "Validate Member" button;
  validator must confirm they are vouching for the person (confirmation dialog)
- Admin can also upgrade from the admin users list

### Multi-Use Event Invite Links

- DB: extend `invites` table — add `event_id` FK (nullable), `invite_flavor`
  enum[`member`|`non_validated`]
- Admin-only: generate a multi-use invite link tied to a specific event;
  choose flavor (Member or Non-Validated); set optional use cap and expiry
- Link URL pattern: `/join/:code` — on arrival, shows event card + OAuth signup
- On signup via Non-Validated link: account created with `non_validated` status,
  `invite_source = 'non_validated_link'`, `invite_id` set
- On signup via Member link: standard member account (existing invite flow),
  lineage tracked to event
- Admin event detail: "Invite Links" panel — generate, copy, revoke per-event links

### Maybe RSVP

- Add `maybe` as a valid RSVP status alongside `going` and `not_going`
- RSVP UI: three-option toggle (Going / Maybe / Not Going) for all users
- Event detail: Maybe count displayed separately from Going count
- Cutoff logic (Phase 4.4): only `going` RSVPs count toward venue seat numbers;
  Maybe is informational only
- Non-Validated users can RSVP Going or Maybe (not blocked from RSVPs)

**Definition of done:** Non-Validated accounts can be created via event invite links,
can RSVP and view events/releases, cannot post or invite. Moderators can validate
them to full Member with a vouch confirmation. Maybe RSVP option available to all
users; only Going counts at cutoff. Admin can generate and revoke per-event invite
links for both flavors.

---

## Phase 7.6 — Facebook Event Sharing ✅ Complete

Enhances the existing share/copy flow (Phase 4.3) with event-specific formatting
and per-event invite links.

- **Copy Event Post** button on event detail (admin/mod): generates formatted
  announcement text including event date, restaurant name, and the Non-Validated
  invite link for that event; copies to clipboard
- Admin can generate a Member invite link and a Non-Validated invite link for any
  event; both are shown in the sharing panel for easy copy/paste into Facebook
  groups or direct messages

**Definition of done:** Admin can copy a formatted event post with the correct
invite links in one click. Member and Non-Validated invite links are accessible
from the event sharing panel.

---

## Phase 8 — Venue Moderator Tools ✅ Complete

- Add `moderator_notes` (longtext, nullable) to `restaurants` table via migration
- Add `contact_name` (varchar 100), `contact_phone` (varchar 30),
  `contact_email` (varchar 150) — all nullable — to `restaurants` table
- Restaurant edit form: moderator-only Notes and Contact sections (hidden from
  standard members at API level, not just UI level)
- Restaurant detail page: Notes and Contact sections visible to mod/admin only

**Definition of done:** Moderators can save and view private venue notes and
contact info. Fields are server-side role-gated — standard member API response
omits them entirely.

---

## Phase 9 — Restaurant Ratings (Simplified) ✅ Complete

Simplified from original spec: skipped moderator attendance tracking and
attendance probability scores. Rating eligibility is based on a Going RSVP
to a past event at that restaurant, which is verifiable without separate
attendance marking.

- DB: new `restaurant_ratings` table (member_id, event_id, restaurant_id,
  food, service, value_rating, noise — each 1–5 tinyint, comment text nullable,
  UNIQUE on member_id + event_id)
- `POST /restaurants/:id/ratings` — auth required, validates: Going RSVP exists
  for event, event is past, event was at this restaurant, user is not
  non_validated. Upserts (one rating per member per event).
- `GET /restaurants/:id/ratings` — returns aggregate averages, recent reviews,
  and (if authenticated) list of eligible past events with alreadyRated flag
- Restaurant detail page: aggregate rating card (avg food/service/value/noise,
  overall score, breakdown bars, recent reviews with member name + date)
- Restaurant detail page: "Rate Your Experience" button for members with
  eligible unrated events; 4-dimension star form + optional comment

**Definition of done:** Members with a Going RSVP to a past event at this
restaurant can submit a 1–5 rating on food, service, value, and noise.
Aggregate scores and recent reviews display on the restaurant detail page.
Blocked at API level for non-validated users and non-attendees.

---

## Phase 10 — Threaded Event Discussion & Attendance Tracking ✅ Complete

### Threaded Comments

- DB: `event_comments` (id, event_id, member_id, body, created_at, deleted_at)
- DB: `event_comment_replies` (id, comment_id, member_id, body, created_at, deleted_at)
- Event detail page: discussion section below RSVP panel
- Any member can post a top-level comment
- Replies nest one level deep only (no infinite threading)
- Soft delete: members delete own posts; moderators delete any post
- Discussions persist and remain visible after event concludes

### Attendance Tracking

- DB migration: add `attended` boolean (default null) to `event_rsvps`
- Mod/admin attendance panel on event detail: shown only after event concludes;
  lists all Going RSVPs with checkboxes to mark who actually attended
- `PATCH /events/:id/attendance` — mod/admin only; accepts `[{userId, attended}]`
- Update `getRatingQueue` and `submitRating` in ratings.service.ts:
  require `attended = true` in addition to Going RSVP for rating eligibility

**Definition of done:** Members can comment and reply on event pages.
Moderators can delete any comment. Deleted comments show a "removed" placeholder.
Discussions persist post-event. Moderators can mark actual attendance after an
event concludes. Rating eligibility requires attended = true.

---

## Phase 10.5 — Account Deletion & OAuth Unlinking ✅ Complete

Required for Facebook App Review. Full spec in `docs/Dinnerbears_accountDeletion_requirements.md`.

Partial stubs already exist: `POST /auth/facebook/deletion` (HMAC verification) and `facebook/link` endpoint. Full implementation required.

### Connected Accounts (REQ-DEL-01, REQ-DEL-02, REQ-DEL-03)

- Account Settings page (`/account/settings`) with Connected Accounts section
- Google and Facebook rows showing link status; **Disconnect** button when other auth method exists; "Only login method" label when not
- Email/Password row stubbed (wired in Phase 11)
- `DELETE /api/v1/auth/providers/:provider` — deletes `oauth_accounts` row; clears CDN photo if from that provider (REQ-DEL-07); logs to audit; sends confirmation email; returns `409 ONLY_AUTH_METHOD` if last auth method
- Confirmation dialog and `409` warning dialog in Angular

### Account Self-Deletion (REQ-DEL-04, REQ-DEL-09)

- Danger Zone section on Account Settings (red/amber-warn visual treatment)
- Two-step confirmation: info dialog → type-to-confirm `DELETE` input
- Hidden for admin role (REQ-DEL-09)
- `DELETE /api/v1/users/me` — single DB transaction: sets `status=deleted`, `deleted_at`, `hard_delete_at=+30d`; deletes `oauth_accounts`, `login_sessions`, `push_subscriptions`; nulls CDN photo; logs audit; queues deletion email; invalidates session
- Redirects to `/` with `?deleted=1` toast

### Meta Deletion Callback (REQ-DEL-05)

- Rename/update existing stub: `POST /api/v1/auth/facebook/deletion-callback` (currently at `/facebook/deletion`)
- Full processing: verify HMAC-SHA256 signature; look up by Facebook App-Scoped ID; if other auth exists → delete only `oauth_accounts` row; if only auth → full soft-delete; if not found → return success
- New migration: `facebook_deletion_requests` table (facebook_user_id, confirmation_code UNIQUE, dinnerbears_user_id nullable, status enum[pending|completed], requested_at, completed_at)
- Status lookup: `GET /account-deletion/status?code=` — public Angular page

### Hard-Delete Cron (REQ-DEL-06)

- Daily `@Cron` job: users where `hard_delete_at <= NOW()` and `status = 'deleted'`
- Overwrites PII: `full_name = 'Deleted Member'`, scrambles email, nulls photo/password
- Deletes local photo file from disk
- Updates `facebook_deletion_requests` rows to `completed`
- Logs `account_hard_deleted` to audit

### Public Pages (REQ-DEL-08, REQ-DEL-10)

- `/account-deletion` — public page with self-service instructions (content per spec)
- `/account-deletion/status?code=` — public status lookup for Meta callback
- All auth callbacks reject `status = 'deleted'` before issuing session token

**Definition of done:** Members can disconnect individual OAuth providers (with confirmation) when another auth method exists. Members can delete their account via two-step confirmation. Meta's server-to-server deletion callback processes correctly and returns the required JSON response. Hard-delete cron anonymizes PII after 30 days. Public `/account-deletion` page is accessible without login. Deleted accounts are rejected at all auth entry points.

---

## Phase 10.6 — Content Reporting ✅ Complete

Unified system for members to report inappropriate content across all text-input surfaces, replacing the per-module flagging added in Phase 7 for announcements. See earlier discussion for full scope.

- DB: `content_reports` table (id, reporter_id FK, content_type enum[`event_comment`|`event_comment_reply`|`announcement_comment`|`restaurant_rating`|`profile`], content_id int, reason varchar 500 nullable, status enum[`pending`|`reviewed`|`dismissed`], reviewed_by FK nullable, reviewed_at datetime nullable, created_at)
- One report per member per content item (UNIQUE on reporter_id + content_type + content_id)
- `POST /api/v1/reports` — auth required, member role minimum; validates content exists and is not already reported by this member
- `GET /api/v1/admin/reports` — mod/admin only; lists pending reports with content preview, reporter name, content type, timestamp
- `PATCH /api/v1/admin/reports/:id` — mod/admin only; set status to `reviewed` or `dismissed`; optionally soft-delete the reported content in the same action
- Moderator in-app notification when a new report is filed
- Reusable `<app-report-button>` Angular component: flag icon button, confirmation dialog with optional reason text field; hidden on own content
- Wire report button onto: event comments, event comment replies, announcement comments, restaurant ratings
- Admin/mod report queue in admin panel: pending count badge, list with content preview, one-click dismiss or delete+dismiss
- `profile` content type reserved in enum for when bios/display names become editable

**Definition of done:** Any member can report event comments, replies, announcement comments, and restaurant ratings with an optional reason. Reports appear in the mod/admin queue with a content preview and one-click actions. Moderators receive an in-app notification on each new report. Members cannot report their own content. Duplicate reports from the same member are blocked.

---

## Phase 11 — Facebook OAuth & Email/Password Auth ✅ Complete

- Facebook OAuth (same Meta App as Phase 3.5 token)
- Account linking (oauth_accounts table, profile Security tab)
- Email + password registration (invite still required)
- Email verification flow (48-hour token, pending → active)
- Resend verification email
- Password reset flow (time-limited token, single-use)
- Password change from profile Security tab
- Account deletion request (soft delete, 30-day recovery)
- Hard delete job (runs nightly, processes accounts past 30-day window)

**Definition of done:** Members can log in via Google, Facebook, or
email/password. New email accounts require verification. Password reset
works. Account deletion soft-deletes with recovery window. Facebook OAuth
token from Phase 3.5 is reused correctly.

---

## Phase 12 — Admin Panel, Audit Log & Security ✅ Complete

- Full audit log viewer (filterable, read-only)
- Admin Users tab: all members, roles, suspend, delete, email status,
  inactivity segments, manual suppression override
- Admin Cities tab: configure Group 1 per city, Group 2 for Dayton,
  campaign link management
- Admin Invite tree: full lineage view for any member
- Community invite log (admin-only initially)
- Pre-launch OWASP Top 10 security checklist sign-off
- Rate limiting audit and hardening
- Final performance review and load testing

**Definition of done:** All admin tabs functional, audit log captures all
required actions, invite lineage fully visible, security checklist signed
off, system ready for real users.

---

## Phase 13 — CMS Legal Pages ✅ Complete

- DB: `legal_pages` table (id, page_type enum[terms|privacy], content longtext,
  published boolean, created_by FK users, created_at)
- Seed initial content from existing static placeholder files
- Public endpoint: `GET /api/v1/legal/:type` — returns published version, no auth
- Admin endpoint: `POST /api/v1/admin/legal/:type` — moderator guard; creates
  new version, sets published: true, unpublishes prior
- Angular lazy routes `/terms` and `/privacy` — render sanitized HTML via
  `DomSanitizer` within full site shell (dark theme, full nav)
- Admin legal editor UI (textarea + preview)

**Definition of done:** Moderators can update Terms and Privacy through admin
UI without a code change. Public pages render within site theme, not as blank
white pages. Each update creates a versioned audit record.

---

## Phase 14 — Navigation & Invites ✅ Complete

See `memory/project_phase14_nav_invites.md` — completed as v1.0.1.

---

## Post-Launch Backlog 🔄 In Progress

Deferred cleanup items and design spikes. No ordering implied — promote to a
numbered phase when ready to schedule.

### Angular Major Version Upgrade (19 → 22) ✅ Done — see Phase 27

Executed exactly per the plan below: one major hop at a time via `ng
update`, verified on stage before each subsequent hop, Node/Dockerfile
bumped alongside. All 3 flagged `npm audit` vulnerabilities closed. See
Phase 27 for the full account, including what else rode along on the same
branch.

### NestJS v11 Upgrade & Calendar Feed Fix (2026-07-04) ✅ Done — released as v1.3.3

- Upgraded `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`,
  `@nestjs/typeorm` to v11; `@nestjs/config` to v4; `@nestjs/throttler` to v6
  (fixes CVE-2026-35515, an SSE response CRLF-injection bug in
  `SseStream._transform()` — no live SSE endpoints today, but this closes the
  gap before the notifications-module SSE work lands)
- Added Express 5 query-parser insurance (`app.set('query parser', 'extended')`)
  in `main.ts`
- Verified `ThrottlerAuditGuard`, `GoogleCallbackGuard`, the calendar `.ics`
  feed, `GlobalExceptionFilter`, and TypeORM `migrationsRun` behavior against
  v11 — no code changes required, all compiled and behaved identically
- Removed the now-redundant `multer` override (v11's `platform-express`
  ships Multer v2 natively)
- Fixed the calendar `.ics` feed accumulating every past `PUBLISHED` event
  forever (only `CANCELLED` events had a 7-day cutoff) — now filters
  `PUBLISHED` events to `eventDate >= today` so the feed stays bounded

### `/release` Command Added (2026-07-04) ✅ Done

- New Claude Code command (`.claude/commands/release.md`) that bumps
  `"version"` in both `frontend/package.json` and `api/package.json`,
  commits, tags (`v<version>`), pushes to `origin main`, and builds/pushes
  both the `rtippenhauer/dinnerbears:stage` and `:latest` Docker Hub images
- Version numbers only change via this command, and only when Rob gives the
  number explicitly — decoupled from the admin-UI release-notes publish flow
  (`/admin/releases/new`), which writes to the `releases` DB table only and
  never touched `package.json` in the first place
- CLAUDE.md's Versioning Workflow updated to reflect this split

### Uploaded File Auth Gating (2026-07-05) ✅ Done

- Uploads split into per-category subdirectories: `/app/uploads/restaurants/`,
  `/app/uploads/profiles/`, plus the existing `/app/uploads/achievements/` and
  `/app/uploads/custom-icons/`
- Restaurant photos, achievement icons, and custom icons remain public static
  assets (`/api/uploads/<category>/<filename>`, no auth) — restaurant photos
  in particular stay public on purpose, since they're reused in guest-facing
  emails and social/Facebook posts
- Profile photos moved behind a new `GET /api/v1/uploads/profiles/:filename`
  route (`ProfilePhotosController`) guarded by `OptionalJwtAuthGuard` — only
  streamed to signed-in members; anonymous requests get a 401
- Migration `1751300000000-SeparateUploadDirectories` moves existing files on
  disk into their new subfolders and rewrites the stored paths in
  `restaurant_photos.file_path` and `users.profile_photo_path` — runs once
  automatically via `migrationsRun: true` on next deploy
- Known edge case: the public `/api/v1/releases` endpoint (Phase 17) serializes
  a release author's `profilePhotoPath`; if that author uploaded a real photo
  (rather than using a preset avatar), it'll now 401 for anonymous visitors of
  `/updates`. Preset avatars (`/avatars/bear-*.jpg`) are unaffected — they're
  static frontend assets, not uploads.

### Event Card Cleanup ✅ Resolved

Addressed separately by moving event card actions into an overflow ("...")
menu, simplifying the card's information hierarchy without a dedicated
redesign pass.

### Stage Testing Fixes for Upload Auth Gating (2026-07-05) ✅ Done

- Fixed photo uploads failing on stage after the upload-directory migration:
  migrations run as `root` (before the app drops to the unprivileged `nestjs`
  user), so the new `restaurants/`/`profiles/` subfolders came out root-owned
  and the app couldn't write into them. `entrypoint.sh` now does a recursive
  `chmod -R 777 /app/uploads` after migrations run, not just before.
- Widened the qualifying-login dedup window in production from 1 hour to
  12 hours (stage stays 5 min), per Rob
- Fixed visit-count tracking counting background activity (e.g. notification
  polling from a tab left open) as a site visit — moved the tracking from
  `JwtStrategy.validate()` (fires on every authenticated request) to
  `AuthService.me()`, which only runs once per real app bootstrap
  (`APP_INITIALIZER`) — a backgrounded/idle tab no longer inflates the count
- Fixed the sign-up page's splash image on mobile: `.splash-panel` had an
  unconditional `min-height: 400px` outside any media query, which silently
  overrode the intended mobile `height: 240px` — pushed the sign-up form
  (submit button ~178px) below the fold on phones. Verified with a headless
  browser at a 390×844 viewport before/after.
- Fixed remaining Docker Hub scan findings: `@nestjs/platform-express@11.1.27`
  hard-pins an _exact_ `multer@2.1.1`, which has two known DoS advisories
  (patched in `2.2.0`). Removing the `multer` override during the v11 upgrade
  was a mistake — re-added it pinned to `^2.2.0`, which cascaded away every
  other HIGH finding in `npm audit` that was only flagged transitively through
  the vulnerable multer (`@nestjs/core`, `@nestjs/schedule`, `@nestjs/testing`,
  `@nestjs/typeorm`). API workspace is now at 0 known `npm audit` vulnerabilities.
  Frontend's `npm audit` findings are all in build-time-only tooling
  (`@angular/cli`, `@angular-devkit/build-angular`, `vite`, etc.) that never
  ships in the final image — only compiled static output does — so they don't
  apply to what Docker Hub scans.
- Added `scripts/scan-image.sh` — local Trivy scan of a built image
  (`bash scripts/scan-image.sh [stage|latest] [severity-list]`), independent
  of Docker Hub/Scout. Cross-checking the two surfaced a real gap: Trivy's
  Alpine advisory data didn't have the busybox CVE Scout found (Alpine hadn't
  published a formal advisory for it yet) — worth keeping both.
- Audited every place the API returns `profilePhotoPath`, following up on a
  gap the upload auth-gating work introduced: uploaded profile photos now
  require login to view, but a couple of endpoints were still serving that
  path to fully anonymous callers, which would 401 in their browser.
  - `/updates` (`GET /api/v1/releases`, `GET /api/v1/releases/:id`) was fully
    public and exposed the release author's and any credited feedback
    submitter's photo. Gated to validated members and above (server-side via
    `ReleasesController` guards, matching the pattern already used for
    restaurants/calendar/ratings/leaderboard; client-side via
    `validatedMemberGuard` on the `/updates` route).
  - `GET /announcements` and `GET /announcements/:id` have the same exposure
    (author + every commenter) but stay fully public per Rob — lighter fix
    instead: new `toAnonSafeUser()` util nulls `profilePhotoPath` unless it's
    a preset avatar, applied only when `OptionalJwtAuthGuard` shows the caller
    is actually anonymous (logged-in callers of any role still see the real
    photo, since their cookie succeeds regardless).
  - Everywhere else already followed this pattern correctly (events list/
    detail null out attendee identities for anon/non-validated callers;
    restaurants, ratings, comments, and the leaderboard all require real
    authentication at the API level) — no other gaps found.

---

## Phase 15 — Community Points, Achievements & Leaderboard ✅ Complete

Gamification layer that rewards engagement with Bear Points, unlockable
Achievements, earnable Titles, and a community Leaderboard.

### Coordinator Role ✅ Already built

The reservation coordinator is the member who arranges the venue. Already
implemented: `reservation_assignee_id` FK on `events`, contact info fields,
confirmation token, and admin/mod assign/reassign UI on the event detail page.

### Bear Points

Points are awarded server-side only — no self-reporting. All triggers are
tied to verifiable DB records.

| Action                               | Points | Notes                                                                                                                   |
| ------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| Attend an event                      | 1      | Requires `attended = true` (Phase 10)                                                                                   |
| Be event coordinator                 | 2      | Awarded when event concludes                                                                                            |
| Coordinate at a brand-new restaurant | 4      | Restaurant never used in a prior published event — snapshot flag stored at award time so it doesn't shift retroactively |
| Successfully invite someone          | 1      | Fires when the invitee's first `attended = true` is recorded; walks invite lineage to find the original inviter         |
| Submit a restaurant rating           | 1      | One point per eligible rating                                                                                           |

- **DB**: `member_points` (id, user_id FK, point_type enum[`attendance`|`coordinator`|`coordinator_new_restaurant`|`invite`|`rating`], reference_id int, points int, awarded_at) — ledger model for auditability and corrections
- **Backfill**: attendance and ratings are retroactively calculable from existing data; coordinator and invite points require a one-time admin review script

### Achievements & Titles

Achievements are milestone unlocks. Some grant a **Title** the member can
display. Members pick their active title from all titles they've earned.

- **DB**: `achievements` (id, key varchar UNIQUE, name, description, icon varchar, title varchar NULL, is_secret tinyint, created_at)
- **DB**: `member_achievements` (id, member_id FK, achievement_id FK, earned_at; UNIQUE on member_id + achievement_id)
- **DB**: add `selected_title` varchar(100) NULL to `users` — stores the text of the chosen title
- Achievements are evaluated server-side on relevant trigger events (same hooks as points); secret achievements hidden in UI until earned
- `PATCH /api/v1/members/me/title` — member selects active title from earned list; validated server-side that they hold the achievement

**Seed achievements:**

| Key                 | Name          | Title Granted   | Trigger                                     |
| ------------------- | ------------- | --------------- | ------------------------------------------- |
| `founding_bear`     | Founding Bear | "Founding Bear" | Backfilled at launch for all active members |
| `first_dinner`      | First Dinner  | —               | First `attended = true`                     |
| `regular`           | Regular       | "Regular"       | 5 attended dinners                          |
| `veteran`           | Veteran       | "Veteran"       | 25 attended dinners                         |
| `first_coordinator` | Coordinator   | —               | First event coordinated                     |
| `scout`             | Scout         | "Scout"         | Coordinate at 3 different new restaurants   |
| `connector`         | Connector     | —               | First successful invite (invitee attends)   |
| `critic`            | Critic        | —               | Submit 5 restaurant ratings                 |

- **Founding Bear** is awarded via migration backfill at the time this phase deploys — all members with `status = 'active'` at that moment receive it; new members after deploy cannot earn it
- Profile page: earned achievements grid with icons; locked achievements shown as silhouettes (non-secret only)
- Profile page: title picker dropdown (only titles from earned achievements)
- Member's active title shown on their profile card, member list row, and leaderboard entry

### Leaderboard

Dedicated `/leaderboard` page — no auth required to view.

- Global by default; city filter dropdown (Cincinnati / Dayton / All)
- Columns: rank, avatar + display name + active title, total Bear Points, top-earning category badge
- Logged-in member's own row highlighted
- Paginated or top-50 initially

### Member List Updates

- Default sort: **alphabetical**
- Additional sort option: **Newest First** (by `created_at`)
- Points-based sort removed — leaderboard handles that use case
- **"New" badge** on member cards for accounts where `created_at >= NOW() - 14 days` — flag computed server-side in the member list API response

### Admin

- Full `member_points` ledger view per member with manual add/remove capability
- Achievement grant/revoke controls per member
- Leaderboard visible in admin with same city filter

**Definition of done:** Members earn Bear Points for attendance, coordinating, invites, and ratings. Founding Bear achievement backfilled at deploy. Achievement unlocks and title selection work end-to-end. Leaderboard is public, global by default, city-filterable. Member list has "New" badge and alphabetical/newest sort. Admin can audit and correct the points ledger and achievement grants.

---

## Phase 16 + 16c — iCal Calendar Feed & Calendar Reply RSVP ✅ Complete

Full spec: `docs/DinnerBears_iCal_Feed_Requirements.md` (REQ-NEW-16 through REQ-NEW-22)

Members subscribe to a personal iCal feed so upcoming dinners appear automatically in Apple Calendar, Google Calendar, Outlook, or any iCal-compatible app.

### Phase 16a — Subscription Feed (REQ-NEW-16 through REQ-NEW-20)

- DB: add `calendar_token VARCHAR(36) NULL UNIQUE` to `users` table
- New `CalendarModule` with `GET /api/v1/calendar/feed.ics?token=<calToken>` — no session auth; token in query param (calendar apps cannot send headers)
- Feed includes all events the member RSVPd to (going/maybe/not_going); excludes cancelled events older than 7 days
- Upgrade existing `buildIcs` in EventsService to full RFC 5545 compliance:
  - UTC datetime conversion (`YYYYMMDDTHHMMSSZ`) — current implementation uses local time, no Z suffix
  - Add missing properties: `STATUS`, `SEQUENCE`, `LAST-MODIFIED`, `URL`, `ORGANIZER`
  - Line folding at 75 octets per RFC 5545 — currently missing
- In-memory cache per token (15 min TTL); invalidate on RSVP change, event update, or token regen
- `POST /api/v1/members/me/calendar-token/regenerate` — generates new UUID, invalidates old token
- Angular account settings: **Calendar Subscription** section with copyable URL, platform setup guide (Apple/Google/Outlook), regenerate button with confirmation dialog

### Phase 16b — Email .ics Attachment (REQ-NEW-21)

- Attach a `.ics` file (`METHOD:REQUEST`) to event invitation emails
- Enables Apple Mail's native Accept / Decline / Maybe prompt
- Include `ATTENDEE;CN={name};RSVP=TRUE:mailto:{email}` in the attachment

### Phase 16c — Inbound RSVP Reply Processing (REQ-NEW-22) ✅ Complete

**Infrastructure:** Cloudflare Email Routing + Email Workers (free tier). No new Docker containers.

Setup steps (one-time, done in Cloudflare dashboard):

1. Enable Email Routing for dinnerbears.com (Cloudflare adds MX records automatically)
2. Create routes: `calendar@dinnerbears.com` → Worker (prod); `calendar-stage@dinnerbears.com` → same Worker (stage)
3. Deploy `cloudflare/email-worker.js` as the Worker; set `CLOUDFLARE_EMAIL_SECRET` env var in Worker settings
4. Set `CLOUDFLARE_EMAIL_SECRET` in API container env (same value)

**How replies flow:**

- `buildInviteAttachment()` sets `ORGANIZER:mailto:calendar@dinnerbears.com` so iOS knows where to reply
- Member RSVPs Going → RSVP confirmation email sent immediately with `.ics` (METHOD:REQUEST) attachment
- iOS Calendar shows **Accept / Maybe / Decline** buttons on the invite
- Member taps Accept → iOS sends `METHOD:REPLY` to `calendar@dinnerbears.com`
- Cloudflare Worker POSTs the raw email (JSON `{ raw }`) to `POST /api/v1/calendar/rsvp-reply`
- API validates `X-Cloudflare-Secret` header, extracts UID (→ eventId) and ATTENDEE PARTSTAT (→ RSVP status), upserts the RSVP

**UID scheme:** `dinnerbears-event-{eventId}@dinnerbears.com` — unchanged; member is identified by the ATTENDEE email in the reply.

**PARTSTAT mapping:** `ACCEPTED` → Going, `TENTATIVE` → Maybe, `DECLINED` → Not Going.

**Definition of done:** Members can subscribe to a personal iCal feed and see their events in any calendar app. Feed updates within 15 minutes of an event change or RSVP change. RFC 5545 validated. Calendar settings UI in account page. Phase 16b: invitation emails include `.ics` attachment with native prompt in Apple Mail. Phase 16c: tapping Accept/Maybe/Decline in iOS Calendar updates the member's DinnerBears RSVP automatically.

---

## Phase 17 — Event Admin Dialogs, Custom Icon Library & Hidden Achievements ✅ Complete

### Event Detail Admin Cleanup

- Share/Invite Links, Attendance, and Special Dinner Achievement management moved from always-visible inline cards into dialogs opened from an overflow (kebab) menu next to the event title; data preloads so panels aren't empty on open
- Reservation Coordinator card made visible to all members (assign/manage actions remain admin/mod only)

### Custom Icon Library

- Searchable icon picker for achievements (Material icon set + reusable custom icons)
- Admins can upload, crop, and reuse custom icon images across achievements; usage count shown per icon (icons in use can't be deleted)
- Background cleanup: uploads are scanned for white _and_ light-gray "checkerboard" pixels (some AI image generators simulate transparency this way) anywhere in the image, not just connected to the edges — fixes artifacts like a colored ring around a transparent hole
- Icons can be reprocessed in place after upload (same stored file, backgrounds re-cleaned) without needing to re-upload or touch any achievement referencing it
- Dedicated **Admin > Custom Icons** page — no longer requires opening an event's achievement editor to manage the library
- Fixed the nginx default 1MB request body limit, which was silently truncating/rejecting larger icon/photo uploads

### Hidden Achievements

- Fixed a bug where secret achievements never appeared once earned (a stale filter excluded all `is_secret` rows unconditionally) — they now display normally after being unlocked
- New hidden login-count achievements: 25/50/100/250/500 site visits, 10 Bear Points each. Visits are deduped by a time window (5 min on stage, 12 hours in production as of 2026-07-05 — was 60 min) so rapid page loads don't over-count
- 2026-07-05 fix: visit tracking moved from `JwtStrategy.validate()` (fires on every authenticated request, including background polling from a tab left open) to `AuthService.me()`, which only runs once per real app bootstrap (`APP_INITIALIZER`, i.e. a fresh page load/new tab) — a page left open in the background no longer keeps racking up visits
- New hidden **Patriotic Bear** achievement — logging in July 4–11, 2026 (America's Semiquincentennial) grants it, 10 Bear Points
- New achievement-earned splash screen: pops up automatically when a member has unseen achievements since their last visit, queues multiple if several were earned at once, and shows a red/white/blue animated fireworks celebration specifically for Patriotic Bear

### Event Invite Links Rework

- Removed the "Share on Facebook" button (it never called any DinnerBears backend — pure client-side redirect to Facebook's share dialog)
- Removed the standalone "Copy Post Text" button; its formatting logic was preserved and generalized to work per-link instead
- New event invite links are always created with a fixed 10-use cap and now expire at the event's RSVP cutoff (150 minutes before start) instead of an admin-chosen day count
- Every invite link now offers two copy actions — a plain link and a formatted "post text" version (adapted for Guest vs. Full Member, with the usage/expiry limits noted) — both embed the same token, so either one counts against the same 10-use cap

### Security Fix

- The public `/api/v1/releases` endpoint (no login required, by design) was serializing the full author `UserEntity` — including `password_hash`, email, and verification tokens — for every release, and the full submitter record for any linked feedback ticket. Now serialized down to `id`, `fullName`, `profilePhotoPath` only.

**Definition of done:** Event admin tools accessible via overflow-menu dialogs; Reservation Coordinator visible to all members. Admins can upload, crop, reuse, and clean up custom achievement icons from a dedicated admin page. Secret achievements display correctly once earned. Login-count and Patriotic Bear achievements grant automatically and surface via a queued splash screen. Event invite links use a fixed 10-use/RSVP-cutoff-expiry model with both plain and post-text copy options sharing one usage cap. Public release notes no longer leak account data.

---

## Phase 18 — Admin Nav Reorganization & Release Tooling ✅ Complete

### Admin Nav Restructure

- Desktop: the flat Admin/Moderation dropdown is now a single entry point whose menu holds **Security** (Users, Invites, Invite Tree, Audit Log), **Settings** (Email, Cities), and **Members** (Feedback, Achievements, Custom Icons, Announcements, Moderation), each opening as a nested flyout submenu via Material's `matMenuTriggerFor`-from-within-a-menu-item pattern, plus a direct **Releases** link
- Mobile sidenav mirrors the same four groupings as labeled sections (with dividers) under the existing Admin/Moderation block — no flyouts on mobile, just grouped headers
- Role gating unchanged: moderators still see Security → Users and Members → Announcements/Moderation only; Settings, the rest of Security/Members, and Releases stay admin-only

### Release Notes Tooling

- New `docs/NEXT_RELEASE.md` — a running local draft of unreleased, customer-facing notes; purely a staging file, never touches the `releases` table or the production API
- `/phase-done` now appends its customer-facing summary to `docs/NEXT_RELEASE.md`, commits it with the other phase docs, creates a local-only `phase-<N>` git tag (not pushed), and automatically builds/pushes the `stage` Docker image — `latest` (prod) is untouched
- `/release` now reads `docs/NEXT_RELEASE.md` as its starting draft, clears it back to empty once the release draft is created, and pushes only the specific `v<version>` tag (rather than `--tags`) so any unpushed local `phase-*` tags aren't swept along

**Definition of done:** Desktop admin nav is a single Admin/Moderation entry with nested Security/Settings/Members submenus and a direct Releases link; mobile sidenav mirrors the same grouping via section labels. `/phase-done` and `/release` keep `docs/NEXT_RELEASE.md` in sync automatically without reconstructing release notes from scratch at cut time, and local phase tags never leak to GitHub via a release push.

---

## Phase 19 — Admin CRUD Integration Tests ✅ Complete

### Test Harness

- New ephemeral MySQL test database (`docker/docker-compose.test.yml`), pinned to the same MySQL version as the real Unraid instance (9.7) rather than a lighter substitute like SQLite — entities use MySQL-specific column types (`json`, `enum`, `longtext`, `unsigned` PKs) that don't map cleanly elsewhere, and `synchronize: false` is a hard project rule
- `api/test/utils/test-app.ts` boots the real `AppModule` end to end — real guards, real DB, real migrations via the existing `migrationsRun: true` — not a trimmed test-only module
- `api/test/utils/seed.ts` seeds cities/restaurants/users and mints real login sessions (via `AuthService.issueTokens`, not a hand-crafted JWT) so `JwtStrategy`'s session-table check passes like a real login would
- `bash scripts/run-e2e-tests.sh` — one command: starts the test DB, runs the full suite, always tears down

### CRUD Coverage

Real-HTTP integration tests (success paths, validation errors, and 401/403 role-guard enforcement) for 11 admin resources: Events, Restaurants, Announcements, Cities, Releases, Achievements, Custom Icons, Event Comments, admin User management (list/ban/unban/role-change/delete), Feedback, and Reports. 202 tests total.

### Pre-Existing Migration Bugs Fixed

Bootstrapping a genuinely fresh database (never done before this phase — every real environment was already migrated) surfaced two latent bugs, both invisible in practice since already-migrated environments never re-run a migration once it's recorded as applied:

- `1749000008000-AddRestaurantAuditFields` used `ADD COLUMN IF NOT EXISTS`, which real MySQL doesn't support at any version (confirmed empirically against both 8.0.46 and 9.7.1 — it's a MariaDB-only extension). Rewritten to check `information_schema.COLUMNS` first.
- `1749000014000-CreateEmailSystem` unconditionally recreated `email_suppressions`, which `CreateUsers` already creates. Same fix pattern.

**Definition of done:** `bash scripts/run-e2e-tests.sh` runs the full migration history and 202-test suite cleanly against a database matching production's exact MySQL version, starting from nothing.

---

## Phase 20 — Cross-Cutting E2E Test Coverage ✅ Complete

Extends the Phase 19 harness to flows that don't fit inside a single CRUD resource. Added 267 new tests across 6 spec files (469 total, up from 202), all passing via `bash scripts/run-e2e-tests.sh` against a fresh database.

- **Batch 4 — Identity & Access** (`auth.e2e-spec.ts`, `invites.e2e-spec.ts`, `account-lifecycle.e2e-spec.ts`, 97 tests): auth/OAuth login flows (including a mocked Facebook Graph API and HMAC-verified Meta data-deletion callback), invites (create/redeem/revoke/lineage/expiration), account lifecycle (self-delete, Facebook data-deletion callback, hard-delete cron)
- **Batch 5 — Event Engagement & Gamification** (`rsvp.e2e-spec.ts`, `gamification.e2e-spec.ts`, 92 tests): RSVP lifecycle (create/update/remove, cutoff enforcement, member-generated and public guest links, attendance, walk-ins), achievement auto-granting triggers for every tier, leaderboard/points ledger aggregation
- **Batch 6 — Content Delivery** (`uploads.e2e-spec.ts`, `email-push.e2e-spec.ts`, `calendar.e2e-spec.ts`, 78 tests): restaurant/profile/achievement/custom-icon photo uploads and auth-gated serving, email queue dispatch and Brevo webhook handling, push subscription and in-app notifications, calendar ICS feed generation (RFC 5545 checks) and inbound RSVP-reply processing

### Test Harness Additions
- `resetThrottler(app)` (`api/test/utils/test-app.ts`) clears `ThrottlerStorage` (and its pending timers) between tests — auth/calendar routes carry tight per-route `@Throttle` limits, and a single app instance is reused across every test in a spec file
- `hashPassword()` (`api/test/utils/seed.ts`) — shared bcrypt helper for specs that need a real password hash on a seeded user
- Discovered that `truncateAllTables` also wipes migration-seeded reference data (e.g. the achievement catalog) — existing specs never depended on it staying seeded, so `gamification.e2e-spec.ts` re-seeds the specific achievement rows it needs locally rather than changing the shared harness (which `achievements.e2e-spec.ts`'s CRUD tests rely on being wiped between tests)

### Pre-Existing Bugs Fixed
Real-HTTP testing against actual business logic (not mocks) surfaced four latent defects, none previously caught because nothing had exercised these code paths end-to-end:
- `PointsService.checkInvitePointForInviter` destructured a raw-query result key (`u_invited_by`) that never matched what the query actually returned (`invited_by`, since the query selected without an explicit `AS` alias) — the "successful invite" Bear Point and `connector` achievement have never fired in production. Fixed using the same explicit-alias pattern already used in `admin.service.ts`.
- `EmailService.checkNotificationPref` compared a `tinyint` column value against the literal `false` (`!== false`) — since generic `tinyint` columns come back from the DB driver as `0`/`1`, not `boolean`, the strict comparison was always `true`, silently defeating every per-template email-preference opt-out. Fixed to compare numerically.
- `SubscribePushDto.keys` relied on `@ValidateNested()` alone to require the field, which class-validator does not enforce for `undefined` — an omitted `keys` object crashed the controller with a 500 instead of failing validation with a 400. Added `@IsDefined()`.
- `CalendarService.extractIcalFromEmail` applied full quoted-printable decoding (`=XY` hex-escape resolution) even to already-readable, non-encoded iCal text. Since `X` and `Y` matching any two hex digits triggers a decode, `PARTSTAT=ACCEPTED` (`=AC`) and `PARTSTAT=DECLINED` (`=DE`) were silently corrupted while `PARTSTAT=TENTATIVE` (`=TE`, not hex) happened to survive — meaning real Accept/Decline replies from iOS Calendar could silently fail to update a member's RSVP. Fixed to only strip QP soft-line-breaks on the already-matched branch, reserving full hex-escape decoding for the fallback branch where the iCal block genuinely needs it to be found at all.

**Definition of done:** `bash scripts/run-e2e-tests.sh` runs the full migration history and 469-test suite cleanly against a database matching production's exact MySQL version, starting from nothing. All three batches covered; four real production bugs found via genuine e2e testing and fixed in the same pass.

## Phase 21 — Edge Case & Injection Tests ✅ Complete

Scoped from the two backlog bullets below via two research passes: a raw-SQL/
`createQueryBuilder` audit (clean — every query already parameterized) and a
DTO field-limit inventory (0% edge-case coverage existed; ~13 real validation
gaps found beyond missing tests). Rob chose fix + test, not test-only.

### Fixed validation gaps

- Converted 8 endpoints that took `@Body()` as an inline object-literal type
  (silently skipping the global `ValidationPipe` entirely — a violation of
  `api/CLAUDE.md`'s "DTOs with class-validator for all request bodies" rule)
  to real DTO classes: `community.controller.ts`'s title-select, achievement
  grant, event-achievement create, achievement create/update, and custom-icon
  create; `admin.controller.ts`'s role-change and email-config update
- Added missing `@MaxLength` where a DTO field had no cap despite a real
  `varchar` column limit behind it (previously an oversized value 500'd at
  the DB instead of 400ing at validation): auth email fields, invite
  `boundToEmail`, restaurant/merch `websiteUrl`/`storeUrl`, release
  `version`, push subscription `p256dh`/`auth`
- `announcement.body` brought in line with `feedback.body`/`release.body` —
  added a `@MaxLength(50000)` cap and routed it through the same
  `sanitize-html` call on create/update

### New test coverage

- `api/test/edge-cases.e2e-spec.ts` (38 tests): boundary tests (limit,
  limit+1) across cities, restaurants, feedback, releases, invites,
  announcements, events, event comments, restaurant ratings, merch config,
  and push subscriptions, including the RSVP `guestNames` compound case
  (`@ArrayMaxSize(9)` + per-item `@MaxLength(200)`); regression tests
  proving each newly-converted no-DTO endpoint now rejects invalid/oversized
  input; HTML-injection tests confirming sanitized fields (feedback,
  announcements) strip `<script>` tags and unsanitized fields (event
  comments) round-trip as inert literal text; SQL-injection-shaped payload
  tests against restaurant create, the admin audit log's `LIKE` search, and
  the raw parameterized `DELETE` in the account self-delete cleanup path —
  all treated as inert data, no errors, no data loss

**Definition of done:** `bash scripts/run-e2e-tests.sh` runs the full
migration history and 511-test suite (up from 469) cleanly against a fresh
database. All ~13 validation gaps found during scoping fixed in the same
pass; zero raw-SQL parameterization issues found (audit-only, no fix
needed).

---

## Phase 22 — Rate Limiting Audit & Hardening ✅ Complete

Target policy: 30 req/min/IP for write operations (create/update/delete),
60 req/min/IP for reads. Scoped via an Explore-agent audit of the existing
`@nestjs/throttler` setup, which found the global default (60/min) already
matched the read target but every write route without its own `@Throttle`
was 2x looser than intended — systemic across all 24 controllers, not a few
one-offs. Rob chose per-IP keying (not per-user) as the simpler, lower-risk
option for a small invite-only app, and chose to fix a webhook auth gap
found during scoping in the same pass.

### Mechanism

- `ThrottlerAuditGuard` (`api/src/common/guards/throttler-audit.guard.ts`,
  already the app's sole `APP_GUARD`) gained a `handleRequest` override: for
  any mutating request (not GET/HEAD/OPTIONS) that would otherwise fall
  through to the module-level default, it substitutes a 30/min ceiling
  before delegating to the base `ThrottlerGuard`. Routes with their own
  `@Throttle()` are detected by comparing the resolved limit against the
  configured global default and are left untouched — this fixed every
  previously-unprotected write route in one ~15-line change instead of ~80
  individual decorator edits, and doesn't disturb the 7 routes (login,
  register, password reset/forgot, resend-verification, calendar feed) that
  already had tighter explicit limits.
- Bespoke tighter `@Throttle` overrides added to 10 higher-risk routes
  regardless of the general policy: the unauthenticated public writes
  (`events/:id/public-rsvp`, `events/guest-link/:token` POST+DELETE,
  `events/reservation-confirm/:token`) at 10/min; expensive bulk/admin
  operations (`restaurants/enrich/bulk`, `admin/achievements/backfill-founders`,
  `backfill-invites`, `recalculate-points`) at 5/min; privilege escalation
  (`admin/users/:id/role`) at 10/min; the paid-API-proxying
  `restaurants/place-search` at 20/min; and the Brevo webhook (see below)
  at 120/min.

### Webhook auth fix

`POST /email/webhook/brevo` had no signature/secret verification at all —
anyone who discovered the URL could forge delivery/bounce/unsubscribe/spam
events for any member's email. Added a `BREVO_WEBHOOK_SECRET` shared-secret
check via query param (mirroring `calendar.controller.ts`'s existing
`CLOUDFLARE_EMAIL_SECRET` pattern for the sibling inbound-email webhook,
since Brevo's dashboard only lets you configure a URL, not custom headers).
**Follow-up needed from Rob:** `.env.example` is outside this session's
write permissions — add `BREVO_WEBHOOK_SECRET=` there next to
`CLOUDFLARE_EMAIL_SECRET`, set a real value in stage/prod `.env`, and update
the registered webhook URL in Brevo's dashboard to
`.../email/webhook/brevo?secret=<value>`.

### Tests

New `api/test/rate-limiting.e2e-spec.ts` (11 tests): the generic write
default firing at request 31 on a route with no prior throttle; the generic
read default still allowing 60/min; a regression check that `/auth/register`
still throttles at its own 5/min (not clobbered by the new default); each of
the 10 bespoke routes enforcing its specific limit; and the Brevo webhook
rejecting missing/wrong secrets with 401 while accepting the correct one.
Updated the 6 pre-existing Brevo webhook tests in `email-push.e2e-spec.ts`
to pass the new required secret.

**Definition of done:** `bash scripts/run-e2e-tests.sh` runs the full
migration history and 527-test suite (up from 516) cleanly. Every write
route across all 24 controllers is throttled at 30/min or a documented
tighter bespoke limit, without regressing the 7 pre-existing explicit
throttles or any read route. The Brevo webhook requires a valid shared
secret.

## Phase 23 — Security Audit ✅ Complete

Turned into a reusable `/security-audit` command (`.claude/commands/security-audit.md`)
adapting a generic 20-point checklist to this stack (NestJS/MySQL/JWT cookies,
self-hosted behind NGINX Proxy Manager, not Next.js/Vercel). Run via an
Explore-agent audit against the real codebase, not from memory of what prior
phases claimed.

**Result:** 16 of 20 items already passed (password hashing, httpOnly
cookies, JWT secret handling, password-reset expiry/single-use, HTML
sanitization, upload validation, global `ValidationPipe` whitelisting, IDOR
scoping, parameterized queries, response serialization, admin role guards,
hard-delete anonymization, `.gitignore`, no hardcoded secrets, and CORS —
same-origin via one nginx container, no `enableCors` needed).

**Fixed:**
- Login endpoint was throttled at 10/min, not the required 5/min or tighter
  — tightened to `@Throttle({ default: { limit: 5, ttl: 60000 } })`
  (`api/src/modules/auth/auth.controller.ts`)
- `PATCH /users/me/notification-prefs` took a raw `@Body() body: Record<string, boolean>`,
  bypassing the global `ValidationPipe` entirely, then `Object.assign`'d it
  directly onto the TypeORM entity before `save()` — including the
  writable, unique `id`/`user_id` columns. A crafted body (e.g.
  `{"id": <another member's preferences row PK>}`) would cause TypeORM's
  `save()` to update someone else's row instead of the caller's own (IDOR
  via mass assignment). Fixed with a real `UpdateNotificationPrefsDto`
  (`api/src/modules/users/dto/update-notification-prefs.dto.ts`, one
  `@IsOptional() @IsBoolean()` per toggle) and an explicit
  `NOTIFICATION_PREF_FIELDS` whitelist loop in
  `EmailService.updateNotificationPrefs` (`api/src/modules/email/email.service.ts`)
  instead of blind `Object.assign`

**Found, not fixed (logged to Post-Launch Backlog):**
- `npm audit` on `frontend/` shows 3 real high-severity runtime
  vulnerabilities (`@angular/core` DOM clobbering/cache poisoning,
  `@angular/service-worker` cross-origin header leakage, `quill` XSS via
  HTML export) — none have a non-breaking fix; all three require jumping
  Angular from 19 to 22 (a 3-major-version upgrade), and quill has no
  patched version published yet at all. `api/`'s `npm audit` is clean.
- No HSTS header on the nginx config — reviewed with Rob, deliberately
  skipped for now given the lock-in risk if HTTPS/cert renewal ever breaks
  at the NGINX Proxy Manager layer (browsers would refuse HTTP fallback for
  the `max-age` duration). Left as a known, accepted gap.

**Definition of done:** All 20 checklist items evaluated against the actual
codebase with file:line evidence, not assumed from prior phase notes. Every
FAIL fixed except the two logged above, which are deliberate scope/risk
calls made with Rob rather than oversights. Full 527-test e2e suite passes
after the fixes. `/security-audit` command exists for repeat runs.

## Phase 24 — Dead Code & Duplication Cleanup ✅ Complete

Scoped 2026-07-12 alongside the Phase 23 audit, executed the same day. Two
independent sub-tasks, since no single tool covers both.

### Sub-task A — Unused code (tool-assisted)

Added `knip.json` to both workspaces (`entry`/`project` config for
migrations, one-off scripts, and `test/*.e2e-spec.ts`, which knip
misreads as unused without it) and ran `npx knip`, cross-checking every
finding against a plain grep before touching anything — knip's static
graph doesn't see string/DB-value comparisons, so several flagged enum
members (`InviteType.GUEST_RSVP`, `InviteType.SHAREABLE_RSVP`,
`ReviewAction.DISMISS`) were confirmed live and deliberately left alone.
Also ran `eslint` (catches unused imports/vars/params that knip's
export-level scan doesn't) and a full `ng build --configuration
production` (Angular's AOT compiler resolves every template binding,
which caught two unused-import cases neither knip nor eslint saw:
`RouterLink` in both legal pages).

**Removed:**
- `api/src/modules/email/gmail.service.ts` — already an empty stub
  ("Replaced by ResendService") confirming its own deprecation; deleted
  with Rob's sign-off
- `api/src/database/entities/app-config.entity.ts` — unused TypeORM
  entity for an `app_config` table seeded at launch with values (invite
  expiry hours, max guests, inactivity thresholds) that turned out to be
  hardcoded elsewhere in the app instead of ever being read from this
  table. Entity deleted; the DB table/migration were deliberately left
  alone per Rob (not worth a schema change) — it remains available if
  admin-configurable settings are ever built
- `api/src/scripts/import-restaurants.ts` (whole directory) — the Phase
  3.5 one-time historical-import script, removed per Rob rather than
  fixed: it required the `xlsx` package, which isn't installed and whose
  only npm-published version (0.18.5) has unpatched prototype-pollution/
  ReDoS advisories (SheetJS ships the real fix only via their own CDN)
- `api/src/README.ts`, `frontend/src/app/README.ts` — leftover `nest
  new`/`ng new` scaffolding comments
- `frontend/src/app/features/feedback/feedback-submit.component.ts` —
  orphaned; `/feedback/new` loads `feedback-new.component.ts` instead
- 9 stray 0-byte files at the repo root (`=`, `CACHED`, `CANCELED`,
  `[build`, `[internal]`, `[stage-1`, `exporting`, `naming`,
  `transferring`) — fragments of a Docker BuildKit log accidentally
  committed as files back in Phase 1 (2026-06-04), never referenced
  anywhere
- ~20 files' worth of unused imports/exports/constructor-injected
  dependencies/function params across both workspaces (e.g. an
  `EmailDispatcherService` import of `EmailStatus`, unused `rsvpRepo`/
  `inviteRepo` injections in `PointsService`, an unused `res` param on
  `AuthController.register`, a dead `TEMPLATE_ENV_KEYS` export in
  `email.constants.ts` that duplicated a private map already used in
  `brevo.service.ts`)
- `api/eslint.config.js`: added `argsIgnorePattern`/`varsIgnorePattern:
  '^_'` to `no-unused-vars` so the codebase's existing underscore-prefix
  convention (used for required-but-unused migration `down()` params)
  is actually recognized instead of silently relying on rule positional
  quirks

**Dependency hygiene** (`api/package.json`): removed 4 genuinely unused
devDependencies (`@typescript-eslint/eslint-plugin`, `@typescript-eslint/
parser`, `eslint-plugin-prettier`, `source-map-support`); added 5
packages that were used directly in source but only ever pulled in
transitively (`express`, `dotenv`, `ms`, `multer`, `@eslint/js`) — a
latent fragility, since a version bump anywhere upstream could have
silently broken a `require()` that wasn't guaranteed by anything in
`package.json`. `frontend/package.json`: removed unused
`@angular/platform-browser-dynamic` (app uses `bootstrapApplication`,
not the older `platformBrowserDynamic` bootstrap).

### Sub-task B — Duplicate functions/components across files

Delegated the broad read-through to an Explore agent (semantic
similarity isn't tool-assisted), then personally verified and acted on
its findings:

- **`formatTime()`/`initials()`** were copy-pasted (near byte-identical)
  across 5 Angular components and 2 components respectively — extracted
  to `frontend/src/app/shared/utils/format-event.ts`; each component's
  method now delegates to the shared function so no template changed
- **RFC 5545 ICS-generation logic** — Eastern→UTC time conversion,
  75-octet line-folding, and TEXT-value escaping — was independently
  reimplemented in `events.service.ts`'s `buildIcs()` instead of reusing
  `calendar.service.ts`'s private versions (which itself had the escape
  function duplicated twice internally). Extracted to
  `api/src/common/utils/ics.util.ts` (`icsEscape`, `eventTimeToUtc`,
  `toIcsUtcString`, `foldIcsLine`); both services now import the same
  functions. Highest-risk change of the phase (compliance-sensitive,
  78 calendar-related tests) — verified with a full e2e run immediately
  after, no drift
- 9 more inline copies of the same time-formatting expression within
  `events.service.ts` itself (across different `send*Email` methods)
  consolidated into one private `formatEventTimeDisplay()` helper
- Checked and ruled out: `role === UserRole.ADMIN || role === UserRole.
  MODERATOR` appears ~15+ times across services/controllers, but each
  instance is a distinct authorization decision using a shared enum —
  a reused idiom, not duplicated logic, so left as-is

### Execution safety

Followed the batch-and-verify discipline throughout: full `bash
scripts/run-e2e-tests.sh` (527/527) after the dependency-hygiene batch,
after Sub-task A's source edits, and again after the ICS consolidation.
`frontend/` has no automated test coverage, so changes there were
verified via `ng build --configuration production` (full AOT template
compilation) plus a live `ng serve` + Playwright smoke-check of every
page reachable without a running backend (home, `/privacy`, `/terms`);
authenticated pages weren't reachable in the working environment (no
local API/DB session available), so those relied on the AOT build
catching any broken template binding — which it does, by construction.

**Definition of done:** Sub-task A's findings reviewed and cross-checked
before any deletion, genuine dead code removed in verified batches with
zero test regressions. Sub-task B's duplicate-code report acted on with
the same discipline, including the highest-risk cross-service ICS
consolidation. Full 527-test e2e suite green throughout; frontend
verified via production build + reachable-page smoke test.

---

## Phase 25 — Mobile UI Bug Fixes ✅ Complete

Reported by Rob from live mobile use (iPhone screenshots, stage environment),
2026-07-18. First phase developed on its own branch
(`phase-25-mobile-ui-bug-fixes`) under the new branch-per-phase workflow —
see CLAUDE.md "Branching Workflow".

- **Restaurants list header overflow** — `.page-header`/`.header-actions` in
  `restaurants-list.component.ts` have no `flex-wrap`, unlike the filters row
  below them which does. On narrow viewports the button row (Archived /
  Import / Enrich All / Add Restaurant, depending on role) overflows
  horizontally instead of wrapping, pushing later buttons off-screen.
- **Create Event dialog wider than viewport** — `EventFormDialogComponent`'s
  `.event-form` has a hardcoded `min-width: 480px`, and all three call sites
  (`events-list`, `event-detail`, `restaurant-detail`) open it with a fixed
  `width: '600px'` and no `maxWidth` clamp — unlike
  `RestaurantFormDialogComponent`, which already uses `maxWidth: '95vw'`.
  Fields clip on both edges on mobile.
- **Attendance "Add Walk-in" doesn't scroll into view** — the walk-in form
  is a plain conditional block toggled by a signal, with no
  `scrollIntoView()`/`ViewChild` wiring, so revealing it doesn't bring it
  on-screen.
- **Walk-in search results can be clipped** — the results list scrolls
  within `mat-dialog-content`, but nothing keeps it visible above the
  dialog's fixed `mat-dialog-actions` footer as the attendee list + walk-in
  form + results grow taller than the dialog.
- **Walk-in search doesn't exclude existing attendees** — backend
  `EventsService.searchMembersForWalkin()` accepts `eventId` but never uses
  it in the query; it only filters on `status = 'active'` and the name
  match, so members already on the attendance/RSVP list still show up as
  walk-in candidates.

### Verification

Verified against a fully disposable local stack rather than stage/prod: a
throwaway MySQL container (migrations run, seeded with a fake city,
restaurant, event, and RSVPs — including a "Bill DeMange/Brocker/Perkins"
set mirroring Rob's real screenshots to test the exclusion fix
specifically), a locally-patched API pointed at it, and `ng serve` proxying
to that API. Authenticated via the seeded `automation@dinnerbears.internal`
account (temporarily promoted to admin in the disposable DB only). All 5
fixes confirmed via mobile-viewport (390×844) Playwright screenshots; no
"Add"/save actions were taken on real data. Full e2e suite green (527/527
— one `event-comments.e2e-spec` `beforeEach` timeout during the run was
resource contention from the parallel local verification stack, confirmed
by rerunning that spec alone clean). All scratch files (local `api/.env`,
proxy config, disposable container) removed after verification.

**Definition of done:** all 5 bugs fixed and verified on a mobile viewport,
existing e2e suite still green. Not yet merged into `main` — Rob deferred
`/release` to keep working; will merge via PR whenever `/release` runs.

---

## Phase 26 — Login Splash, Pending Invites in Admin, Horizontal Scroll Bug ✅ Complete

Scoped 2026-07-18. Branched off `phase-25-mobile-ui-bug-fixes` (not `main`)
since Phase 25 hadn't been released yet — see CLAUDE.md "Branching
Workflow" and "Current Development Phase".

- **Post-login splash screen ✅** — on login, show a splash surfacing what's
  new since the member's last login. Confirmed spec (2026-07-18, see memory
  `project-phase26-login-splash-spec`):
  - Releases: latest unseen release only (max 1, never a backlog).
  - Announcements: latest unseen announcement only (max 1, never a
    backlog).
  - Achievements: all unseen/newly-earned achievements since last login,
    uncapped — reuses the existing achievement-splash reveal system from
    Phase 20/21 (`member_achievements.seen_at`) rather than a new parallel
    mechanism.
  - Shows once per login; marked seen as soon as displayed (no explicit
    dismiss click required for the seen state).
  - Only surfaces items newer than the member's last login, so existing
    members aren't flooded with all past history on ship day.
  - Implemented by generalizing `AchievementSplashComponent`/`Service` into
    `SplashComponent`/`SplashService`; new `users.last_seen_release_id`/
    `last_seen_announcement_id` columns (migration backfills existing users
    to today's latest of each); new `WhatsNewService` +
    `members/me/whats-new` endpoints in `CommunityModule`. Verified via
    migration up()/down() against a real disposable DB and a full
    Playwright walkthrough (queue → dismiss → seen-state persists across
    reload; confirmed two simultaneously-unseen releases only ever surface
    the newer one).
- **Pending invites missing from admin Users list ✅** — `AdminService.
  getUsers()` now merges in unaccepted single-use "member" invites as
  synthetic rows (`isPendingInvite: true`, negative id to avoid colliding
  with real user ids), shown with a distinct "Pending Invite" chip in
  `admin-users.component.ts`. Read-only for this pass — no revoke/resend
  action wired up from this view yet (possible follow-up if Rob wants it).
  Verified: 29/29 `admin-users.e2e-spec.ts` tests green in isolation.
- **Horizontal scroll bug on mobile — resolved without a code change ✅** —
  Rob confirmed on 2026-07-19 that scrolling left on a phone no longer
  shifts the whole page and reveals white space; it self-resolved,
  most likely as a side effect of Phase 25's restaurants-list header
  `flex-wrap` fix (that row was the kind of always-present, viewport-width
  element whose overflow could have been causing page-level horizontal
  scroll site-wide). No dedicated fix needed; no screenshot was ultimately
  required.

**Definition of done:** all 3 items resolved and verified. Not yet merged
into `main` — will merge via PR whenever `/release` runs (may ride
together with Phase 25's unreleased fixes).

---

## Phase 27 — Angular 19→22 Upgrade & Points Audit Trail ✅ Complete

Started 2026-07-19 once phases 25/26 had actually merged to `main` via
`/release` (confirmed live on stage + prod as v1.4.3). Branched as
`phase-27-angular-19-22-upgrade` off the fresh `main`. Scope grew
considerably beyond the original upgrade as Rob tested the result live on
stage and follow-on requests landed on the same branch.

### Angular 19 → 22 upgrade
- Sequential major hops (19→20→21→22) via `ng update`, verified with a full
  build after each. TypeScript bumped 5.6→6.0 along the way (removed the
  now-deprecated, actually-unused `baseUrl` tsconfig option that TS 6.0
  turns into a hard error).
- `ngx-quill` bumped in lockstep each hop (27→28→30→31) to stay peer-compatible
  with each Angular major.
- Root Dockerfile's frontend-build stage and `frontend/Dockerfile` pinned to
  `node:22-alpine` (was a floating `node:20-alpine`, which wouldn't have
  reliably cleared Angular 22's Node floor).
- Migrated the last 3 non-standalone-syntax components (`event-card`,
  `error-page`, `icon-picker`) off `@Input`/`@Output` decorators onto signal
  `input()`/`output()`; `app.config.ts`'s `APP_INITIALIZER` provider onto
  `provideAppInitializer()`; the `serve` target off the deprecated webpack
  dev-server onto `@angular/build`'s esbuild-native one.
- Angular 22's own migration schematics applied `ChangeDetectionStrategy.Eager`
  to all ~73 existing components (preserving pre-v22 default change-detection
  behavior against the new default) and `withXhr()` to `provideHttpClient()`
  (preserving the XHR backend against the new default fetch backend) —
  automated, not manual, and deliberately *not* an OnPush migration (that's
  real behavior change, scoped out of a version-bump phase); disabled
  angular-eslint's new `prefer-on-push-component-change-detection` rule
  accordingly rather than fighting it file-by-file.
- **All 3 flagged `npm audit` vulnerabilities closed**: `@angular/core` and
  `@angular/service-worker` by the version bump itself; `quill`'s XSS-via-
  HTML-export pinned to exact `2.0.2` (the `^2.0.3` range's resolved version
  has an unpatched regression 2.0.2 doesn't; no 2.0.4+ exists upstream).
- Verified via build + lint + a full Playwright click-through on stage
  (home, 404, event RSVP, admin restaurant add/delete, admin achievement
  icon-picker) using the `automation@dinnerbears.internal` account —
  zero unexpected console errors.
- `frontend/src/**/*.spec.ts`: still zero files, confirmed again this phase.
  Flagged to Rob as a bigger, separate undertaking (no existing harness/
  TestBed patterns to build on) rather than silently skipped or scope-crept
  into this phase.

### Bug fixes found via live stage testing
- **Automation account couldn't be flipped back down from admin** —
  `AdminService.setRole()` blocked *any* role change on a user currently at
  `ADMIN`, with no exception for the documented automation-account
  flip-up-for-testing/flip-back-down workflow. Backend guard fixed (exempt
  the automation account, matched by email); a second, independent bug in
  `member-profile.component.ts` also hid the role-selector UI entirely
  whenever `role === 'admin'` even though its own `mat-option`s already
  anticipated flipping an automation account back down — fixed to match.
  Regression test added retroactively (wasn't covered when first fixed).
- **Admin achievements page header overflow on mobile** — `.page-header`
  had no `flex-wrap`, so the 3 action buttons (Re-run Founder Check /
  Recalculate Points / Backfill Invite Points) compressed into cramped
  multi-line pills and overflowed off-screen instead of wrapping as whole
  buttons. Same class of bug as Phase 25's restaurants-list header fix.

### Points audit trail (new, requested mid-phase)
- New self/admin/moderator-accessible `GET /members/:id/points/ledger`,
  distinct from the pre-existing admin-only raw ledger endpoint (left
  untouched, still used by the separate admin point-management tool).
  Returns a human-labeled itemized breakdown (date, description, points)
  plus a total that reconciles with the profile page's existing points
  badge by construction (same underlying `member_points` rows).
- Clicking the "paw badge" points total on a member's profile (self, or
  admin/moderator on someone else's) now opens a dialog listing that
  breakdown, modeled on the existing `AttendanceDialogComponent` pattern.
- Founding Bear achievement bumped from 1 point to 20 — it's a one-time,
  can-never-be-re-earned achievement and should feel special relative to
  the rest of the catalog.

### Data-integrity bugs surfaced by building the audit trail
Live-testing the new audit list on stage surfaced two real, pre-existing
data bugs, both fixed with migrations rather than one-off scripts:
- `ResetAndBackfillAchievements` (an earlier phase's historical backfill)
  had inserted the Founding Bear bonus point via raw SQL with
  `reference_id` hardcoded `NULL` — the one place in the codebase where an
  achievement-type `member_points` row wasn't traceable back to its
  achievement. Backfilled to the real id.
- That NULL `reference_id` window, combined with `adminRecalculatePoints()`
  ("Recalculate Points" in the admin UI)'s duplicate-row check being keyed
  on `reference_id` equality, meant a NULL row was invisible to that check
  — so a "Recalculate Points" click during this window inserted a *second*
  points row per already-credited member instead of finding the existing
  one. Cleaned up (de-dupe migration, keeping the earliest row per
  user+achievement), then hardened at the schema level so this class of
  bug can't recur: `member_points.reference_id` is now `NOT NULL` (every
  real award path already always supplied one) plus a
  `UNIQUE (user_id, point_type, reference_id)` constraint, mirroring
  `member_achievements`'s existing `uq_member_achievement`.
  `adminRecalculatePoints()`'s insert also switched to `INSERT IGNORE` as
  defense-in-depth against the new constraint. Regression test added
  (recalculate-points run twice no longer risks a duplicate).

### Verification
Backend: full `api/` e2e suite (21 suites, 535 tests) run against a
throwaway MySQL container after every backend-affecting commit, all green.
Frontend: `ng build` + `eslint` clean after every commit (same pre-existing
~50-error accessibility/`any`-type lint debt throughout, none of it new).
Every change deployed to and manually verified on `stage.dinnerbears.com`
before moving to the next one — 9 separate stage pushes across the phase,
each following a green local verification pass.

**Definition of done:** Angular 22 live and verified on stage, all 3
`npm audit` items closed, points audit trail shipped and its follow-on data
bugs fixed. Not yet merged into `main` — will merge via PR at the next
`/release`.

## Phase 28 — Retroactive Event-Achievement Sync ✅ Complete

Started 2026-07-20, scoped ad hoc mid-conversation: an admin investigation
into a member's out-of-order-looking "Bear Points History" entries surfaced
that neither toggling an event's secret-dinner flag nor creating/deleting
its one-off "Special Dinner Achievement" ever touched points or badges for
members already marked attended at that event — those only applied to
future attendance. Branched as `phase-28-retroactive-event-achievements`.

### Retroactive award/removal, scoped per event
- `PointsService.resyncSecretDinnerForEvent(eventId, isSecret)`: flipping
  an event's secret-dinner flag on walks that event's `attended = true`
  RSVPs and awards `secret_dinner` points to anyone missing one (idempotent,
  reuses the existing per-user dedupe check); flipping it off deletes every
  `secret_dinner` point row tied to that event and re-checks each affected
  member's achievement tier.
- `AchievementsService.recheckSecretDinnerAchievements(userId)`: the
  downward counterpart to the existing `checkSecretDinnerAchievements` —
  revokes a tier's badge + points once a member's count drops below its
  threshold, so a badge (e.g. "Secret Society") never outlives the count
  it was earned from.
- `AchievementsService.grantEventAchievementToAttendees(eventId)`: called
  right after a Special Dinner Achievement is created, grants it to every
  already-attended member instead of only whoever attends from then on.
- `AchievementsService.deleteEventAchievement(eventId)` (net new — no
  delete endpoint or UI button existed before this phase): removes the
  achievement definition itself plus every member's badge and points for
  it. `DELETE admin/events/:eventId/achievement` + a "Remove Achievement"
  button added to the event's achievement admin dialog.
- All of the above are scoped to a single event's attendee list (not a
  global sweep), so cost stays flat regardless of how many events
  accumulate over time — unlike the existing global
  `adminRecalculatePoints()` ("Recalculate Points" in the admin UI), which
  was deliberately left alone rather than overloaded with removal semantics
  it was never designed for.
- `EventsService.update()` now detects an actual `is_secret` change and
  runs the resync inline, returning the result (`{ enabled, awarded }` or
  `{ enabled, removed }`) on the response; the admin event-edit dialog and
  the achievement dialog surface it via snackbar (e.g. "awarded 2
  already-attended members").

### Verification
New `event-achievement-resync.e2e-spec.ts` (7 tests) covers all four
flows: secret-dinner-on award, secret-dinner-off removal + tier revoke,
achievement-create retroactive grant, achievement-delete clawback, plus
role-guard and no-op-change cases. Full `api/` e2e suite (22 suites, 542
tests) green against a throwaway MySQL container (one unrelated
`feedback.e2e-spec.ts` timeout in the full run confirmed as a flake by an
isolated re-run). Frontend `ng build` + `eslint` clean. No schema changes
this phase — pure application logic on the existing `member_points` /
`member_achievements` / `achievements` tables.

**Definition of done:** merged into `main`, live on stage
(`rtippenhauer/dinnerbears:stage`) — awaiting the next `/release` to reach
prod. One-time manual cleanup still needed on the specific event that
prompted this (toggle secret-dinner off→on→off, and delete+recreate its
Special Dinner Achievement) to catch up its already-stale totals, now that
the sync logic exists to do it correctly.

---

## Phase 29 — White-Label Template for a New Group ✅ Complete

Started 2026-07-21. Rob wants to stand up a second, separately-branded
community dining site for a different group (Southwest Ohio) — a fork of
this codebase with its own domain, database, secrets, and branding, not
another city inside DinnerBears itself. The new site is single-region —
no multi-city subdomain switching needed. Branched as
`phase-29-white-label-template`.

Scope:
- Extract hardcoded branding into a single theme/config point: app name,
  tagline, primary/accent/background colors, logo + splash images,
  favicon/PWA icons
- Terms/Privacy/About copy being admin-editable rather than hardcoded —
  split out into its own **Phase 30** (see below) since it stands on its
  own and doesn't depend on anything else here. Once done, this phase's
  bootstrap script seeds each fork's database with that operator's own
  starting copy, not DinnerBears' text as a "placeholder"
- Fix `CityService.currentCity` (`frontend/src/app/core/services/city.service.ts`)
  to fall back to the sole active city when there's no subdomain match
  (root-domain deployments), instead of requiring subdomain routing
- Simplify/hide the city-selector nav dropdown when only one city exists
- Bootstrap script or seed migration: creates the one city row,
  `app_config` row, `email_provider_config` row, and first admin user for
  a fresh database
- New `docs/NEW_INSTANCE_SETUP.md`: step-by-step for a new operator —
  their own Google OAuth app, Facebook app (Go-Live checklist), Brevo/Resend
  account, VAPID keypair generation, Docker Compose stack, MySQL instance,
  domain/DNS, `.env` checklist
- Audit for any remaining hardcoded `dinnerbears.com` assumptions in the
  API (redirect URIs, CORS origins, email templates, `APP_URL` usage) and
  parameterize them

**Definition of done:** A second operator can clone the repo, follow
`docs/NEW_INSTANCE_SETUP.md` top to bottom with their own
domain/branding/secrets/database, run `docker compose up`, and reach a
fully working single-city instance with their own name/colors/logo and no
DinnerBears branding or subdomain assumptions left over. Terms, Privacy,
and About copy are editable directly from the admin UI on both instances,
not hardcoded in either one.

**Decision — restaurants vs. locations (resolved 2026-07-23):** the
Southwest Ohio group ("Sons") holds dinners at members' houses, not
restaurants. Rob's call: rename the concept generically to "location" in
the shared codebase — table, entity, module, API routes, frontend feature
folder — but the *displayed word* in app copy stays "Restaurant" for every
fork (no per-fork config value for the label after all; that earlier idea
is dropped as unnecessary complexity). So `restaurants` →
`locations`/`LocationEntity`/etc. under the hood, while UI strings keep
saying "Restaurant."

**Decision — location privacy (resolved 2026-07-23):** rather than
hardcoding private-address behavior for Sons, add an `app_config`
preference (per fork, same pattern as Phase 30's config rows) controlling
whether locations are private: if enabled, a location's full address is
hidden from members who haven't RSVP'd "Going" (and from logged-out
visitors), only becoming visible to members RSVP'd Going. DinnerBears
leaves this off (restaurant addresses stay public); Sons turns it on. Real
access-control work in the locations API/frontend, not just a label
change.

**Decision — attendance migration (resolved 2026-07-23):** Sons moves
attendance tracking into this app outright — no ongoing sync or import
tooling against their Google Doc. It's an organizational cutover (Sons
stops updating the Doc and starts using our RSVP/attendance flow), not a
data-migration feature to build. Our attendance-driven features
(achievements, points) become authoritative for them from day one, same as
for DinnerBears. Payment/charging is still out of scope for DinnerBears
itself — if Sons needs it, integrate with whatever mechanism they already
use rather than build a native payment feature.

**Decision — event cadence default (resolved 2026-07-23):** replace the
hardcoded `nextTuesdayDate()` in
`frontend/src/app/features/events/form/event-form-dialog.component.ts`
with an `app_config` preference describing each fork's recurring event
cycle, covering both weekly-by-weekday patterns ("next Tuesday") and
monthly-by-nth-weekday patterns ("2nd Saturday"). The new-event form
defaults its date/time off whichever pattern the fork has configured,
instead of assuming DinnerBears' own weekly-Tuesday cadence.

**Progress — restaurants → locations rename (2026-07-23):** the first
decision above is implemented. Renamed throughout, identifiers only (UI
copy still says "Restaurant" everywhere):
- DB: `restaurants`/`restaurant_photos`/`restaurant_ratings` tables →
  `locations`/`location_photos`/`location_ratings`; FK/index names to
  match; `events.restaurant_*` snapshot columns → `location_*`. Enum
  values normalized in the same pass: `content_reports.content_type`
  `restaurant_rating` → `location_rating`; `member_points.point_type`
  `coordinator_new_restaurant` and `achievements.progress_type`
  `new_restaurant_coordinator` both → `new_location_coordinator` (fixes a
  pre-existing word-order inconsistency between the two). New migrations
  `RenameRestaurantsToLocations` and `MoveLocationUploads` (the latter also
  moves physical files from `/uploads/restaurants/` to `/uploads/locations/`
  and rewrites `file_path` rows) — both tested up *and* down against
  seeded data in an ephemeral MySQL container, plus a full TypeORM
  entity-mapping check, before being treated as done.
- API: `RestaurantEntity`/`RestaurantPhotoEntity`/`RestaurantRatingEntity`
  → `Location*Entity`; `modules/restaurants` → `modules/locations`
  (controller/service/DTOs/enrichment/ratings/geocoding); route
  `/api/v1/restaurants` → `/api/v1/locations`; all consumer modules
  (events, invites, reports, stats, community achievements/points,
  calendar) updated to match. User-facing strings deliberately preserved:
  `NotFoundException('Restaurant not found')` and similar, the
  `POINT_DESCRIPTIONS`/report labels, and the Claude enrichment prompt
  wording.
- Frontend: `features/restaurants` → `features/locations`
  (`LocationsListComponent`, `LocationDetailComponent`,
  `LocationFormDialogComponent`, etc.), `core/services/restaurants.service.ts`
  → `locations.service.ts`, routes `/restaurants` → `/locations`. Template
  text/labels/placeholders left as "Restaurant"; the nav and other
  `<mat-icon>restaurant</mat-icon>` uses were **not** touched — that's
  Google's Material Symbols icon name, unrelated to our domain model,
  and there's no equivalent-looking `location_*` icon.
- Tests/docs: `restaurants.e2e-spec.ts` → `locations.e2e-spec.ts`,
  `seedRestaurant()` → `seedLocation()`, all other e2e specs updated to
  match; `docs/DATABASE_SCHEMA.md` and `docs/restaurant-import-template.csv`
  (→ `location-import-template.csv`) updated; `api/CLAUDE.md` and
  `frontend/CLAUDE.md` module-structure sections updated.

Verified: `tsc --noEmit` clean on both workspaces, full `ng build`
succeeds, `locations.e2e-spec.ts` (17 tests) passes against the migrated
schema.

**Progress — location privacy + event cadence (2026-07-23):** the second
and fourth decisions above are implemented (attendance needed no code —
see below).
- **Location privacy:** `locations.is_private` column (default `false`,
  existing rows unaffected). New shared `LocationVisibilityService`
  (`api/src/common/services/location-visibility.service.ts`) is the single
  source of truth for "can this viewer see this private location's
  address": admin/mod always can; anyone else only after RSVPing "Going"
  to an event at that location (checked either for a specific event, or
  "any event at this location" on the standalone Locations pages).
  Unauthenticated and not-yet-RSVP'd viewers simply never satisfy either
  condition, so the same helper handles every surface with no special
  casing: `LocationsService` (list/detail), `EventsService` (event
  list/detail, guest-invite emails, publish/update broadcast emails —
  each recipient gated individually since a broadcast can mix Going/Maybe
  RSVPs and non-RSVP'd guest-link holders), `InvitesController`'s public
  preview endpoint, and `CalendarService`'s personal ICS feed (gated per
  event using that subscriber's own RSVP status). Caught and fixed a real
  leak while wiring this up: `buildGoogleCalendarUrl`/`buildInviteAttachment`
  read the raw event object directly for their "Add to Calendar" links,
  bypassing the redaction already applied to the surrounding email body —
  both now take an address override so gated callers can pass `''`.
  New `app_config` row `location_privacy_default` (`public`/`private`)
  sets the default for newly created locations; each location can still
  override it individually via a new toggle in the location form. New
  admin screen at `/admin/settings` edits this alongside the cadence
  settings below. Verified with a new permanent suite,
  `location-privacy.e2e-spec.ts` (14 tests, real HTTP requests against a
  booted app) — covers admin/mod bypass, RSVP-unlocks-address, no leak to
  a *different* non-RSVP'd member, unauthenticated preview, and the
  config-default-vs-explicit-override behavior on create. The full
  existing suite (events/rsvp/invites/locations/calendar — 156 tests) still
  passes, confirming the shared-service refactor didn't regress anything.
- **Event cadence:** `nextTuesdayDate()` in `event-form-dialog.component.ts`
  replaced with `nextWeekdayDate(weekday)`, driven by two new `app_config`
  rows — `event_cadence_weekday` (0=Sunday…6=Saturday, default `2`/Tuesday)
  and `event_cadence_time` (default `18:30`) — fetched when the "new event"
  dialog opens with no explicit preset date/time. Deliberately scoped to a
  fixed weekly cadence only, per Rob's direction — a monthly ("2nd
  Saturday") pattern isn't built pending confirmation of Sons' actual
  schedule.
- **Attendance:** no code needed — Rob confirmed Sons picks up with their
  next event going forward, no historical import.

Verified live in a real browser against a disposable local database + a
temporary `ng serve --proxy-config` (never touched the shared stage DB
`docker-compose.yml`/`.env` point at): logged in as both an admin and a
plain member, created a private location and confirmed the address/lock
icon behave exactly as designed on both the Locations list and detail
pages for each role, edited `/admin/settings` and confirmed the change
persisted and was picked up by the "Create Event" dialog's date default.

**Bug fix found and fixed along the way (2026-07-23):** Rob hit a broken
photo on a newly added location. Root cause pre-dates this phase (same bug
exists on `main` under the old `restaurants/` naming):
`EnrichmentService.downloadStreetViewPhoto` always saved its file to the
correct `<uploadPath>/locations/` disk path, but recorded `file_path` as
`/api/uploads/<filename>` — missing the `locations/` segment `main.ts`'s
static route requires — so every location whose photo came from the
Street View fallback (used when Google Places has no photos, e.g. a
brand-new location or a private home) rendered a broken image. Fixed the
write going forward; added `FixStreetViewPhotoPaths` migration to repair
existing rows (verified against seeded broken + already-correct rows in
an ephemeral DB — only the broken pattern matches, and after the first
run every row looks identical to "always correct," so `down()` is an
intentional no-op rather than risk corrupting good rows on revert). Rob
chose to let this ride with Phase 29 rather than cut a separate hotfix
branch off `main`.

**Progress — branding config (2026-07-24):** app name, tagline, and 3 core
colors (primary/accent/background) are now `app_config`-backed and
admin-editable, scoped to "the config point + frontend" — backend emails
and static pre-bootstrap files still say "DinnerBears" for now (see below).
- New `app_config` keys (`brand_name`, `brand_tagline`, `theme_color_primary`,
  `theme_color_accent`, `theme_color_background`) via `SeedBrandingConfig`
  migration, and a bundled `GET /config/branding` endpoint (registered ahead
  of the generic `:key` route). New "Branding" card in `/admin/settings`
  (name/tagline fields + 3 color-picker rows) alongside the existing
  Location Privacy / New Event Default cards.
- Frontend: new `BrandConfigService`, loaded via `provideAppInitializer`
  same as `AuthService.init()`. Sets a `brand` signal (nav/footer/login
  alt text, tagline, copyright now read from it) and pushes colors onto
  `document.documentElement` as CSS custom-property overrides — applies
  live with no rebuild. Wired the page `Title` service to the brand name too.
- **Found and fixed while browser-verifying:** the color picker only
  recolored elements hand-styled with `var(--db-primary)` — Angular
  Material's native `color="primary"`/`color="accent"` components (used in
  46 files app-wide: raised/stroked buttons, slide-toggles, checkboxes,
  form-field focus states) stayed the old amber-brown. Root cause:
  `styles.scss` used `mat.all-component-themes($theme)`, which bakes
  literal computed colors into each component's tokens rather than
  referencing Material's own `--mat-sys-*` system-level CSS variables (that
  its M3 component styles already fall back to internally). Rob chose to
  fix this now rather than ship it as a documented gap. Fix: swapped to
  `mat.theme($theme-config)` (styles.css dropped from ~95KB to ~37KB — no
  more baked per-component literals), and `BrandConfigService` now also
  sets `--mat-sys-primary`/`--mat-sys-tertiary` (Material's M2→M3 compat
  layer maps `color="accent"` to tertiary, not secondary) plus their
  `on-*` white text-color counterparts. Verified via Playwright screenshots
  across locations list/create-dialog (buttons, slide-toggle), events list
  (checkbox), and `/admin/settings` itself — all correctly follow a test
  color change (amber → green) with no layout regressions.
- Also cleaned up ~35 files of hardcoded/phantom color literals unrelated
  to this round's admin-config wiring but blocking it from being trustworthy:
  a `--db-blue` CSS variable referenced 15 times but never defined (always
  silently falling through to a stale `#1e4d8c` hex fallback), plus
  `--db-gold` and `--db-text-light` (also phantom, found via an exhaustive
  sweep beyond what was originally flagged), and bare hex literals that
  should have been `var(--db-*)` references. Reconciled `index.html`'s
  `theme-color` meta tag and `public/manifest.webmanifest` (previously the
  stale blue) to match the real live amber palette.
- Verified: `SeedBrandingConfig` migration up/down against a fresh ephemeral
  DB (full migration chain from scratch, not just this one), frontend
  `tsc --noEmit` + `ng build` both clean, and full live browser verification
  (never against the shared stage DB — a disposable local MySQL + API +
  `ng serve --proxy-config`, same pattern as the privacy/cadence round).

**Progress — brand images, single-city UX, hardcoding audit, bootstrap
(2026-07-24):** the remaining phase scope is now built and verified.
- **Brand images (admin-uploadable):** Rob chose to build real upload UI
  rather than document a file-swap. Three configurable slots — `logo`
  (nav/footer/reservation), `splash` (login hero), `icon` (favicon +
  small marks on join/guest-rsvp). New `app_config` keys
  `brand_logo_url`/`brand_splash_url`/`brand_icon_url` (empty = fall back to
  the compiled-in default asset), served from `<UPLOAD_PATH>/branding/` via
  a new static route, uploaded through `POST admin/config/branding/image/:slot`
  (+ a `.../reset` PATCH), reusing the existing multer/disk-storage pattern
  (5 MB, PNG/JPEG/WebP/GIF; unique filename doubles as cache-busting).
  `getBrandingConfig()` + `/config/branding` now return the three URLs;
  `BrandConfigService` exposes `logoSrc()`/`splashSrc()`/`iconSrc()` computed
  sources (uploaded URL or default) that every `<img>` binds to, and swaps
  the live favicon `<link>` at runtime. New "Images" section in
  `/admin/settings` (preview + Upload + Reset per slot) calls
  `BrandConfigService.refresh()` after each change so it applies with no
  reload. The installed-PWA manifest icon remains a static file swap (noted
  in the UI + setup doc); the in-app favicon does update at runtime.
- **Single-region UX:** `CityService.currentCity` now falls back to the sole
  active city when the host carries no chapter subdomain (root-domain fork),
  and a new `isSingleCity` computed hides the city filter on the events,
  locations, members, and leaderboard browse pages, and auto-selects + hides
  the city field in the event and location create/edit forms and profile
  settings. The public `/cities` endpoint already returns active-only, so
  "one active city" is the trigger.
- **`dinnerbears.com` hardcoding audit:** OAuth callback URIs were already
  `APP_URL`-derived and CORS is handled at NGINX (nothing to change). New
  `common/config/instance-contact.ts` derives public contact addresses from
  `BASE_DOMAIN` (falling back to `APP_URL`'s host): calendar-feed reply-to
  (`SUPPORT_EMAIL` → `hello@<domain>`), calendar organizer
  (`CALENDAR_ORGANIZER_EMAIL` → `calendar@<domain>`), and .ics event organizer
  (`EVENT_ORGANIZER_EMAIL` → `noreply@<domain>`) — previously hardcoded
  `@dinnerbears.com`. Fixed a `FRONTEND_URL`-vs-`APP_URL` inconsistency in the
  account-lock email and removed the now-dead `frontendUrl` field. The ICS
  `UID:` scheme is left as a stable opaque internal id (round-trip-parsed on
  import — not user-facing branding). New env vars added to
  `docker-compose.yml`. Email *copy* still says the platform name generically
  — deliberately out of scope, same as the branding round.
- **Bootstrap:** `api/src/bootstrap.ts` (compiled to `dist/bootstrap.js` so it
  runs in the devDep-pruned prod image via `node dist/bootstrap.js`, or
  `npm run bootstrap` locally). Env-driven and idempotent: upserts one active
  city (deactivating the seeded Cincinnati/Dayton defaults rather than
  deleting, keeping FK refs valid), overrides only the branding values the
  operator passes, ensures the `email_provider_config` row, and creates a
  first password-based admin. A guardrail refuses to run on a DB that already
  has non-automation users unless `INSTANCE_BOOTSTRAP_FORCE=true`.
- **`docs/NEW_INSTANCE_SETUP.md`:** full operator runbook — external accounts
  (Google/Facebook OAuth, Brevo/Resend, VAPID, Maps, Anthropic), the grouped
  `.env` checklist, branding (UI vs. bootstrap vs. static file swap), build +
  migrate + bootstrap, first sign-in, and known limitations.
- Verified end-to-end against a disposable local MySQL (never the shared stage
  DB): full migration chain + `bootstrap.ts` (fresh run, guardrail refusal,
  idempotent force re-run all confirmed via direct SQL), backend + frontend
  `tsc` and `ng build` clean, and a Playwright pass on a bootstrapped "Sons"
  instance — dynamic name/tagline/colors, city filter hidden, image upload
  applying live to the nav + preview with working fallback and reset, and
  the bootstrap-created password admin signing in.

**Definition of done:** met, with one carried-forward deferral — **monthly
"Nth weekday" event cadence** (e.g. "2nd Saturday") is still not built; the
configurable cadence covers a fixed weekly day/time only, pending Sons'
confirmed schedule (Rob's call to leave it for a later, isolated round rather
than reopen the phase). Everything else in the scope above is implemented and
verified.

## Phase 30 — Editable Legal Copy (Terms, Privacy, About) ✅ Complete

Started 2026-07-22. Split out of Phase 29 (white-label template,
`phase-29-white-label-template` branch — see that branch's PHASES.md for
its full scope): Terms, Privacy, and About/story copy currently live as
full inline HTML in hardcoded Angular components
(`frontend/src/app/features/legal/*.component.ts`), so editing any of it
requires a code change and redeploy — for DinnerBears itself, not just a
future fork. Doing this first, ahead of the rest of Phase 29, since it
stands on its own and has standalone value regardless of whether the
Southwest Ohio group ever launches. Branched as
`phase-30-editable-legal-copy`.

Scope:
- New `app_config` rows for each piece of copy (reusing the existing
  key/value config table — see `app_config` in this file's earlier
  entries / `docs/DATABASE_SCHEMA.md` — rather than a new table), seeded
  with DinnerBears' current text as the starting value
- Admin editor screen to view/edit each config value, reusing the
  existing `ngx-quill` rich-text component already used in the
  feedback/releases admin screens
- Update `legal/terms.component.ts`, `legal/privacy.component.ts`, and the
  About/story page to fetch and render the `app_config` value instead of
  hardcoded template HTML
- Confirm sensible fallback/empty-state behavior if a config row is ever
  missing or blank (fresh database before seeding, etc.)

### Notable decision
The "About/story" copy turned out not to be a separate page — it's the
`story-section` embedded in `home.component.ts`, mixing free-form narrative
(headline, paragraphs, quote) with a structured milestone timeline and map
image. Rob chose to make the entire `.story-copy` block (narrative +
milestones) a single editable HTML blob rather than splitting the
milestones out as structured data; the map/lightbox stayed hardcoded since
it's not copy. All three editable regions (`legal-copy` on Terms/Privacy,
`story-copy` on the home page) needed `::ng-deep` added to their component
styles, since Angular's view encapsulation doesn't style content injected
via `[innerHTML]` otherwise.

### Verification
Caught and fixed a real bug by actually running the stack rather than
trusting `tsc`: `AppConfigEntity.description` needed an explicit
`type: 'varchar'` — TypeORM can't infer a column type from a `string | null`
union, and it crashed the app at boot against a real MySQL connection.
Verified end-to-end against an ephemeral MySQL container (real migrations,
not `synchronize()`): guard behavior (401/404 as expected), an edit made
through the actual `/admin/legal` UI persisting through the API to MySQL
and appearing on the public `/terms` page, and the `::ng-deep` styling
rendering correctly in a real browser for Terms, Privacy, and the home
story section. Also found and removed `frontend/public/terms.html` /
`privacy.html`, pre-Angular static placeholder pages fully superseded by
this phase (confirmed harmless in production either way — nginx's
`try_files` never appends `.html` to bare routes like `/terms`).

**Definition of done:** Rob can edit Terms, Privacy, or About copy from
the admin UI and see it reflected live on the public pages, with no code
change or deploy. Phase 29's bootstrap script (once built) seeds a new
fork's own starting copy into these same `app_config` rows.

## Phase 31 — Runtime White-Label (one image, DB-driven) ✅ Complete

Started 2026-07-24 on `phase-31-runtime-white-label`. Standing up the "Sons"
(Southern Ohio Naturist Society) instance on `sons-stage.rtippenhauer.com`
exposed that the frontend bundle still hardcoded per-instance values at
**build time** (`environment.stage.ts`: `rootUrl`, `baseDomain`,
`vapidPublicKey`, `facebookAppId`, `isStage`), plus a brown "chrome" palette
and a static bear-avatar set. Goal: **one generic image serves every
instance**, everything resolved at runtime from the instance's DB + `.env`.

Locked decisions: avatars = admin-uploadable per instance; chrome = derived
from the primary color at runtime; the published image renamed to
`rtippenhauer/community-events`.

Scope delivered:
- **Runtime config decoupling** — `/config/branding` (`AppConfigService.getBrandingConfig`)
  extended to also return `vapidPublicKey` / `facebookAppId` / `isStage` /
  `appUrl` / `baseDomain` from the instance's own `.env` (baseDomain via the
  shared `instance-contact.ts` derivation). Every frontend consumer migrated
  off `environment.*` to `BrandConfigService` (push, Facebook login ×3, stage
  banner, the safety-net redirect, admin-cities). `environment.*.ts` collapsed
  to `{ production, apiUrl }`; the separate `stage` Angular build config
  removed (stage vs prod is now the runtime `IS_STAGE` flag; the tab title
  gets a "(Stage)" suffix).
- **Chrome from primary** — new `core/utils/color.util.ts` (hex↔HSL);
  `BrandConfigService.applyColors` derives `--db-brown-*` / `--db-banner` /
  `--db-accent-on-dark` from the configured primary. Hardcoded `#b34a00` /
  `#4A2208` in `app.component.scss` replaced with the derived vars.
- **Admin-uploadable avatars** — new `avatar` table + `avatars` module
  (public `GET /avatars/manifest`, admin CRUD/upload to the uploads volume);
  migration seeds DinnerBears' 32 bears; bootstrap clears them for a fresh
  fork. `UsersService.setAvatar` now validates the path against the avatar
  table. The bear fallbacks across ~9 components replaced with a neutral
  `default-avatar.svg`.
- **Admin-uploadable home Story image** (`brand_story_url`) + **three editable
  home rich-text blocks** — hero (`home_hero_html`), "How it works"
  (`home_howitworks_html`), and the existing story copy — edited in the
  ngx-quill editor (`/admin/legal`, retitled "Content & Legal"), each hidden
  when cleared (`hasContent()` treats the editor's `<p><br></p>` as empty).
  The "How it works" CSS renders either a numbered prose list (WYSIWYG) or the
  original 3-column `.steps` grid (raw HTML). Migrations seed DinnerBears'
  copy; bootstrap clears them for forks.
- **Home stats-bar toggle** (`home_show_stats`) with an admin switch.
- **App-wide de-branding** — ~20 components + `events.service` share text had
  hardcoded "DinnerBears"/bear wording replaced with the runtime brand
  name/tagline or neutral phrasing.
- Image renamed to `rtippenhauer/community-events` in the publish/scan scripts
  and the `/release`, `/phase-done`, DEV docs; `NEW_INSTANCE_SETUP.md` updated.

### Deployment lessons (not code)
Standing up stage surfaced several environment gotchas, none of them Phase-31
code: a **stale Unraid container template** kept re-pinning the old
`dinnerbears:stage` image on every edit; a **98%-full `docker.img`** stalled
MySQL writes and wedged logins (a hung write, not the DB — reads kept working);
and **duplicate `access_token` cookies** (one `Secure`, one not — from
`NODE_ENV` flipping between deploys) caused "logs in but won't stick." Fixes:
edit the template's Repository, enlarge/prune the vDisk, clear cookies, and set
`NODE_ENV=production` + `IS_STAGE=true` per instance.

### Verification
Both DinnerBears-Stage and Sons-Stage run the single `community-events:stage`
image; `/config/branding` confirmed resolving each instance's own
appUrl/baseDomain/isStage/VAPID/story values, login working, and the home
page fully branded per instance. API + frontend build clean; e2e spec
(`api/test/white-label.e2e-spec.ts`) added for the branding-config fields and
avatars CRUD.

**Definition of done:** one generic image, configured entirely from DB +
`.env`, serves DinnerBears and Sons with per-instance branding, avatars, home
content, and no leftover DinnerBears wording. ✓

**Deferred to Phase 32:** configurable terminology (Restaurant / Dinner / Bear
Points → per-instance terms), and background removal/flattening for
admin-uploaded logo images. `.env.example` documentation check also pending
(a local permission guard blocked editing it this phase).

## Phase 32 — Configurable Terminology + White-Label Polish ✅ Complete

The UI hardcoded DinnerBears/dining-specific nouns — "Restaurant(s)", "Dinner(s)",
and "Bear Points" — which don't fit a non-dining instance like Sons (a naturist
social club that meets at members' homes). Phase 29 renamed the *database* entity
restaurants→locations but left the **display term** hardcoded.

Delivered:
- **Admin-configurable terminology** — five `term_*` `app_config` rows
  (location singular/plural, gathering singular/plural, points) served on
  `/config/branding` and exposed as `BrandConfigService` signals (with `*Lower`
  variants for mid-sentence copy). Edited from a new "Terminology" card in
  `/admin/settings`. Defaults are **generic/de-branded** (Location(s) /
  Event(s) / Points); migration `1785000000004` seeds DinnerBears' historical
  words so prod is unchanged, and a fork's bootstrap DELETEs those rows to fall
  back to the code defaults (delete, not blank — `getSiteSetting` only falls
  back on a missing row).
- App-wide replacement sweep (~30 files) swapping the hardcoded nouns for the
  signals, **including compound labels** (Secret/Special {Event}, achievement
  category labels/descriptions, default event title, calendar/guest-RSVP copy);
  module-level label maps converted to term-aware factory functions.
- **Logo background strip** — `shared/utils/strip-logo-background.ts` flood-fills
  a solid background box to transparent on logo upload (client-side canvas;
  safe no-op fallback), so an uploaded logo no longer shows a white box on the
  dark nav.
- **Residence locations** — `is_residence` flag (migration `1785000000005`) +
  form toggle. Enrichment skips the Google Places business lookup and the
  "restaurant" description for a residence, only attempting a Street View photo,
  and never rewrites the address.
- **Private-venue photos hidden until RSVP** — the events redaction and the
  locations `redact()` helper now strip `location.photos` alongside the address
  server-side; event cards show a "Private until RSVP" cover and the
  event-detail hero a matching panel (mirroring the Cancelled treatment).
- **Founding Bear → Founding Member** — migration `1785000000006` renames the
  achievement (name/title + any selected title) for forks but skips DinnerBears
  (detected by `dinnerbears.com` domain OR `brand_name` still "DinnerBears").
  Hardcoded frontend "Founding Bear" strings de-branded to "Founding Member".
- **De-branded member-invite email** — reads `brand_name` instead of hardcoded
  "DinnerBears" (subject + htmlBody + Brevo `brand_name` param).
- Private locations hidden from the browsable `/locations` list for non-admin/mod
  viewers (`findAllForUser` filter).
- `.env.example` (repo root) now documents `IS_STAGE` and `BASE_DOMAIN`.

## Phase 33 — White-Label Finishing Touches ✅ Complete

Items deferred out of Phase 32 as the white-label work is finished off:
- **De-branded the remaining transactional emails** — the event-published
  notice, RSVP confirmation, event reminder, and the calendar `.ics` summary
  in `events.service.ts` plus the calendar feed in `calendar.service.ts` now
  read `brand_name`/`brand_tagline`/`term_dinner_*` via new `getEmailBrand()`/
  `getBrand()` helpers, the same way the Phase 32 invite email does. DinnerBears
  output is byte-identical (terms still pin Dinner/Dinners). The ICS UID
  (`dinnerbears-event-{id}@dinnerbears.com`) was deliberately left unchanged —
  `processRsvpReply` and existing calendar entries key off it. (Brevo
  *dashboard* templates still override the code htmlBody — a fork pointing
  `BREVO_TEMPLATE_*` at DinnerBears-branded templates must de-brand/unset
  those separately; dashboard action, not code.)
- **Per-instance feature/menu toggles** — a general on/off framework, not a
  one-off: `feature_*` boolean `app_config` rows (migration
  `1785000000007`, default `'true'` so nothing changes for DinnerBears or a
  fresh fork) cover **Ratings, the points Leaderboard, Merch, and the Members
  directory**, plus a `feature_ratings_residences` sub-rule (ratings can stay
  on globally but be suppressed specifically for Residence locations). Server
  side: `AppConfigService.getFeatureFlags()`/`isFeatureEnabled()`, surfaced on
  `/config/branding`, enforced by a global `FeatureGuard` +
  `@RequireFeature('feature_x')` decorator (404 when off) applied to the
  ratings, leaderboard, merch, and members endpoints — the real enforcement is
  server-side, never just a hidden nav item. Frontend: `BrandConfigService`
  feature signals, nav items gated with `@if`, a `featureGuard()` route guard
  redirecting to a new `/feature-unavailable` page, and a "Features" card with
  slide-toggles in `/admin/settings`.
- **Founding Member label consistency** — a new `BrandConfigService.foundingLabel()`
  computed signal reads `brand_name` the same way the Phase 32 achievement-rename
  migration does: `'Founding Bear'` on DinnerBears, `'Founding Member'`
  everywhere else. Wired into all 5 surfaces that previously hardcoded
  "Founding Member" (profile/member-profile category maps, merch store copy,
  admin-achievements labels, admin-merch labels).
- **Location-detail photo cover** — added a `showPrivateCover` computed (same
  `isPrivate && !address` redaction signal the event card already used) and a
  "Private until RSVP" overlay in the photo area, mirroring the event-card
  treatment from Phase 32.

**Shared release-note pipeline** (built alongside the above, not originally
scoped into Phase 33 but landed on this branch): release notes describing
code changes now ship *with the code* instead of requiring a manual API call.
`api/release-notes/<version>.md` files are baked into the Docker image; a new
boot-time `ReleaseNotesImporterService` (`OnApplicationBootstrap`) reads them
and upserts into each instance's own `releases` table on every container
start — markdown→HTML via `marked` (pinned to `^15.0.12`; v16+ dropped
CommonJS support, which broke this project's `ts-jest` setup — flagged as a
later swap to `markdown-it`), sanitized with the same policy the admin editor
already used. Finalized notes publish on every instance automatically —
cutting a release *is* the publish approval now, a scoped exception to
"Claude never publishes." The in-progress `docs/NEXT_RELEASE.md` draft is
copied into the image as `_draft.md` and surfaces only on stage
(`IS_STAGE=true`, under a placeholder `'Upcoming'` version), never prod, and
is removed again once empty or once `IS_STAGE` flips off. The frontend
substitutes `{{points}}`/`{{locations}}`/`{{events}}` tokens per-instance so
one shared note reads correctly on every fork's own terminology. `/release`
and `/phase-done` were rewritten to match — see
`docs/RELEASE_NOTE_PIPELINE_SPEC.md` for the full design and
`api/test/release-notes-import.e2e-spec.ts` for coverage.

Monthly "Nth weekday" event cadence (carried forward since Phase 29, see its
Definition of Done note above) is explicitly pushed out of Phase 33 as well —
it will get its own later phase rather than ride along here.

### Verification
- `cd api && npm run build` — clean.
- `cd api && npm run test:e2e` — full suite green except 3 pre-existing
  failures (`location-privacy`, `calendar`, `uploads` specs) confirmed via
  `git stash` to already fail on the unmodified branch tip, unrelated to this
  phase's changes.
- `docker build --target api-build` + `docker run ... ls/cat` confirmed
  `release-notes/_draft.md` actually lands in the built image.
- `cd frontend && npx tsc --noEmit -p tsconfig.app.json` — clean.

## Phase 34 — Live-Fire Reliability Fixes ✅ Complete

Not a planned phase — four ad hoc bugfixes surfaced by actually exercising
Phase 33's white-label work live on `stage.dinnerbears.com` and
`sons-stage.rtippenhauer.com` right after it shipped. Each landed as its own
branch/PR (never merged into a shared phase branch, since none existed):

- **`/admin/settings` save could 429 under the write rate limit** (PR #24).
  The settings form fired one `PATCH /admin/config/:key` per field via
  `forkJoin` — 19 requests as of Phase 33's five new feature-toggle fields,
  up from 14 before. A double-click or retry pushed past
  `ThrottlerAuditGuard`'s global write-rate-limit fallback (30 writes/60s/IP),
  which manifested as a wall of 429s and some fields (e.g. `feature_merch`)
  silently failing to save. Fixed with a new `PATCH /admin/config/bulk`
  endpoint (`BulkUpdateAppConfigDto`, validates every key up front so an
  unknown key rejects the whole batch rather than partially applying it); the
  settings form now calls it once. New e2e coverage in
  `api/test/app-config-bulk-update.e2e-spec.ts`, including a regression test
  that fires the full 19-field payload twice back-to-back.
- **Release-notes importer silently skipped imports when the automation
  account was role-elevated** (PR #25, then tightened further in PR #26).
  `ReleaseNotesImporterService.getAutomationAuthorId()` originally matched on
  `email + role: AUTOMATION`. Temporarily elevating that account to
  `admin`/`member`/`moderator` via the admin role-picker — a supported,
  documented flow (see `users.service.ts`'s `isAutomationAccount` comment) —
  made the importer find nothing and quietly skip the whole import at boot.
  Fixed to match by `full_name` + `email` only (role can legitimately be
  anything at boot time), the same identification pattern
  `isAutomationAccount` already used. Regression test covers the
  elevated-role case.
- **Transactional email logos were still hardcoded to DinnerBears' asset**
  (PR #27). Phase 33's email de-branding pass fixed the brand name/tagline/
  terms text in every transactional email, but every email's `<img>` logo
  still pointed at `${appUrl}/assets/logo.png` — the frontend's *compiled-in*
  DinnerBears bear-paw asset, which never resolved to a fork's admin-uploaded
  logo. Found via a real RSVP-confirmation email sent from sons-stage.
  `getEmailBrand()` now also resolves `logoUrl` (the uploaded `brand_logo_url`
  when set, else the same compiled-in fallback path the frontend's
  `BrandConfigService.logoSrc` uses), threaded through all 7 email templates
  that render a logo (event-published, RSVP confirmation, cancellation,
  update, guest invite ×3 via a shared `buildGuestEmail` helper, reservation
  request, seats reminder) — the 2 `.ics`-calendar-only callers are
  unaffected (no image in calendar text). DinnerBears itself is unchanged
  (`brand_logo_url` is empty there).
- **`stage.dinnerbears.com`'s missing `/app/appdata` volume mount** — not a
  code bug. The container had no volume mapping for `/app/appdata` at all, so
  `entrypoint.sh`'s `.env` load (`if [ -f /app/appdata/.env ]; then ...`)
  silently no-op'd — no error, no crash, just every var from that file
  (VAPID keys, `CLAUDE_AUTOMATION_SECRET`, `IS_STAGE`, everything) resolving
  to unset. Symptoms looked like three unrelated bugs (missing VAPID warning,
  automation-login 401, no release notes on that one instance while
  sons-stage worked fine) until traced to one root cause. Fixed by adding the
  volume mapping in Unraid and recreating the container — see
  `reference_unraid_deploy_gotchas` memory for the full diagnosis chain and
  checklist, since it's the kind of failure mode likely to recur on another
  instance.

### Verification
- `cd api && npm run build` — clean after each fix.
- Targeted e2e coverage per fix: `app-config-bulk-update` (5 new cases),
  `release-notes-import` (regression case added, 8 total), `events` +
  `email-push` + `rsvp` + `invites` (146 cases, no regressions from the
  logo-threading change).
- Each fix verified live against `stage.dinnerbears.com` and/or
  `sons-stage.rtippenhauer.com` after rebuilding and pushing the stage image,
  not just in the test suite — this whole phase originated from live testing,
  not a spec.

## Phase 35 — Membership Fee + Residence Bringing Item ✅ Complete

Two admin-requested features, refined through several rounds of clarification
on the exact enforcement rules before landing on this design.

**Membership fee.** A new `feature_require_membership` toggle (`app_config`,
default `'false'` — a brand-new concept nothing depends on, unlike Phase 33's
toggles which defaulted on) in Site Settings → Features. When on:
- Two new columns on `users`: `has_membership` (tinyint, default 0) and
  `membership_expires_at` (datetime, nullable) — migration
  `1785000000008-AddMembershipToUsers`.
- Admins/moderators mark a member's membership from the Members page
  (`admin-users.component.ts`): a new `membership` column (only rendered when
  the toggle is on — `columns` is a `computed()` signal reading
  `BrandConfigService.requireMembershipEnabled()`) shows a Member/Expired/None
  chip + expiration date, with an inline edit row (checkbox + `mat-datepicker`,
  same confirm/cancel micro-interaction pattern as the existing vouch/delete
  row actions) submitting to `POST /admin/users/:id/membership`
  (`SetMembershipDto`, `AdminService.setMembership`, admin+moderator, logged
  via `AuditService`). Leaving the expiration blank defaults it to **January 1
  of the following year**, computed server-side in Eastern time
  (`nextJanuaryFirstEastern()`) so a payment recorded late on Dec 31 doesn't
  roll two Januaries out. Turning membership off clears the expiration too.
- Enforcement lives in `EventsService.upsertRsvp`, alongside the existing
  RSVP-cutoff checks and using the same `isPrivileged` (admin/moderator)
  bypass: a Going RSVP is blocked with a 403 once (a) the toggle is on, (b)
  the member has no active (non-expired) membership, **and** (c) they've
  attended at least one event before (`event_rsvps.attended = true` on any
  past RSVP, via `Repository.exists()`). A member's very first RSVP is
  therefore always free by construction — they can't have attended anything
  yet. Maybe RSVPs are never blocked, matching the existing rule that only a
  Going RSVP unlocks address/location visibility
  (`LocationVisibilityService.canViewAddressSync(..., hasGoingRsvp)`).
- `event-detail.component.ts`'s RSVP error handlers (`addRsvp`,
  `onRsvpStatusChange`) now surface `err?.error?.message` instead of a
  generic "RSVP failed" toast — needed to actually show the membership-block
  message to the member, and incidentally fixes the same problem for the
  pre-existing RSVP-cutoff messages.

**Residence "what are you bringing."** A new nullable `bringing_item VARCHAR(200)`
column on `event_rsvps` (migration `1785000000009-AddBringingItemToEventRsvps`,
same shape as the existing `guest_names` column/migration). Optional — not
location-gated server-side, same trust model as `guest_names`; the UI only
*offers* the input for events at Residence locations
(`isResidenceEvent = computed(() => !!event()?.location?.isResidence)`).
Saved on blur from a dedicated field in the RSVP panel, and shown next to the
attendee's name (🍴 icon) in the Going list, gated to the same
validated-member view that already conditionally shows guest names. The
events **list** view's `attendeeSnippet` (name+photo only, no RSVP detail)
is intentionally untouched — extending it wasn't requested.

### Verification
- `cd api && npm run build` and `cd frontend && npx tsc --noEmit -p tsconfig.app.json` —
  both clean.
- New `api/test/membership.e2e-spec.ts` (16 cases): free-first-meeting
  allowed; blocked once attended-before + no membership; allowed with an
  active membership; still blocked when membership is expired; Maybe never
  blocked; admin/moderator bypass; no enforcement when the toggle is off;
  `POST /admin/users/:id/membership` default/explicit/cleared expiration +
  role gating; `bringingItem` persists/round-trips, normalizes blank to
  `null`, works regardless of location type, rejects over 200 chars.
- Full e2e suite (577 cases) run for regressions: 575 pass; the 3 failures
  (`uploads`, `location-privacy`, `calendar` specs) are the same pre-existing,
  unrelated failures confirmed via `git stash` against the unmodified branch
  tip in earlier phases — not introduced by this phase.


## Phase 36 — Comment Editing ✅ Complete

Members can now edit their own comments anywhere they appear in the app. Scoped
after checking every comment-like surface: event comments, event comment replies,
and announcement comments are the three real ones. Location *rating* comments were
already editable by re-submitting a rating (`RatingsService` upserts on the
existing row), so they needed no work.

**Decisions taken up front**, since each changed the shape of the work:
- **Author-only.** Deliberately *unlike* delete, which moderators and admins may
  perform on anyone's comment. Rewording text that stays attributed to its original
  author is a worse failure mode than removing the comment outright, so admins and
  moderators get a 403 on edit. Asserted in tests on both surfaces so it can't
  silently regress into mirroring the delete rule.
- **No time window.** A member can edit their own comment however old.
- **"(edited)" marker**, not silent edits and not full revision history.

**Schema.** Migration `1785000000011-AddEditedAtToComments` adds a nullable
`edited_at DATETIME` to all three tables in one migration, each guarded by an
`information_schema` existence check so a re-run is a no-op. `edited_at` stays
`NULL` until the first edit — a non-null value is exactly what "this no longer
matches what was posted" means, so it drives the marker with no extra flag.

**API.**
- `PATCH /events/:eventId/comments/:commentId` and
  `PATCH /events/:eventId/comments/:commentId/replies/:replyId`
  (`EventCommentsService.editComment` / `.editReply`).
- `PATCH /announcements/comments/:commentId`
  (`AnnouncementsService.editComment`), mirroring the existing DELETE route
  shape and the same non-validated-member block as posting.
- Reuses `CreateCommentDto`, so the 1–2000 char validation is shared with create.
- Editing a soft-deleted comment 404s rather than resurrecting it. `CommentView` /
  `CommentReplyView` gained `editedAt`, nulled out for deleted comments alongside
  the already-nulled body.

**Frontend.** Inline edit forms on `event-detail.component.ts` (a single
`editingTarget` signal of `{kind, id}` — only one comment or reply is editable at a
time, so per-item signals would be waste) and `announcement-detail.component.ts`.
The edit button renders only for the author; the "(edited)" marker carries the exact
edit time on hover.

**Bug found and fixed along the way.** The announcement "Add a comment" form bound
`(submit)` on a `<form>` with no `[formGroup]`. `FormGroupDirective` is what normally
intercepts the native submit and calls `preventDefault()` — importing
`ReactiveFormsModule` does not — so every comment post ran the handler *and then* let
the browser do a real form submission, reloading the whole SPA. Reproduced before
fixing (a marker set on `window` was gone after clicking Post) and re-verified after.
The comment usually still saved, which is why this never looked broken: the POST
normally wins the race against the navigation that aborts it, though on a slow
connection it would be cancelled instead. Fixed by wrapping the existing control in a
one-field `FormGroup` and switching to `(ngSubmit)`. A follow-up commit brought
`admin-announcements.component.ts` to `(ngSubmit)` too — that one was *not* broken
(it has a `[formGroup]`), purely consistency. No bare `(submit)` bindings remain.

**Testing.**
- 13 new e2e cases (8 in `event-comments.e2e-spec.ts`, 5 in
  `announcements.e2e-spec.ts`). Announcement comments had **no** e2e coverage at all
  before this phase.
- Migration exercised up → down → up → re-run against real MySQL; the re-run
  correctly reports no pending migrations.
- Browser-verified against a local stack across all three surfaces: edit button
  appears only on your own items, edits save, the marker renders, changes survive a
  reload.
- Full e2e suite: 588 pass. The failures in `uploads`, `location-privacy` and the two
  `calendar.e2e-spec.ts` typecheck errors are the same pre-existing ones, re-confirmed
  this phase by `git stash`-ing the branch and running them against clean `main`.


## Phase 37 — Residences Are Not Rateable ✅ Complete

Scoped as a "mini phase" to stop residences being rateable — rating someone's
private home doesn't make sense. Investigation changed the shape of it entirely:
**the feature already existed.**

Phase 33 had shipped `feature_ratings_residences` as a working admin toggle
covering every path — `submitRating` 403s, `getRatings` clears the eligible-events
list, `getRatingQueue` drops residence events, and the frontend already gated the
rating form at `location-detail.component.ts:956`. It defaulted to `'true'` purely
to preserve the behavior of the day. So this phase flips a default rather than
building anything. Location *rating comments* were separately confirmed
out of scope: `RatingsService` upserts on the existing row, so members could
already edit those by re-submitting.

**Decisions taken up front**, both of which changed the work:
- **Flip the default**, rather than just switching the toggle off by hand — so a
  fresh fork also starts non-rateable.
- **Delete existing residence ratings**, rather than merely blocking new ones.
  Rob confirmed this after it was flagged as destructive.

**Changes.**
- Migration `1785000000012-DisableResidenceRatings`: sets the toggle to `'false'`
  on running instances, and `DELETE`s `location_ratings` rows joined to
  `locations.is_residence = 1`. Logs the row count before deleting, since prod
  runs it unattended and there is no way to recover afterward. `down()` restores
  only the toggle — the ratings are gone by design.
- `FEATURE_DEFAULTS` in `app-config.service.ts` → `'false'`, so an absent row and
  a fresh fork both resolve to off. This is now the one feature toggle where
  absent means disabled.
- `brand-config.service.ts`'s client-side fallback → `false`. It previously
  defaulted true on the reasoning that a failed config fetch shouldn't hide an
  enabled feature; here that would render a rating form the API answers with a
  403, so this one fails closed.

**Deliberately not touched: points.** Ratings award a `member_points` row
(`RATING`, 1pt, `referenceId` = location) and can unlock rating-count
achievements. Deleting those would silently shrink real members' leaderboard
totals over a policy change that has nothing to do with them. The ledger keeps
RATING rows pointing at residences whose ratings are gone — internally untidy,
invisible in practice, and the reversible choice.

**Testing.**
- New `residence-ratings.e2e-spec.ts` (5 cases) pins the *default*, since a
  silently flipped-back default would restore exactly what this phase removed:
  residence submit 403s, restaurant submit still 201s, residence offers no
  eligible events, residence absent from the queue while the restaurant remains,
  and an admin re-enabling the toggle makes residence ratings work again.
- The destructive path was exercised against real data rather than trusted:
  seeded 3 residence ratings + 1 restaurant rating + 4 rating points, reverted
  and re-ran the migration, and confirmed residence 3 → 0, restaurant untouched,
  all 4 points surviving, toggle `false`.
- Full e2e suite: 593 pass. The `uploads` / `location-privacy` failures and the
  two `calendar.e2e-spec.ts` typecheck errors are the same pre-existing ones.

**Process note.** This was the first phase to go through `/phase-testing`, and it
immediately earned its keep — the stage build failed. Not from this phase's code:
Docker Desktop is allotted ~1.9GiB, which cannot run the Angular *production*
build alongside another container, and the Node process is OOM-killed with a bare
`exit code 1`. It succeeded once the test MySQL container was stopped. It also
exposed a gap in `/phase-testing` itself, whose pre-flight check built with
`--configuration development` while the Dockerfile uses `production` — so the one
check meant to catch breakage before it reached a container could not see this
class of failure.


## Phase 38 — Frontend Unit Tests + www Mail-Domain Fix ✅ Complete

The long-deferred "frontend has zero tests" item, plus a live production bug
folded in rather than merged on its own.

### The assumption that turned out to be wrong

Every prior note on this — including CLAUDE.md's — said the frontend needed its
own scoped phase because there was "no existing harness or pattern to build on."
That was false. `angular.json` already had a `@angular/build:karma` target,
`tsconfig.spec.json` was present and correct, `karma` + `jasmine-core` were in
`devDependencies`, `ng test` was wired up, and Chrome was installed. **Nobody had
written a single spec.** No tooling decision was needed and the phase was far
cheaper than budgeted.

### Coverage — 91 specs

Chosen by "what breaks the most if it silently regresses", not by file count.

- **`BrandConfigService` (9)** — every nav item, route guard and terminology
  label reads its signals. Pins that features default ON, with the two
  deliberate fail-CLOSED exceptions (`requireMembership`, and Phase 37's
  `ratingsResidences`), the `(Stage)` title suffix, and that a 500 from
  `/config/branding` *resolves* rather than throwing — a rejection there would
  take down bootstrap.
- **Route guards (12)** — all six. The substance is the redirect targets:
  `validatedMemberGuard` sends a non-validated member to `/events`, not `/login`
  (they *are* signed in); `adminGuard` must reject a moderator while
  `moderatorGuard` must accept an admin.
- **`AuthService` (9)** — notably that `isNonValidated()` is false for an
  anonymous visitor, and that `updatePhoto()` does not resurrect a user object
  out of `null`.
- **`authInterceptor` (6)** — `withCredentials` is the entire auth mechanism
  (the JWT is a cookie, not a bearer header); 401 clears + redirects, but
  `/auth/me` is exempt or every anonymous visitor gets bounced on boot; 403/500
  must not log anyone out.
- **`SplashService` (11)** — de-duplication by `queueKey`, without which the 60s
  poll re-shows the same achievement dialog forever; a failing achievements call
  still lets what's-new through; logout empties the queue.
- **HTTP services (37)** — `event-comments`, `announcements`, `events`,
  `locations`. URL and verb per method, since components never touch HttpClient
  directly. Phase 36's edits are PATCH (a stray POST would duplicate a comment);
  announcement comment routes hang off `/announcements` rather than nesting
  under `/announcements/:id`; `restore` is PATCH on its own sub-route, where a
  DELETE would archive what an admin was recovering.
- **`LocationDetailComponent` (5)** — the first component spec. Phase 37's
  `showRatings` gate across the residence × toggle matrix. This was the one
  thing only ever confirmed by looking at stage by hand.

Two specs failed on first run and caught genuine wrong assumptions of mine,
now pinned as documented behavior: `fromDate` and `upcoming` are mutually
exclusive in `getAll` (an `else if` — an explicit date wins), and guest links
POST to `/events/:id/rsvp/link`, not a `/guest-links` collection.

`npm test` now runs headless single-shot so it works in CI with no `CHROME_BIN`
and exits 0; `npm run test:watch` keeps the interactive form.

**Deliberately not covered:** the other ~18 services are thin HTTP wrappers and
the remaining 63 components are mostly template with little logic. More specs
there would cost maintenance without buying signal.

### The www mail-domain fix (folded in, was PR #36)

A member's calendar RSVP reply bounced: *"temporary problem delivering your
message to `calendar@www.dinnerbears.com`."* `baseDomain()` applied its `www.`
strip only to the `APP_URL` fallback path, so an explicit `BASE_DOMAIN` carrying
`www.` was inherited by every derived address. Confirmed by DNS:
`dinnerbears.com` has Cloudflare MX records, `www.dinnerbears.com` has none — so
Gmail retried for 24h and gave up, and **every inbound calendar RSVP reply was
silently dropped**.

The subtlety that took a wrong turn first: `www.dinnerbears.com` *is* the real
web host (the apex publishes no A record at all), so `BASE_DOMAIN` was not simply
misconfigured. It is used for two unrelated things and `www` is wrong for both —
mail derivation, and the cookie/redirect zone. The fix strips `www` in the mail
derivation only, leaving the auth cookie untouched: `auth.controller.ts` reads
`BASE_DOMAIN` directly rather than through the helper, and changing a live cookie
domain strands old cookies for up to 7 days.

Scoped to `v1.5.0` only (tagged 2026-08-02) — the regression came in with the
white-label refactor of 2026-07-24, which did not reach production until the
`v1.5.0` restart, so the exposure was days rather than the two weeks first
estimated. Covered by `instance-contact.spec.ts` (11 cases), the first unit spec
in `api/src`. Prod was separately patched with `CALENDAR_ORGANIZER_EMAIL` +
`SUPPORT_EMAIL` overrides; this makes those optional rather than load-bearing.

### Test-DB readiness

`scripts/test-db-up.sh` brings up the e2e MySQL and waits until it accepts an
authenticated query. `mysqladmin ping` is not a sufficient check: on first-run
init the MySQL image starts a temporary server that answers ping before root
grants are final, so the next statement fails `Access denied` and it looks
random. A fixed `sleep` would only move the race. Verified against a cold start
with the volume destroyed.

## Phase 39 — Muse API + Facebook RSVP Sync ✅ Complete

Muse (the app that creates the Facebook events and reads their Going lists)
now drives the Facebook mirror entirely through an API: it reads events,
manages invite links and links Facebook events to dinners, and pushes Going
lists that the server turns into RSVPs and a merged headcount. The design went
through three rounds on stage with Muse, and each is still visible in the
branch's history.

### Automation accounts and the Muse API

- **`users.is_automation_account`** marks non-person accounts (Claude's, Muse's).
  Only flagged accounts can hold the `automation` or new **`muse`** role, and
  they can be moved between those and up to admin for testing. Created at
  **Admin → Settings → Automation Accounts** as `<name>-automation`, hidden from
  the leaderboard, directory and member search.
- **Tokens (`api_tokens`)**: hashed (SHA-256), shown once, 60-day expiry, one
  live token per account. Muse rotates its own (`POST /muse/token/rotate`, old
  token dies immediately); admins issue/revoke from the same page.
- **`/api/v1/muse/*` behind `MuseTokenGuard`**, which reads only
  `Authorization: Bearer cet_…` and only for a `muse`-role account. The normal
  session guards were left exactly as on `main` — the token works nowhere else,
  and a session cookie doesn't open the Muse routes. Its own 120/min rate limit
  (a sync run can exceed the global 30-writes/min fallback).
- **Muse can:** read events, locations, members (names/IDs only) and attendees;
  list/create/revoke event invite links (the Share dialog's, with ready `/join`
  URLs); link/unlink Facebook events; run the sync. Events and locations are
  read-only for it. Full contract: `docs/MUSE_API.md`.

### Facebook sync

- **Several Facebook events per dinner** (`event_facebook_links`) — a Dayton
  dinner gets the Cincinnati group and Gem City Bears. DinnerBears is the source
  of truth; the sync links a Facebook event automatically on first sight, and a
  Facebook event can mirror only one dinner.
- **One batch call** (`POST /muse/facebook-sync`, Muse's own snake_case
  extraction): every list is applied, then each dinner reconciled, then counts
  computed — so each Facebook event gets its dinner's final `totalGoing`. A bad
  entry (past/draft dinner, Facebook event linked elsewhere) fails alone.
- **Facebook accounts** keyed by numeric Facebook ID, vanity URL kept current;
  both are required per guest. Admins link them to members at **Admin →
  Security → Facebook Accounts** (several per member). Name matches are only
  suggestions — never auto-linked.
- **Unlinked people are Facebook-only attendees**: counted once however many
  lists they're on, shown on the event page and in the attendance dialog, and an
  Attended mark carries over (RSVP + points) when the account is later linked.
- **Linked members**: marked Going if not already (source `facebook_sync`, email
  notes it). A sync-made RSVP is removed only once they're on none of the
  dinner's lists; website RSVPs are never removed. Facebook +1s (named via
  `plus_one_names`, or a bare `plus_ones` count) are stored beside their website
  guests and replaced each run; website guests are never touched, and a
  Facebook +1 is skipped only when its name matches one of their named website
  guests. Repeated names are separate people.
- **Guards**: a `going_count` mismatch removes nobody; an older `extracted_at`
  is skipped; banned/deleted members keep their link, are flagged and never
  counted; a member's own account deletion unlinks their Facebook accounts.
- **Admin "Add to Going"** in the attendance dialog (admin-only, source `admin`,
  never removed by the sync).

### Superseded along the way

The first build parked unmatched people as +1 names on a "sync host" (Rob's)
RSVP. That was replaced by Facebook-only attendees; migration `…014` clears the
host +1s that build wrote (found through its audit entries — stage only). The
`Facebook event ID` column on `events` was added and then removed in favour of
the links table.

### Verification

35 e2e cases in `api/test/integrations.e2e-spec.ts` (tokens and the guard
boundary, role rules, read-only enforcement, invite links, two-group dedupe,
per-source removal, named/unnamed/repeated +1s, carry-over with points, bans,
self-deletion unlink). Full suite 628/630 with only the pre-existing
`uploads` / `location-privacy` / `calendar` failures. Exercised on stage by Muse
(three rounds, final `b4f2458`).

## Phase 40 — Ban Records ➡️ Moved to CommunityEvents (v2-30)

**Not built here, and it will not be** (Rob, 2026-10-01). Moved to the v2
rewrite as **`v2-30`** —
[CommunityEvents `V2_PHASES.md`](https://github.com/rtippenhauer/CommunityEvents/blob/main/V2_PHASES.md#v2-30--ban-records).
No v1 code was ever written, so nothing was abandoned; the spec below moved
across as it stood.

**Why.** CommunityEvents forked from this repo at Phase 38 / v1.5.1 on
2026-08-08, and the goal is now to get DinnerBears onto it as soon as possible
(see its `docs/CUTOVER_PLAN.md`). Every phase finished here afterwards is a
phase that then has to be re-implemented there, so **v1 takes no new phases**:
the port list in `docs/PORT_TO_COMMUNITYEVENTS.md` is final at Phase 39 plus the
three 1.6.1 fixes. Bugfixes may still land here; phases may not.

Building it there instead also takes it off the cutover's critical path
entirely. v1 does not have the feature today, so going live without it is parity
rather than regression — where finishing it here would have made it both a phase
to complete *and* a phase to port.

**One thing changed in the move:** a ban is **community-wide**, not
deployment-wide (Rob, 2026-10-01). That is not a new policy — Cincinnati and
Dayton run as separate databases today, so a ban in one has never bound the
other — but it has to be said out loud in v2, where both are tenants of one
deployment.

### The spec as it stood

A permanent record of every ban so a banned person is recognized if they come
back: name, all emails, Google/Facebook login IDs and linked Facebook sync
accounts, who banned them, when and an optional reason — kept even when the
account is deleted. Sign-up and invite redemption matching a record are blocked
and audited; invites to a banned email are refused; Forceful Ban no longer frees
the email for re-use; an admin **Banned** list with Unban. Meta Facebook-Login
deletion requests drop only the Facebook *login* ID from the record.

# DinnerBears — Database Schema

_Last updated: 2026-09-29_

All tables use MySQL InnoDB, UTF8MB4 charset, managed via TypeORM migrations.
No `synchronize: true`. No manual schema changes.

---

## Table Index

| Table | Phase | Purpose |
|---|---|---|
| `cities` | 1 | City configuration |
| `app_config` | 1 | Key/value platform config |
| `users` | 2 | Member accounts |
| `oauth_accounts` | 2 | Linked Google/Facebook OAuth |
| `login_sessions` | 2 | Device-level session tracking |
| `invites` | 2 | All invite types |
| `facebook_group_config` | 2 | Configured Facebook groups |
| `audit_log` | 2 | Immutable action log |
| `locations` | 3 | Location records |
| `location_photos` | 3 | Photos per location |
| `location_ratings` | 9 | Member ratings per event visit |
| `events` | 4 | Weekly dinner events |
| `event_rsvps` | 4 | Member RSVPs |
| `event_guest_links` | 4 | Shareable/email guest invite links |
| `event_guest_rsvps` | 5.5 | Guest RSVPs (no account required) |
| `email_queue` | 5 | Outbound email queue |
| `email_provider_config` | 5 | Brevo/Gmail toggle and counters |
| `email_suppressions` | 5 | Post-deletion email suppression hashes |
| `notification_preferences` | 5 | Per-member email/push opt-ins |
| `feedback` | 6 | Member-submitted bugs and feature requests |
| `feedback_notes` | 6 | Threaded admin/member notes on feedback tickets |
| `feedback_upvotes` | 6 | Member upvotes on feedback tickets |
| `releases` | 6 | Published release/changelog entries |
| `release_feedback` | 6 | Join: releases ↔ feedback tickets |
| `password_reset_tokens` | 11 | Password reset flow (token table) |
| `email_verification_tokens` | 11 | Email verification for new accounts |
| `push_subscriptions` | 7 | Web Push VAPID subscriptions |
| `notifications` | 7 | In-app notification inbox |
| `announcements` | 7 | Admin/moderator announcements |
| `announcement_comments` | 7 | Comments on announcements |
| `content_flags` | 7 | Legacy per-module content flags (announcements only) |
| `content_reports` | 10.6 | Unified member content reports (replaces content_flags) |
| `event_comments` | 10 | Threaded comments on events |
| `event_comment_replies` | 10 | Replies to event comments (one level deep) |
| `facebook_deletion_requests` | 10.5 | Meta server-to-server deletion callback log |
| `achievements` | 15 | Achievement definitions (keys, icons, titles, progress rules) |
| `member_achievements` | 15 | Earned achievements per member |
| `member_points` | 15 | Bear Points ledger (one row per award event) |
| `custom_icons` | 17 | Reusable icon library for achievements |
| `avatar` | 31 | Per-instance preset profile avatars (admin-managed) |
| `api_tokens` | 39 | Hashed API tokens for automation accounts (Muse) |
| `event_facebook_links` | 39 | Facebook events mirroring a dinner (several per dinner) |
| `facebook_accounts` | 39 | Facebook people seen on synced Going lists, linkable to members |
| `facebook_event_attendees` | 39 | A Facebook account's merged Going status + +1s per dinner |

---

## cities

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
name            VARCHAR(100) NOT NULL           -- "Cincinnati"
subdomain       VARCHAR(50) NOT NULL UNIQUE     -- "cincinnati"
is_active       TINYINT(1) NOT NULL DEFAULT 1
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
```

Seed rows: Cincinnati (cincinnati), Dayton (dayton)

---

## users

```sql
id                              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
full_name                       VARCHAR(200) NOT NULL
email                           VARCHAR(255) NOT NULL UNIQUE
email_status                    ENUM('pending','active','unsubscribed','bounced','complained')
                                NOT NULL DEFAULT 'pending'
email_verified_at               DATETIME NULL
password_hash                   VARCHAR(255) NULL           -- NULL for pure OAuth accounts
-- Email/password auth tokens (stored hashed inline, expire quickly)
email_verification_token        VARCHAR(255) NULL           -- Phase 11
email_verification_expires_at   DATETIME NULL               -- Phase 11
password_reset_token            VARCHAR(255) NULL           -- Phase 11
password_reset_expires_at       DATETIME NULL               -- Phase 11
city_id                         INT UNSIGNED NOT NULL REFERENCES cities(id)
role                            ENUM('non_validated','member','moderator','admin','automation','muse')
                                NOT NULL DEFAULT 'member'
                                -- 'automation' (Claude) and 'muse' (Phase 39) only on
                                -- automation accounts; both hidden from leaderboard/directory
is_automation_account           TINYINT NOT NULL DEFAULT 0  -- Phase 39: non-person account
                                -- (Claude's, Muse's); fixed at creation. Only these may hold the
                                -- automation/muse roles. Backfilled for automation@dinnerbears.internal.
-- Membership fee (Phase 35): tracked/enforced only when feature_require_membership
-- (app_config) is on. Memberships run calendar-year — admin-set expiration
-- defaults to Jan 1 of the following year (AdminService.setMembership).
has_membership                  TINYINT(1) NOT NULL DEFAULT 0
membership_expires_at           DATETIME NULL
profile_photo_path              VARCHAR(500) NULL
status                          ENUM('active','suspended','deleted') NOT NULL DEFAULT 'active'
-- Invite lineage
invited_by                      INT UNSIGNED NULL REFERENCES users(id)
invite_id                       INT UNSIGNED NULL REFERENCES invites(id)
invite_source                   ENUM('direct','facebook_group','google_oauth','non_validated_link') NULL
invite_source_name              VARCHAR(255) NULL           -- Facebook group name if campaign
-- Activity tracking
last_login_at                   DATETIME NULL
login_count                     INT UNSIGNED NOT NULL DEFAULT 0
qualifying_login_count          INT UNSIGNED NOT NULL DEFAULT 0       -- Phase 17: site-access count, deduped by a time window (distinct from login_count, which only counts actual OAuth/password logins)
last_qualifying_login_at        DATETIME NULL                         -- Phase 17
failed_login_attempts           TINYINT UNSIGNED NOT NULL DEFAULT 0   -- Phase 11 lockout
login_locked_until              DATETIME NULL                         -- Phase 11 lockout
last_failed_login_at            DATETIME NULL                         -- Phase 11 lockout
-- Deletion
deleted_at                      DATETIME NULL
hard_delete_at                  DATETIME NULL               -- deleted_at + 30 days
-- Community (Phase 15)
selected_title                  VARCHAR(100) NULL           -- active title chosen from earned achievements
-- Login splash (Phase 26): pointer to the latest release/announcement this
-- member has been shown — not a read-history table, since the splash only
-- ever surfaces the single latest of each. Backfilled to the current latest
-- of each at migration time so existing members aren't flooded on ship day.
last_seen_release_id             INT UNSIGNED NULL REFERENCES releases(id) ON DELETE SET NULL
last_seen_announcement_id        INT UNSIGNED NULL REFERENCES announcements(id) ON DELETE SET NULL
-- Calendar integration (Phase 16 / 16c)
calendar_token                  VARCHAR(36) NULL UNIQUE     -- iCal feed token; regenerable from Calendar Settings
calendar_city_filter            ENUM('all','city') NOT NULL DEFAULT 'all'
calendar_rsvp_only              TINYINT(1) NOT NULL DEFAULT 0
calendar_auto_invite            ENUM('none','city','all') NOT NULL DEFAULT 'none'
                                -- send .ics invite email when a new event is published
created_at                      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at                      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

INDEX idx_email_status (email_status)
INDEX idx_last_login (last_login_at)
INDEX idx_invited_by (invited_by)
INDEX idx_status (status)
```

**Role notes:** `non_validated` is a role (not a status). Non-validated users can RSVP and view events but cannot invite, post, or submit feedback. Moderators vouch to upgrade them to `member`. Suspended users are blocked at the JWT strategy level on every request.

---

## email_suppressions

Retained after hard delete. No PII — hashed email only.

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
email_hash      VARCHAR(255) NOT NULL UNIQUE
                -- SHA-256(SECRET_SUPPRESSION_SALT + lowercase(email))
reason          ENUM('unsubscribed','bounced','complained') NOT NULL
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
```

---

## oauth_accounts

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
user_id         INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
provider        ENUM('google','facebook') NOT NULL
provider_id     VARCHAR(255) NOT NULL
email           VARCHAR(255) NULL
profile_url     VARCHAR(512) NULL               -- Facebook profile URL (Phase 11)
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

UNIQUE KEY uq_provider_account (provider, provider_id)
INDEX idx_user (user_id)
```

---

## login_sessions

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
user_id         INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
jwt_jti         VARCHAR(100) NOT NULL UNIQUE
user_agent      VARCHAR(500) NULL
ip_address      VARCHAR(45) NULL                -- IPv4 or IPv6
country         VARCHAR(100) NULL               -- geoip-lite
city            VARCHAR(100) NULL               -- geoip-lite
is_active       TINYINT(1) NOT NULL DEFAULT 1
last_active_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

INDEX idx_user (user_id)
```

---

## invites

Handles all invite types in one table.

```sql
id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
token               VARCHAR(100) NOT NULL UNIQUE
type                ENUM('member','admin','campaign_facebook',
                         'guest_rsvp','shareable_rsvp','event_invite') NOT NULL
invite_flavor       ENUM('member','non_validated') NULL
                    -- for event_invite type: determines account type on signup
created_by          INT UNSIGNED NOT NULL REFERENCES users(id)
city_id             INT UNSIGNED NULL REFERENCES cities(id)
event_id            INT UNSIGNED NULL REFERENCES events(id)
                    -- populated for guest_rsvp, shareable_rsvp, event_invite
facebook_group_id   INT UNSIGNED NULL REFERENCES facebook_group_config(id)
                    -- populated for campaign_facebook type
-- Invitee binding (member type only)
bound_to_email      VARCHAR(255) NULL
bound_to_name       VARCHAR(200) NULL
-- Redemption
redeemed_by         INT UNSIGNED NULL REFERENCES users(id)
redeemed_at         DATETIME NULL
-- Guest RSVP conversion
guest_rsvp_id       INT UNSIGNED NULL REFERENCES event_guest_rsvps(id)
-- Constraints
expires_at          DATETIME NOT NULL
is_revoked          TINYINT(1) NOT NULL DEFAULT 0
max_uses            INT NULL DEFAULT 1          -- NULL = unlimited
use_count           INT NOT NULL DEFAULT 0
created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

INDEX idx_token (token)
INDEX idx_created_by (created_by)
INDEX idx_type (type)
INDEX idx_event (event_id)
INDEX idx_facebook_group (facebook_group_id)
```

**Phase 17:** `event_invite` links no longer accept admin-set `max_uses`/`expires_at` — they're always created with `max_uses = 10` and `expires_at` = the event's RSVP cutoff (event start time minus 150 minutes, Eastern). No schema change, just a server-side default change in `InvitesService.createEventInvite`.

---

## facebook_group_config

Up to 3 configured Facebook groups. Used for campaign links and share button
reference. No API calls.

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
name            VARCHAR(255) NOT NULL           -- "DinnerBears Cincinnati"
url             VARCHAR(500) NOT NULL
group_id        VARCHAR(50) NULL                -- Facebook numeric group ID
city_id         INT UNSIGNED NULL REFERENCES cities(id)  -- NULL = not city-scoped
group_role      ENUM('primary','secondary') NOT NULL DEFAULT 'primary'
is_active       TINYINT(1) NOT NULL DEFAULT 1
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
```

---

## password_reset_tokens

Phase 11. Token-per-row model (alternative to inline columns on users — both exist; these are the legacy rows).

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
user_id         INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
token_hash      VARCHAR(255) NOT NULL UNIQUE
expires_at      DATETIME NOT NULL
used_at         DATETIME NULL
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
```

---

## email_verification_tokens

Phase 11.

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
user_id         INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
token_hash      VARCHAR(255) NOT NULL UNIQUE
expires_at      DATETIME NOT NULL              -- 48 hours from creation
used_at         DATETIME NULL
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
```

---

## locations

```sql
id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
name                VARCHAR(255) NOT NULL
address             VARCHAR(500) NOT NULL
lat                 DECIMAL(10,7) NULL
lng                 DECIMAL(10,7) NULL
phone               VARCHAR(30) NULL
website_url         VARCHAR(500) NULL
description         TEXT NULL
city_id             INT UNSIGNED NOT NULL REFERENCES cities(id)
is_active           TINYINT(1) NOT NULL DEFAULT 1
is_private          TINYINT(1) NOT NULL DEFAULT 0   -- Phase 29: address/lat/lng (and, Phase 32, photos) hidden
                                                     -- from members until they RSVP "Going" to an event here
                                                     -- (admin/mod always see it); default for newly created rows
                                                     -- comes from app_config location_privacy_default, per-row overridable
is_residence        TINYINT(1) NOT NULL DEFAULT 0   -- Phase 32: a private home / non-business venue. Enrichment
                                                     -- skips the Google Places business lookup (no name/phone/website/
                                                     -- description/address rewrite) and only tries a Street View photo
imported_from       ENUM('manual','facebook_import') NOT NULL DEFAULT 'manual'
-- Moderator-only fields (Phase 8 — omitted from member API responses)
moderator_notes     LONGTEXT NULL
contact_name        VARCHAR(100) NULL
contact_phone       VARCHAR(30) NULL
contact_email       VARCHAR(150) NULL
enriched_at         DATETIME NULL                   -- Phase 15: last Google Places enrichment run
created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

INDEX idx_city (city_id)
FULLTEXT INDEX ft_name (name)
```

---

## location_photos

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
location_id   INT UNSIGNED NOT NULL REFERENCES locations(id) ON DELETE CASCADE
file_path       VARCHAR(500) NOT NULL
file_name       VARCHAR(255) NOT NULL
mime_type       VARCHAR(100) NOT NULL
sort_order      INT NOT NULL DEFAULT 0
uploaded_by     INT UNSIGNED NOT NULL REFERENCES users(id)
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

INDEX idx_location (location_id)
```

---

## location_ratings

Phase 9. One rating per member per event (not per location — a member can rate the same location multiple times if they attend multiple events there).

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
member_id       INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
event_id        INT UNSIGNED NOT NULL REFERENCES events(id) ON DELETE CASCADE
location_id   INT UNSIGNED NOT NULL REFERENCES locations(id) ON DELETE CASCADE
food            TINYINT UNSIGNED NOT NULL       -- 1–5
service         TINYINT UNSIGNED NOT NULL       -- 1–5
value_rating    TINYINT UNSIGNED NOT NULL       -- 1–5
noise           TINYINT UNSIGNED NOT NULL       -- 1–5
comment         TEXT NULL
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

UNIQUE KEY uq_member_event (member_id, event_id)
```

**Eligibility:** `attended = true` on the corresponding `event_rsvps` row (Phase 10). Non-validated users blocked at API level.

---

## events

```sql
id                          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
city_id                     INT UNSIGNED NOT NULL REFERENCES cities(id)
location_id               INT UNSIGNED NULL REFERENCES locations(id) ON DELETE SET NULL
-- Snapshot fields (copied from location at publish time)
location_name             VARCHAR(255) NOT NULL
location_address          VARCHAR(500) NOT NULL
location_lat              DECIMAL(10,7) NULL
location_lng              DECIMAL(10,7) NULL
-- Event fields
title                       VARCHAR(255) NOT NULL
description                 TEXT NULL
additional_info             TEXT NULL
event_date                  DATE NOT NULL
event_time                  TIME NOT NULL
status                      ENUM('draft','published','cancelled') NOT NULL DEFAULT 'draft'
published_at                DATETIME NULL
cancelled_at                DATETIME NULL
cancelled_reason            TEXT NULL
-- Facebook sharing (no API)
facebook_share_text         TEXT NULL
-- Reservation tracking (Phase 13)
reservation_assignee_id     INT UNSIGNED NULL REFERENCES users(id) ON DELETE SET NULL
reservation_contact_name    VARCHAR(150) NULL
reservation_contact_email   VARCHAR(255) NULL
reservation_confirmed       TINYINT(1) NOT NULL DEFAULT 0
reservation_confirmed_by    VARCHAR(255) NULL   -- name/email of confirming contact at venue
reservation_confirmed_at    DATETIME NULL
reservation_confirmed_note  VARCHAR(500) NULL
reservation_confirm_token   VARCHAR(64) NULL UNIQUE
                            -- token emailed to assignee for one-click confirmation
reservation_seats_email_sent TINYINT(1) NOT NULL DEFAULT 0
created_by                  INT UNSIGNED NOT NULL REFERENCES users(id)
created_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

INDEX idx_city_date (city_id, event_date)
INDEX idx_status (status)
```

**Reservation assignee** is the member tagged as coordinator (suggests the location, makes the reservation). See Phase 15 points system — coordinator earns Bear Points when the event concludes.

---

## event_rsvps

```sql
id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
event_id            INT UNSIGNED NOT NULL REFERENCES events(id) ON DELETE CASCADE
user_id             INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
status              ENUM('going','maybe','not_going') NOT NULL DEFAULT 'going'
additional_guests   TINYINT UNSIGNED NOT NULL DEFAULT 0  -- 0–9
guest_names         JSON NULL                -- array of named guest strings
bringing_item       VARCHAR(200) NULL        -- Phase 35: optional note on what this
                    -- member is bringing, shown for Residence-location events. Not
                    -- location-gated server-side (same trust model as guest_names).
source              ENUM('member','admin','facebook_sync') NOT NULL DEFAULT 'member'
                    -- Phase 39: who created the RSVP. The Facebook sync only ever
                    -- removes 'facebook_sync' ones; a member touching their own RSVP
                    -- makes it 'member'.
facebook_guest_names JSON NULL               -- Phase 39: a linked member's +1s from the
                    -- Facebook comments (null entries = unnamed), kept apart from
                    -- guest_names and replaced every sync
facebook_guest_count TINYINT UNSIGNED NOT NULL DEFAULT 0
                    -- Phase 39: seats those add on top of additional_guests
attended            TINYINT(1) NULL DEFAULT NULL
                    -- NULL = not yet marked; true/false set by mod after event
is_walkin           TINYINT(1) NOT NULL DEFAULT 0
                    -- true for members added by mod at the door (no prior RSVP)
from_other_city     TINYINT(1) NOT NULL DEFAULT 0
                    -- true when a member attends an event outside their home city
created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

UNIQUE KEY uq_event_member (event_id, user_id)
INDEX idx_event (event_id)
INDEX idx_user (user_id)
```

**Cutoff:** New Going RSVPs and guest count increases are blocked 2.5 hours before event time. Admins and moderators bypass this check, and so do RSVPs made on someone's behalf (admin "Add to Going", the Facebook sync — Phase 39).

**Seats** for a Going RSVP = `1 + additional_guests + facebook_guest_count`.

---

## event_guest_links

Links generated when a member adds +1s via email or shareable link, or when a
public RSVP link is created for an event.

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
event_id        INT UNSIGNED NOT NULL REFERENCES events(id) ON DELETE CASCADE
created_by      INT UNSIGNED NULL REFERENCES users(id)
                -- NULL for public/admin-generated links
member_rsvp_id  INT UNSIGNED NULL REFERENCES event_rsvps(id) ON DELETE CASCADE
                -- NULL for public links
source          ENUM('member','public') NOT NULL DEFAULT 'member'
delivery_type   ENUM('email','shareable') NOT NULL
recipient_name  VARCHAR(200) NULL
recipient_email VARCHAR(255) NULL               -- email delivery only
token           VARCHAR(100) NOT NULL UNIQUE
expires_at      DATETIME NOT NULL               -- event datetime
used_at         DATETIME NULL
cancelled_at    DATETIME NULL
attended        TINYINT(1) NULL DEFAULT NULL    -- Phase 15: mod-marked attendance for guests without accounts
guest_rsvp_id   INT UNSIGNED NULL REFERENCES event_guest_rsvps(id)
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

INDEX idx_event (event_id)
INDEX idx_created_by (created_by)
INDEX idx_token (token)
```

---

## event_guest_rsvps

No-account RSVPs (used by public links and guest invite links).

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
event_id        INT UNSIGNED NOT NULL REFERENCES events(id) ON DELETE CASCADE
name            VARCHAR(200) NOT NULL
email           VARCHAR(255) NOT NULL
cancel_token    VARCHAR(100) NOT NULL UNIQUE
cancelled_at    DATETIME NULL
-- Lineage
invite_id       INT UNSIGNED NULL REFERENCES invites(id)
invited_by      INT UNSIGNED NULL REFERENCES users(id)
                -- NULL if came via admin campaign link
invited_by_campaign INT UNSIGNED NULL REFERENCES facebook_group_config(id)
                -- populated if came via campaign_facebook link
-- Conversion
converted_to    INT UNSIGNED NULL REFERENCES users(id)
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

INDEX idx_event (event_id)
INDEX idx_email (email)
```

---

## email_queue

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
to_email        VARCHAR(255) NOT NULL
to_name         VARCHAR(200) NULL
subject         VARCHAR(500) NOT NULL
template_id     VARCHAR(100) NULL
html_body       LONGTEXT NULL
text_body       TEXT NULL
priority        TINYINT NOT NULL DEFAULT 5      -- 1=highest, 10=lowest
status          ENUM('pending','sent','failed','cancelled','blocked')
                NOT NULL DEFAULT 'pending'
provider        ENUM('brevo','gmail') NULL
attempts        INT NOT NULL DEFAULT 0
last_attempt_at DATETIME NULL
error_message   TEXT NULL
brevo_status    VARCHAR(100) NULL               -- actual status from Brevo webhook
send_after      DATETIME NULL
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
sent_at         DATETIME NULL

INDEX idx_status_priority (status, priority)
INDEX idx_send_after (send_after)
```

---

## email_provider_config

```sql
id                      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
brevo_enabled           TINYINT(1) NOT NULL DEFAULT 1
gmail_overflow_enabled  TINYINT(1) NOT NULL DEFAULT 0
brevo_daily_limit       INT NOT NULL DEFAULT 300
gmail_daily_limit       INT NOT NULL DEFAULT 500
brevo_sent_today        INT NOT NULL DEFAULT 0
gmail_sent_today        INT NOT NULL DEFAULT 0
last_reset_date         DATE NOT NULL
updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
```

---

## notification_preferences

```sql
id                          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
user_id                     INT UNSIGNED NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
email_invite                TINYINT(1) NOT NULL DEFAULT 1
email_verification          TINYINT(1) NOT NULL DEFAULT 1
email_password_reset        TINYINT(1) NOT NULL DEFAULT 1
email_password_changed      TINYINT(1) NOT NULL DEFAULT 1
email_security_alert        TINYINT(1) NOT NULL DEFAULT 1
email_event_published       TINYINT(1) NOT NULL DEFAULT 1
email_rsvp_confirmation     TINYINT(1) NOT NULL DEFAULT 1
email_event_reminder        TINYINT(1) NOT NULL DEFAULT 1
email_account_deletion      TINYINT(1) NOT NULL DEFAULT 1
email_reengagement          TINYINT(1) NOT NULL DEFAULT 1
push_event_published        TINYINT(1) NOT NULL DEFAULT 1
push_event_reminder         TINYINT(1) NOT NULL DEFAULT 1
push_announcement           TINYINT(1) NOT NULL DEFAULT 1
updated_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
```

---

## feedback

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
user_id         INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
title           VARCHAR(200) NULL
category        ENUM('bug','feature_request','comment') NOT NULL
body            TEXT NOT NULL
status          ENUM('open','in_progress','resolved','shipped','closed','wont_fix')
                NOT NULL DEFAULT 'open'
admin_note      TEXT NULL
release_note    VARCHAR(500) NULL
is_private      TINYINT(1) NOT NULL DEFAULT 0
upvote_count    INT UNSIGNED NOT NULL DEFAULT 0
seen_at         DATETIME NULL
resolved_at     DATETIME NULL
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

INDEX idx_feedback_status (status)
INDEX idx_feedback_category (category)
INDEX idx_feedback_created (created_at)
```

---

## feedback_notes

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
feedback_id     INT UNSIGNED NOT NULL REFERENCES feedback(id) ON DELETE CASCADE
author_id       INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
content         TEXT NOT NULL
is_admin_only   TINYINT(1) NOT NULL DEFAULT 0
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

INDEX idx_fnote_feedback (feedback_id)
```

---

## feedback_upvotes

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
feedback_id     INT UNSIGNED NOT NULL REFERENCES feedback(id) ON DELETE CASCADE
member_id       INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

UNIQUE KEY uq_feedback_member (feedback_id, member_id)
```

---

## releases

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
version         VARCHAR(20) NOT NULL UNIQUE     -- semver e.g. "1.0.2"
title           VARCHAR(200) NOT NULL
body            TEXT NOT NULL                   -- rich HTML from Quill
published_at    DATETIME NULL                   -- NULL = draft
created_by      INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE RESTRICT
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

INDEX idx_release_published (published_at)
```

---

## release_feedback

Join table linking releases to the feedback tickets they ship.

```sql
release_id      INT UNSIGNED NOT NULL REFERENCES releases(id) ON DELETE CASCADE
feedback_id     INT UNSIGNED NOT NULL REFERENCES feedback(id) ON DELETE CASCADE

PRIMARY KEY (release_id, feedback_id)
```

---

## push_subscriptions

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
user_id         INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
endpoint        VARCHAR(1000) NOT NULL
p256dh_key      VARCHAR(500) NOT NULL
auth_key        VARCHAR(500) NOT NULL
user_agent      VARCHAR(500) NULL
is_active       TINYINT(1) NOT NULL DEFAULT 1
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
last_used_at    DATETIME NULL

UNIQUE KEY uq_endpoint (endpoint(255))
INDEX idx_user (user_id)
```

---

## notifications

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
user_id         INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
type            VARCHAR(100) NOT NULL
title           VARCHAR(255) NOT NULL
body            TEXT NULL
action_url      VARCHAR(500) NULL
is_read         TINYINT(1) NOT NULL DEFAULT 0
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
read_at         DATETIME NULL

INDEX idx_user_read (user_id, is_read)
INDEX idx_created (created_at)
```

---

## announcements

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
city_id         INT UNSIGNED NULL REFERENCES cities(id)  -- NULL = all cities
title           VARCHAR(255) NOT NULL
body            TEXT NOT NULL
status          ENUM('draft','published') NOT NULL DEFAULT 'draft'
published_at    DATETIME NULL
created_by      INT UNSIGNED NOT NULL REFERENCES users(id)
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
```

---

## announcement_comments

```sql
id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
announcement_id     INT UNSIGNED NOT NULL REFERENCES announcements(id) ON DELETE CASCADE
user_id             INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
body                TEXT NOT NULL
edited_at           DATETIME NULL                   -- Phase 36; NULL until first edit, drives "(edited)"
created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
deleted_at          DATETIME NULL                   -- soft delete

INDEX idx_announcement (announcement_id)
```

---

## content_flags

Legacy Phase 7 flagging (announcement comments only). Superseded by `content_reports` in Phase 10.6 for all other content types.

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
flagged_by      INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
content_type    ENUM('announcement_comment') NOT NULL
content_id      INT UNSIGNED NOT NULL
reason          TEXT NULL
status          ENUM('pending','reviewed','dismissed') NOT NULL DEFAULT 'pending'
reviewed_by     INT UNSIGNED NULL REFERENCES users(id)
reviewed_at     DATETIME NULL
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

INDEX idx_status (status)
```

---

## content_reports

Phase 10.6. Unified reporting across all content types. One report per member per content item.

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
reporter_id     INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
content_type    ENUM('event_comment','event_comment_reply',
                     'announcement_comment','location_rating') NOT NULL
content_id      INT UNSIGNED NOT NULL
reason          VARCHAR(500) NULL
status          ENUM('pending','reviewed','dismissed') NOT NULL DEFAULT 'pending'
reviewed_by     INT UNSIGNED NULL REFERENCES users(id) ON DELETE SET NULL
reviewed_at     DATETIME NULL
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

UNIQUE KEY uq_report_per_member (reporter_id, content_type, content_id)
INDEX idx_report_status (status)
```

---

## event_comments

Phase 10.

```sql
id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
event_id    INT UNSIGNED NOT NULL REFERENCES events(id) ON DELETE CASCADE
member_id   INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
body        TEXT NOT NULL
edited_at   DATETIME NULL                   -- Phase 36; NULL until first edit, drives "(edited)"
created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
deleted_at  DATETIME NULL                   -- soft delete; shows "removed" placeholder

INDEX idx_ec_event (event_id)
INDEX idx_ec_member (member_id)
```

---

## event_comment_replies

Phase 10. One level of nesting only.

```sql
id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
comment_id  INT UNSIGNED NOT NULL REFERENCES event_comments(id) ON DELETE CASCADE
member_id   INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
body        TEXT NOT NULL
edited_at   DATETIME NULL                   -- Phase 36; NULL until first edit, drives "(edited)"
created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
deleted_at  DATETIME NULL

INDEX idx_ecr_comment (comment_id)
INDEX idx_ecr_member (member_id)
```

---

## facebook_deletion_requests

Phase 10.5. Tracks Meta server-to-server deletion callbacks for compliance.

```sql
id                      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
facebook_user_id        VARCHAR(255) NOT NULL
confirmation_code       VARCHAR(100) NOT NULL UNIQUE
dinnerbears_user_id     INT UNSIGNED NULL           -- NULL if user not found
status                  ENUM('pending','completed') NOT NULL DEFAULT 'pending'
requested_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
completed_at            DATETIME NULL

INDEX idx_fb_deletion_user_id (facebook_user_id)
```

---

## achievements

Phase 15. Defines all available achievements. Managed via admin UI.

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
key             VARCHAR(64) NOT NULL UNIQUE     -- e.g. "founding_bear", "regular"
name            VARCHAR(120) NOT NULL
description     VARCHAR(500) NOT NULL
icon            VARCHAR(255) NOT NULL DEFAULT 'emoji_events'  -- Material icon name, or "img:<path>" referencing a custom_icons row (Phase 17)
image_path      VARCHAR(500) NULL               -- optional uploaded image (achievement-specific, distinct from the custom icon library)
progress_type   ENUM('attendance','coordinator','new_location_coordinator',
                     'invite','rating','founding','event','city_hopper',
                     'secret_dinner','login') NULL   -- NULL = one-time/manual grant; 'login' added Phase 17
progress_target INT UNSIGNED NULL               -- threshold for progressive achievements
event_id        INT UNSIGNED NULL               -- for event-specific one-time achievements
points          TINYINT NOT NULL DEFAULT 0      -- Bear Points awarded on unlock
title           VARCHAR(100) NULL               -- earnable title text; NULL = no title
is_secret       TINYINT(1) NOT NULL DEFAULT 0   -- hidden until earned; once earned, now shows normally (Phase 17 fix — previously stayed hidden forever)
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
```

**Phase 17 seed additions:** `login_25`/`login_50`/`login_100`/`login_250`/`login_500` (hidden, 10 pts each, `progress_type = 'login'`, target = the number in the key) and `patriotic_bear` (hidden, 10 pts, one-time, granted for logging in July 4–11, 2026 — America's Semiquincentennial).

---

## member_achievements

Phase 15. Records which achievements each member has earned.

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
member_id       INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
achievement_id  INT UNSIGNED NOT NULL REFERENCES achievements(id) ON DELETE CASCADE
earned_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
seen_at         DATETIME NULL                   -- Phase 17: NULL until the member has seen the achievement-earned splash screen; backfilled to earned_at for pre-existing rows

UNIQUE KEY uq_member_achievement (member_id, achievement_id)
INDEX idx_member (member_id)
```

---

## custom_icons

Phase 17 (table originally added just before this phase; documented here for the first time). Reusable icon library for achievements — an alternative to the built-in Material icon set or achievement-specific `image_path` uploads. Referenced from `achievements.icon` as `img:<image_path>`.

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
name            VARCHAR(100) NOT NULL
image_path      VARCHAR(500) NOT NULL
created_by      INT UNSIGNED NULL REFERENCES users(id) ON DELETE SET NULL
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
```

Usage count (how many achievements reference a given icon) is computed on read by matching `achievements.icon = CONCAT('img:', custom_icons.image_path)`, not stored. Icons in use can't be deleted, but can be reprocessed in place (same `image_path`, file overwritten) to strip white/checkerboard backgrounds after upload — see Admin > Custom Icons.

---

## member_points

Phase 15. Ledger of all Bear Points awarded. One row per award event for auditability and correction.

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
user_id         INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
point_type      ENUM('attendance','coordinator','invite','rating','city_hopper',
                     'secret_dinner','achievement','new_location_coordinator') NOT NULL
reference_id    INT UNSIGNED NOT NULL           -- event_id, location_id, achievement_id, etc. for audit
points          TINYINT NOT NULL DEFAULT 1
awarded_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

INDEX idx_user (user_id)
INDEX idx_type (point_type)
UNIQUE KEY uq_member_points_user_type_ref (user_id, point_type, reference_id)
```

Phase 27: `reference_id` made `NOT NULL` and the unique key added, closing a
duplication bug where one raw-SQL migration's `reference_id = NULL` backfill
let `AchievementsService.adminRecalculatePoints()`'s duplicate-row check
(keyed on `reference_id`) silently miss existing rows and insert a second
one. Every real award path already always supplied a real `reference_id`,
so this only formalizes what was already true everywhere except that one
migration (also cleaned up, see Phase 27).

---

## audit_log

Immutable. Never updated or deleted.

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
user_id         INT UNSIGNED NULL
action          VARCHAR(100) NOT NULL
entity_type     VARCHAR(100) NULL
entity_id       INT UNSIGNED NULL
metadata        JSON NULL
ip_address      VARCHAR(45) NULL
created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

INDEX idx_user (user_id)
INDEX idx_action (action)
INDEX idx_created (created_at)
```

---

## avatar

Phase 31. Per-instance preset profile avatars a member can pick from — replaces
the old static `public/avatars/manifest.json`. Admin-managed (upload/remove) via
the `avatars` module.

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
path            VARCHAR(500) NOT NULL UNIQUE
label           VARCHAR(100) NOT NULL
sort_order      INT NOT NULL DEFAULT 0
created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
```

`path` is either a static asset shipped in the image (`/avatars/bear-*.jpg`,
the 32 seeded DinnerBears bears) or an uploaded one
(`/api/uploads/avatars/<file>`). A fresh fork's bootstrap deletes the seeded
bears so it starts empty. Served public via `GET /api/v1/avatars/manifest`;
admin CRUD at `GET|POST /api/v1/admin/avatars`, `PATCH|DELETE
/api/v1/admin/avatars/:id`. `UsersService.setAvatar` validates a chosen path
against this table.

---

## api_tokens

Phase 39. Bearer tokens for automation accounts; only a `muse`-role account can
use one (`/api/v1/muse/*`, `MuseTokenGuard`). The plaintext (`cet_…`) is shown
once at issue and never stored.

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
user_id         INT UNSIGNED NOT NULL REFERENCES users(id) ON DELETE CASCADE
token_hash      CHAR(64) NOT NULL UNIQUE        -- SHA-256 of the token
token_prefix    VARCHAR(16) NOT NULL            -- first 12 chars, for display
expires_at      DATETIME NOT NULL               -- issue + 60 days
last_used_at    DATETIME NULL
revoked_at      DATETIME NULL                   -- set on revoke/rotate/reissue
created_by      INT UNSIGNED NULL               -- admin who issued it; NULL = self-rotated
created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
```

One live (unrevoked) token per account: issuing or rotating revokes the rest.

---

## event_facebook_links

Phase 39. Facebook events mirroring a dinner — one per group, so a Dayton
dinner can have both the Cincinnati group's and Gem City Bears'.

```sql
id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
event_id            INT UNSIGNED NOT NULL REFERENCES events(id) ON DELETE CASCADE
facebook_event_id   VARCHAR(32) NOT NULL UNIQUE   -- digits from facebook.com/events/<id>
facebook_group      VARCHAR(200) NULL             -- e.g. "Gem City Bears"
last_extracted_at   DATETIME NULL                 -- when Muse read the list last applied
last_synced_at      DATETIME NULL
last_going_count    INT UNSIGNED NULL             -- people accepted from the last list
created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
```

---

## facebook_accounts

Phase 39. A Facebook person seen on a synced Going list, keyed by numeric
Facebook ID with the vanity URL kept current. Linked to a member by an admin
(Admin → Security → Facebook Accounts); a member can have several.

```sql
id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
profile_url         VARCHAR(255) NULL UNIQUE      -- normalized "facebook.com/<vanity>"
facebook_user_id    VARCHAR(32) NULL UNIQUE       -- numeric profile ID (the key)
display_name        VARCHAR(200) NOT NULL         -- name as last seen on Facebook
status              ENUM('unmatched','linked','not_member') NOT NULL DEFAULT 'unmatched'
user_id             INT UNSIGNED NULL REFERENCES users(id) ON DELETE SET NULL
linked_at           DATETIME NULL
linked_by           INT UNSIGNED NULL
last_seen_at        DATETIME NULL
created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
```

Links survive a ban or admin delete (so a banned person is recognized on a
Going list); the hard-delete cron — a member's own deletion — unlinks them.

---

## facebook_event_attendees

Phase 39. One Facebook account's Going status for one dinner, merged across all
of the dinner's Facebook events. While the account isn't linked to a member,
this row *is* the attendee (a Facebook-only person in the headcount, event page
and attendance dialog); once linked, the member's own RSVP stands in for it.

```sql
id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
event_id            INT UNSIGNED NOT NULL REFERENCES events(id) ON DELETE CASCADE
facebook_account_id INT UNSIGNED NOT NULL REFERENCES facebook_accounts(id) ON DELETE CASCADE
sources             JSON NOT NULL
                    -- { "<facebook_event_id>": { "names": [...], "unnamed": n } } — one
                    -- entry per Facebook event currently listing them (older rows may hold
                    -- a bare number = unnamed +1s). Empty = no longer Going anywhere.
attended            TINYINT NULL DEFAULT NULL     -- carried to the member when linked
updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)

UNIQUE KEY UQ_fb_attendee_event_account (event_id, facebook_account_id)
```

+1s merge across sources as: each name as many times as the list repeating it
most, and the largest unnamed count — never summed.

---

## app_config

```sql
id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
config_key      VARCHAR(100) NOT NULL UNIQUE
config_value    TEXT NOT NULL
description     VARCHAR(500) NULL
updated_by      INT UNSIGNED NULL REFERENCES users(id)
updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
```

Seed rows:
- `event_standard_description`
- `invite_expiry_member_hours` = `48`
- `invite_expiry_campaign_days` = `30`
- `guest_rsvp_enabled` = `true`
- `inactivity_warning_1_days` = `60`
- `inactivity_warning_2_days` = `90`
- `inactivity_soft_delete_days` = `120`
- `inactivity_hard_delete_days` = `150`
- `max_additional_guests` = `9`
- `max_facebook_groups` = `3`
- `legal_terms_html` (Phase 30) — Terms of Service body copy, rendered on `/terms`
- `legal_privacy_html` (Phase 30) — Privacy Policy body copy, rendered on `/privacy`
- `about_story_html` (Phase 30) — Home page "Our Story" narrative + milestone timeline
- `location_privacy_default` (Phase 29) = `public` — privacy assigned to a newly
  created location when its create payload doesn't specify `isPrivate` explicitly
- `event_cadence_weekday` (Phase 29) = `2` — day of week (0=Sunday…6=Saturday) new
  events default to; only a fixed weekly cadence is supported, not a monthly
  ("2nd Saturday") pattern
- `event_cadence_time` (Phase 29) = `18:30` — time of day (24h `HH:mm`) new events
  default to
- `brand_name` (Phase 29) = `DinnerBears` — app name shown in nav/footer/page title
- `brand_tagline` (Phase 29) = `Good food. Great company. Bear memories.`
- `theme_color_primary` (Phase 29) = `#C9933A` — primary brand color (also drives
  Angular Material `--mat-sys-*` tokens at runtime)
- `theme_color_accent` (Phase 29) = `#C9933A`
- `theme_color_background` (Phase 29) = `#FDFAF5`
- `brand_logo_url` / `brand_splash_url` / `brand_icon_url` (Phase 29) — **not
  seeded** (empty default); set to an `/api/uploads/branding/<file>` path when an
  admin uploads a replacement image, else the frontend uses its compiled-in
  default asset
- `brand_story_url` (Phase 31) — home-page "Our Story" image; seeded to
  `/images/story-map.png` for DinnerBears, cleared by bootstrap for a fork
  (empty = the image is hidden)
- `home_hero_html` (Phase 31) — home-page hero rich-text block
- `home_howitworks_html` (Phase 31) — home-page "How it works" rich-text block
  (supports the `.steps/.step/.step-num` grid markup when set as raw HTML)
- `home_show_stats` (Phase 31) = `true` — toggles the home-page stats strip
- All Phase 31 home rows are seeded with DinnerBears' copy and cleared by
  bootstrap for a fresh fork; each home section hides when its value is empty
- `term_location_singular` / `term_location_plural` / `term_dinner_singular` /
  `term_dinner_plural` / `term_points` (Phase 32) — per-instance terminology
  (defaults `Location`/`Locations`/`Event`/`Events`/`Points`). Migration
  `1785000000004` seeds DinnerBears' historical words (`Restaurant(s)`,
  `Dinner(s)`, `Bear Points`); a fork's bootstrap **deletes** these rows so
  `getSiteSetting` falls back to the code defaults (delete, not blank — an empty
  value would leave the UI with no term)
- `feature_ratings` / `feature_leaderboard` / `feature_merch` /
  `feature_members` (Phase 33) = `true` — per-instance feature toggles, seeded
  on by migration `1785000000007` (an absent row also resolves to enabled, so
  that seed is just visibility/documentation, not a behavior change).
- `feature_ratings_residences` (Phase 33, defaulted off in Phase 37) = `false`
  — a sub-rule of `feature_ratings`: ratings can be on globally but suppressed
  specifically for Residence locations. Migration `1785000000012` sets it to
  `'false'` on existing instances and `FEATURE_DEFAULTS` resolves an absent row
  to off, so this is the one toggle where absent means **disabled**. That same
  migration deletes any `location_ratings` rows already recorded against
  residences (irreversible; `member_points` rows earned from them are
  deliberately left intact). Enforced server-side via a global `FeatureGuard` +
  `@RequireFeature('feature_x')` decorator (404 when off), surfaced as a
  `features` map on `/config/branding`. Editable via the "Features" card in
  `/admin/settings`.

The Phase 30 and Phase 29 rows above are editable via the admin UI
(`/admin/legal`, `/admin/settings`), unlike the rest of this table which has
no management UI yet. `AppConfigController` (`GET /api/v1/config/:key` and
`GET /api/v1/config/branding`, public) and `AppConfigAdminController`
(`GET /api/v1/admin/config/legal`, `GET /api/v1/admin/config/site-settings`,
`PATCH /api/v1/admin/config/:key`, plus branding-image upload/reset at
`POST|PATCH /api/v1/admin/config/branding/image/:slot`, admin-only) only serve
these keys — see `LEGAL_CONFIG_KEYS` / `SITE_SETTING_KEYS` in
`api/src/modules/app-config/app-config.service.ts`.

---

## Notes for Claude Code

- All FKs use `INT UNSIGNED`; all PKs are `AUTO_INCREMENT`
- Use `DATETIME` not `TIMESTAMP` (avoids 2038 problem, no timezone issues)
- Soft deletes use nullable `deleted_at` datetime, not a boolean
- JSON columns require MySQL 5.7.8+
- All migrations in `api/src/database/migrations/` with timestamp prefix
- Seed data in a separate seed migration
- `email_suppressions` hash: `SHA-256(SECRET_SUPPRESSION_SALT + email.toLowerCase())`
  — salt stored in `.env` as `EMAIL_SUPPRESSION_SALT`
- Guest RSVP links expire at event datetime, not a fixed duration
- `event_guest_links` and `event_guest_rsvps` are separate tables —
  a link may be generated but never used; they join only when
  `guest_rsvp_id` is populated on the link record
- Campaign invite lineage: `users.invite_source = 'facebook_group'`,
  `users.invite_source_name = facebook_group_config.name`
- Single-use member invites: check `bound_to_email` matches registering
  email before allowing redemption
- `non_validated` is a **role** not a status — API responses and guards
  check `user.role === 'non_validated'`, not `user.status`
- All date/time logic for event cutoffs and "today" filtering uses
  `Intl.DateTimeFormat` with `timeZone: 'America/New_York'` — never
  `new Date().toISOString()` which gives UTC
- RSVP cutoff = 150 minutes (2.5 hours) before event time; admins and
  moderators bypass this on both client and server
- Uploaded file path conventions (2026-07-05): `location_photos.file_path`
  uses `/api/uploads/locations/<filename>` (public, static — used in
  guest emails and social posts); `users.profile_photo_path` for an uploaded
  photo uses `/api/v1/uploads/profiles/<filename>` (auth-gated route, 401 if
  not signed in) — but for a preset avatar it's `/avatars/bear-*.jpg`
  (static frontend asset, always public, unrelated to `UPLOAD_PATH`)
- Brand images (Phase 29): admin-uploaded logo/splash/icon are stored under
  `<UPLOAD_PATH>/branding/` and served public+static at
  `/api/uploads/branding/<filename>`; the resulting path is saved to the
  `brand_logo_url`/`brand_splash_url`/`brand_icon_url` `app_config` rows

# Port to CommunityEvents

The running record of v1 (DinnerBears) work that still has to be rebuilt in
**CommunityEvents**, the v2 rewrite in a separate repo. CommunityEvents forked
from v1 at Phase 38 and has since diverged (Prisma, tenant-scoped data), so v1
code is never copied across — each phase below is re-implemented from its
section here. Rob carries this file over when v2 is ready for it.

`/phase-done` adds or refreshes one section per finished phase. The
**Database changes** section at the end is what the v2 DinnerBears import
(CommunityEvents `v2-25`, `docs/REQ-IMPORT-01.md`) needs: every table and
column added in v1 after its spec was written, and whether the import copies it.

> **This list is closed** (Rob, 2026-10-01). The goal is now to get DinnerBears
> onto CommunityEvents as soon as possible, and every phase finished here
> afterwards is another one to re-implement there — so **v1 takes no new
> phases** and nothing further will be added below. Bugfixes may still land in
> v1; they port cheaply, as the three 1.6.1 entries show. Phases do not.
>
> **Phase 40 (Ban Records) is therefore not here** — it was moved to
> CommunityEvents as `v2-30` before any v1 code was written, so there is nothing
> to port. See `PHASES.md`'s Phase 40 entry and
> [CommunityEvents `V2_PHASES.md`](https://github.com/rtippenhauer/CommunityEvents/blob/main/V2_PHASES.md#v2-30--ban-records).
> Its absence below is deliberate, not an oversight.
>
> The cutover plan that depends on this list is
> [`docs/CUTOVER_PLAN.md`](https://github.com/rtippenhauer/CommunityEvents/blob/main/docs/CUTOVER_PLAN.md)
> in that repo; porting Phase 39 is `v2-29` there.

| Phase | Title | v1 PR / tag | DB changes | Ported |
|---|---|---|---|---|
| 39 | Muse API + Facebook RSVP sync | PR #40 / `phase-39` | Yes | No |
| fix (1.6.1) | Upcoming events follow their location's name/address | PR #41 | No | No |
| fix (1.6.1) | Creating an event as Published sends the auto-invites | PR #42 | No | No |
| fix (1.6.1) | Release-note placeholders filled in on the login pop-up | PR #43 | No | No |

---

## Phase 39 — Muse API + Facebook RSVP sync

**v1 references:** tag `phase-39`, branch `phase-39-facebook-rsvp-sync`,
PR #40. API contract: `docs/MUSE_API.md` (copy it across as-is).

### What and why

Muse is an outside app that creates the community's Facebook events, reads
their Going lists and posts invite links there. Phase 39 gives it an API so the
Facebook mirror runs without anyone touching the website: Muse reads events,
links each dinner to its Facebook events (one per Facebook group — a Dayton
dinner is posted in two groups), manages invite links, and pushes the Going
lists. The server turns those lists into RSVPs, counts Facebook-only people,
and returns a merged headcount that Muse writes into each Facebook event's
description.

### Automation accounts and tokens

- A non-person account flag (`is_automation_account`). Only flagged accounts can
  hold the `automation` (Claude) or `muse` role, and they can be switched between
  those (and up to admin for testing) from the role picker. A normal member can
  never be given either role. Created on an admin page as `<name>-automation`
  with email `<slug>-automation@integration.invalid`.
- Hidden from the leaderboard, member directory, walk-in / member search and
  name suggestions. Mail to `.invalid` / `.internal` addresses is never sent.
- **Tokens:** `cet_` + 32 random bytes (base64url). Stored as SHA-256 only, shown
  once. 60-day expiry. One live token per account — issuing or rotating revokes
  the rest. Admin can issue a new one or revoke. Muse rotates its own
  (`POST /muse/token/rotate`); the old token dies the moment the new one is
  returned.
- **Guard:** the Muse routes accept *only* `Authorization: Bearer cet_…`, only
  for an active account currently holding the `muse` role, and only when the
  token is unrevoked and unexpired. A session cookie does not open them, and a
  token opens nothing else. Switching the account to `automation` disables its
  token until it's switched back. Muse routes have their own 120 req/min limit.

### The Muse API (keep this contract identical in v2)

All under `/api/v1/muse`. Full request/response bodies in `docs/MUSE_API.md`.

| Route | Does |
|---|---|
| `GET /me` · `POST /token/rotate` | Token status · rotation |
| `GET /users` | Active real members: `id`, `fullName`, `cityId`, `role` — no contact details |
| `GET /locations` | Read-only |
| `GET /events` · `GET /events/:id` | Read-only (drafts included); each event carries `facebookEvents` |
| `PUT` · `DELETE /events/:id/facebook-events/:facebookEventId` | Link (idempotent, `{group}`) · unlink a Facebook event |
| `GET /events/:id/invite-links` · `POST` · `PATCH …/:inviteId/revoke` | The Share dialog's links: active `member` / `nonValidated`, each with a `/join/<token>` URL |
| `GET /events/:id/attendees` | Member RSVPs (any status, with `guestNames`, `facebookGuests`, `source`), public guests, `facebookOnly`, `totalGoing` |
| `POST /facebook-sync` | The batch sync below |

Muse's writes are audited (`muse.invite_create`, `muse.invite_revoke`,
`facebook.sync`, `facebook.event_link`/`unlink`, `rsvp.facebook_sync` per RSVP
change, `integration.token_rotate`).

### The sync — rules

Request is Muse's own snake_case extraction: `events[]` of
`{dinnerbears_event_id, facebook_event_id, facebook_group?, going_count?,
guests[{name, profile_url, facebook_user_id, plus_one_names?, plus_ones?}]}`,
plus optional `extracted_at`. Unknown informational fields (`title`,
`facebook_event_url`, `note`) must be accepted and ignored.

1. **Apply every list first, then reconcile each dinner, then count** — so each
   Facebook event gets its dinner's final `totalGoing`.
2. A Facebook event is linked to its dinner on first sight; one Facebook event
   can mirror only one dinner (409 otherwise). A dinner can have any number.
3. Each Facebook event's Going list is stored separately per dinner and
   replaced by each sync. A person stops being Going only when **no** list of
   that dinner has them.
4. **Facebook accounts** are keyed by the numeric `facebook_user_id` (required);
   the vanity `profile_url` (required) is refreshed every sync. If another
   account holds that vanity, it's released to the new holder.
5. **Matching is never automatic.** An admin links accounts to members (several
   per member). Name matches are returned only as `suggestions`.
6. **Unlinked account → Facebook-only attendee:** counted (with +1s) once per
   dinner however many lists; shown on the event page and in the attendance
   dialog; attendance can be marked. "Not a member" status keeps them counted but
   out of the review queue.
7. **Linked member not Going on the site** → marked Going (source
   `facebook_sync`), with the usual confirmation email noting the sync. RSVP
   cutoff and membership-fee gates are skipped; past and draft dinners are refused.
8. **Removal:** a `facebook_sync` RSVP is deleted once the member is on none of
   the dinner's lists. RSVPs made on the website (`member`, `admin`) are never
   removed — they only lose their Facebook +1s.
9. **+1s:** a guest's +1s are `plus_one_names` plus
   `max(0, plus_ones − names)` unnamed. Repeated names are separate people.
   Across one person's lists/accounts they merge as: each name as many times as
   the list repeating it most, and the largest unnamed count — never summed.
10. **A linked member's Facebook +1s are kept beside their website guests**,
    never merged: stored separately and replaced every sync (they can go down).
    Website guests are never changed. A Facebook +1 is skipped only when a named
    website guest has the same name (case-insensitive); each website guest covers
    one Facebook +1 of that name. Unnamed website guests never absorb anyone.
11. **Headcount** (`totalGoing`) = per Going RSVP `1 + website guests + Facebook
    +1s`, + public guest signups, + Facebook-only attendees and their +1s.
12. **Safety:** `going_count` ≠ number of guests → partial list, nobody removed for
    that Facebook event (warning). An `extracted_at` older than the last applied
    list → `skipped`. One failing Facebook event doesn't stop the batch.
13. **Bans:** a banned or deleted member keeps their Facebook link; if they're
    Going on Facebook they're reported in `warnings` and never added or counted.
    A member's own account deletion (the hard-delete step) unlinks them.
14. **Linking carries over:** upcoming dinners the account is Going to become
    Going RSVPs right away (same rules as a sync); dinners where the Facebook-only
    person was marked Attended become attended RSVPs with points and achievements
    through the normal attendance path.

Also in this phase: **admin "Add to Going"** (attendance dialog, admin-only,
source `admin`, email notes an organizer added them, skips cutoff/membership).

The e2e cases that pin all of this are in
`api/test/integrations.e2e-spec.ts` (35 tests) — port them.

### UI

- Admin → Settings → **Automation Accounts** (create Muse/Claude accounts, issue
  / revoke tokens, token shown once).
- Admin → Security → **Facebook Accounts** (Unmatched / Linked / Not a member;
  one-click suggestion links; member search; Banned/Deleted tags).
- Event page: Facebook-only attendees with a Facebook badge and their +1 names;
  a linked member's Facebook +1s on their own line with the badge. Seat counts
  include both.
- Attendance dialog: Facebook rows with Attended / No-show; **Add to Going**
  (admin); source badges.
- Member profile role picker: Claude Automation / Muse Automation on automation
  accounts only.

### v2 notes

Checked read-only against CommunityEvents' `V2_PHASES.md` and `CLAUDE.md`
(2026-09-29):

- **Tenancy.** v2 scopes data with `tenant_id` via the Prisma extension, with
  every model classified in `tenant-scoped-models.ts`. All four new tables are
  tenant-scoped; add them there. Uniques become per-tenant:
  `event_facebook_links(tenant_id, facebook_event_id)` and
  `facebook_accounts(tenant_id, facebook_user_id)` / `(tenant_id, profile_url)` —
  two communities can share a Facebook event or person.
- **Tokens identify the tenant.** Resolve the tenant from the token's row (add
  `tenant_id` to `api_tokens`), not from the `Host` header — an integration call
  carries no session. Muse then only changes its base URL (the community's host)
  and token.
- **Automation accounts vs `users.is_service_account`.** v2 already has a
  non-human flag, with exactly **one** service account per tenant, and a
  `disabled` role. Muse is a *second* non-human account per tenant, so either
  relax "exactly one" or model integration accounts separately. Service
  accounts in v2 are protected from ban/delete/hard-delete and the inactivity
  sweep — Muse accounts need the same protection.
- **Facebook groups.** v2 dropped `facebook_group_config` (v2-24). That doesn't
  conflict: here the group is free text on each link (`facebook_group`), not a
  foreign key.
- **Email.** Per-community sending (v2-9) applies to the sync's confirmation
  email.
- **Cities toggle (v2-24).** Nothing in the sync gates on city.

---

## Fix (1.6.1) — upcoming events follow their location

**v1 references:** PR #41, branch `bugfix-event-location-snapshot`, test
`api/test/event-location-snapshot.e2e-spec.ts`. No database changes.

An event keeps its own copy of its location's name, address and coordinates
(so a past dinner still shows where it actually was). Before this fix nothing
ever refreshed that copy, so correcting a location — here a name garbled on
import, "Izzyâs" — left the old text on every dinner already scheduled there,
and the only workaround (switching the event to another location and back)
emails every RSVP a "details changed" notice.

Rules:
- Editing a location, **or enrichment renaming / re-addressing it**, updates
  the copy on that location's **upcoming** events (event date ≥ today, Eastern)
  that aren't cancelled. Past and cancelled events keep theirs.
- Saving an upcoming event re-copies its current location's details even when
  the location didn't change. Past events are left alone.
- Neither sends any email — "details changed" notices still go out only when an
  event moves to a different location or its date/time changes.

**v2 notes:** same rules; the update is naturally tenant-scoped (events and
locations are both tenant models). Check v2's enrichment path writes through the
same helper.

---

## Fix (1.6.1) — creating an event as Published sends the auto-invites

**v1 references:** PR #42, test
`api/test/publish-invites.e2e-spec.ts`. No database changes.

Members who turn on auto-invites (Manage Calendar → all cities, or their own
city) get an email with a calendar invite when an event is published. That only
happened when a **draft was published by editing it**; the event form also lets
an event be created straight as Published, and that path sent no invites and
didn't refresh the subscribed calendar feeds. Now both paths do the same thing.

Rules (unchanged, now on both paths): invite members with auto-invite `all`,
or `city` when the event is in their city, who have an email address, whose
email isn't bounced/complained, and who haven't already RSVP'd. Creating a
draft sends nothing.

**v2 notes:** check v2's event create path does the same — it inherited the
same code at the fork.

---

## Fix (1.6.1) — release-note placeholders on the login pop-up

**v1 references:** PR #43, helper
`frontend/src/app/shared/utils/substitute-terms.ts` (+ spec). No database changes.

Shared release notes are written with `{{points}}`, `{{locations}}` and
`{{events}}` so one note reads right on every instance. Only the Updates page
swapped them for the instance's words; the login pop-up (splash) that shows a
new release to members printed them raw. Titles weren't swapped anywhere. Now
one helper does it for the title and body in both places.

Rules: `{{points}}` → the points name as configured; `{{locations}}` and
`{{events}}` → the **plural, lower-case** words (e.g. "restaurants",
"dinners"), case-insensitive, spaces inside the braces allowed. There are no
singular tokens, so notes must be worded so a plural fits.

**v2 notes:** anywhere v2 shows a release note (Updates, splash, any email or
push of it) must go through the same substitution, using the tenant's terms.

---

## Database changes

Migrations are in `api/src/database/migrations/`.

### Phase 39

**`1785000000013-AddMuseAndFacebookSync`**

| Change | Import into v2? |
|---|---|
| `users.role` enum gains `muse` | **Yes** — map `automation` / `muse` onto v2's non-human model (see v2 notes) |
| `users.is_automation_account` TINYINT (backfilled for `automation@dinnerbears.internal`) | **Yes**, as the v2 service/integration-account marker |
| **new** `api_tokens` (id, user_id, token_hash, token_prefix, expires_at, last_used_at, revoked_at, created_by, created_at) | **No** — reissue tokens in v2 (they'd need a tenant anyway) |
| `event_rsvps.source` ENUM('member','admin','facebook_sync') | **Yes** — the sync only removes `facebook_sync` RSVPs; losing it makes every imported RSVP look website-made |

**`1785000000014-AddFacebookAttendees`**

| Change | Import into v2? |
|---|---|
| **new** `event_facebook_links` (event_id, facebook_event_id, facebook_group, last_extracted_at, last_synced_at, last_going_count) | **Yes** — remap `event_id`; this is how Muse finds each dinner's Facebook events |
| **new** `facebook_accounts` (profile_url, facebook_user_id, display_name, status, user_id, linked_at, linked_by, last_seen_at) | **Yes** — the admin's manual Facebook↔member links; remap `user_id`, `linked_by` |
| **new** `facebook_event_attendees` (event_id, facebook_account_id, sources JSON, attended) | **Yes** — Facebook-only attendance history; remap both FKs. `sources` keys are Facebook event IDs (not remapped) |
| deletes `app_config` row `facebook_sync_host_user_id` | No (obsolete) |
| one-time cleanup of the first build's host +1s | No (stage-only data fix) |

**`1785000000015-AddFacebookGuestsToRsvps`**

| Change | Import into v2? |
|---|---|
| `event_rsvps.facebook_guest_names` JSON | **Yes** |
| `event_rsvps.facebook_guest_count` TINYINT UNSIGNED | **Yes** — part of every headcount |

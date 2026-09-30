# Muse API reference

Everything the Muse Facebook-event sync can call on DinnerBears. Added in
Phase 39.

What Muse can do:

| Data | Access |
|---|---|
| Events, locations, members | Read only |
| Facebook events linked to a dinner | Read, link, unlink |
| Going lists and RSVPs | Push Facebook Going lists; the server works out the RSVP changes |
| Invite links | List, create, revoke |

DinnerBears is the source of truth for which Facebook events mirror which
dinner. One dinner can have several Facebook events, for example one in the
Cincinnati group and one in Gem City Bears.

| | |
|---|---|
| Stage | `https://stage.dinnerbears.com/api/v1/muse` |
| Production | `https://www.dinnerbears.com/api/v1/muse` |
| Auth | `Authorization: Bearer cet_…` on **every** request |
| Format | JSON request and response bodies (`Content-Type: application/json`) |
| Rate limit | 120 requests per minute |

Stage and production are separate sites with separate event IDs, members and
tokens. Keep a separate setup for each.

Only the `/api/v1/muse/...` routes accept the token. It does not work on the
website's own endpoints (such as `/api/v1/events`), and it is never accepted
as a query parameter or a cookie.

## Errors

Errors come back as JSON with an HTTP status:

```json
{ "statusCode": 400, "message": "…" }
```

`message` can also be an array of validation messages.

| Status | Meaning |
|---|---|
| `400` | The request body failed validation. |
| `401` | The token is missing, wrong, revoked or expired, or the account isn't a Muse account. |
| `404` | The event or invite link wasn't found. |
| `409` | That Facebook event is already linked to a different dinner. |
| `429` | Rate limited. Back off and retry. |

---

## Token

The token is created by an admin at **Admin → Settings → Automation Accounts**.
It's shown once and lasts **60 days**. Muse rotates it itself.

### `GET /me`

Response `200`:

```json
{ "userId": 42, "name": "Muse-automation", "tokenExpiresAt": "2026-11-26T05:00:00.000Z" }
```

### `POST /token/rotate`

No body. The **old token stops working the moment this returns**, so store the
new one before making any other call.

Response `200`:

```json
{ "token": "cet_…", "tokenPrefix": "cet_AbCdEfGh", "expiresAt": "2026-11-26T05:00:00.000Z" }
```

At the start of each run, call `GET /me` and rotate if `tokenExpiresAt` is less
than 14 days away. If the token does expire, an admin has to issue a new one.

---

## Members (read only)

### `GET /users`

Every active member, with names and IDs only (no contact details). Muse doesn't
need this for matching, since the server does all matching. It's here for
display.

Response `200`:

```json
[
  { "id": 1, "fullName": "Rob Tippenhauer", "cityId": 1, "role": "admin" },
  { "id": 5, "fullName": "Jane Doe", "cityId": 1, "role": "member" }
]
```

---

## Cities and locations (read only)

### `GET /api/v1/cities` (public, no token needed)

Response `200`:

```json
[{ "id": 1, "name": "Cincinnati", "subdomain": "cincinnati", "isActive": true }]
```

### `GET /locations?cityId=1&search=pho`

Both query parameters are optional. `search` matches on the name. For a private
location (someone's home), `address`, `lat`, `lng` and `photos` come back
empty.

Response `200`:

```json
[
  {
    "id": 42,
    "name": "Pho Lang Thang",
    "address": "1828 Vine St, Cincinnati, OH 45202",
    "cityId": 1,
    "isPrivate": false,
    "isResidence": false,
    "…": "…"
  }
]
```

---

## Events (read only)

Events are created and edited on the website. Every event Muse reads includes
its linked Facebook events.

### Event object

These are the fields Muse will use. Responses include more fields than this;
ignore any you don't need.

```json
{
  "id": 21,
  "cityId": 2,
  "locationId": 42,
  "locationName": "Shen's Szechuan & Sushi",
  "title": "Wednesday Night Bears",
  "eventDate": "2026-10-07",
  "eventTime": "18:30:00",
  "status": "published",
  "goingCount": 7,
  "facebookEvents": [
    {
      "facebookEventId": "1617936020344888",
      "group": "Cincinnati Tuesday Night Bear Dinners",
      "url": "https://www.facebook.com/events/1617936020344888/",
      "lastSyncedAt": "2026-09-27T14:13:00.000Z",
      "lastGoingCount": 3
    },
    {
      "facebookEventId": "1072447435694919",
      "group": "Gem City Bears",
      "url": "https://www.facebook.com/events/1072447435694919/",
      "lastSyncedAt": null,
      "lastGoingCount": null
    }
  ]
}
```

- `status` is `draft`, `published` or `cancelled`. All dates and times are
  Eastern.
- `goingCount` (on the list endpoint) is members Going plus their +1s, plus
  Facebook-only attendees plus their +1s. The sync's `totalGoing` also adds
  public guest signups, so use `totalGoing` for the Facebook description.
- An empty `facebookEvents` means Muse hasn't created the Facebook event yet.

### `GET /events?cityId=1&fromDate=2026-10-01`

Upcoming events, including drafts. Both query parameters are optional.
`fromDate` (`YYYY-MM-DD`) replaces the default "upcoming" filter.

Response `200`: an array of event objects.

### `GET /events/:id`

Response `200`: the event object, plus `location`, `city`, `rsvps`,
`publicRsvps` and `facebookAttendees`.

---

## Facebook events linked to a dinner

`facebookEventId` is the digits from `facebook.com/events/<id>`. A Facebook
event can be linked to only one dinner. The sync also links automatically, so
these calls are only needed when Muse creates a Facebook event and wants the
link recorded before its first sync.

### `PUT /events/:id/facebook-events/:facebookEventId`

Links the Facebook event, or updates its group. Safe to repeat.

Request:

```json
{ "group": "Gem City Bears" }
```

Response `200`:

```json
{ "facebookEventId": "1072447435694919", "group": "Gem City Bears", "url": "https://www.facebook.com/events/1072447435694919/", "lastSyncedAt": null, "lastGoingCount": null }
```

Returns `409` if the Facebook event is already linked to a different dinner,
and `400` if the ID isn't all digits.

### `DELETE /events/:id/facebook-events/:facebookEventId`

Unlinks the Facebook event and drops its Going list from the dinner. Anyone who
was only on that list stops counting. No body.

Response `200`:

```json
{ "success": true }
```

---

## Invite links

These are the same links as the event page's Share dialog:

- **`member`**: full membership.
- **`non_validated`**: requires validation by a moderator.

Links expire at the RSVP cutoff, 2.5 hours before the event starts.

### Invite link object

```json
{
  "id": 7,
  "flavor": "member",
  "token": "3f9c…",
  "url": "https://stage.dinnerbears.com/join/3f9c…",
  "expiresAt": "2026-10-06T20:00:00.000Z",
  "isRevoked": false,
  "createdAt": "2026-09-27T05:00:00.000Z"
}
```

### `GET /events/:id/invite-links`

The active link for each flavor (the newest one that isn't revoked), plus every
link made for the event. `member` or `nonValidated` is `null` when that flavor
has no active link.

Response `200`:

```json
{
  "member":       { "id": 7, "flavor": "member", "url": "https://…/join/…", "…": "…" },
  "nonValidated": { "id": 8, "flavor": "non_validated", "url": "https://…/join/…", "…": "…" },
  "all": [ { "…": "…" } ]
}
```

### `POST /events/:id/invite-links`

Request:

```json
{ "flavor": "member" }
```

`flavor` is `member` or `non_validated`. It defaults to `non_validated`.

Response `201`: the new invite link object.

### `PATCH /events/:id/invite-links/:inviteId/revoke`

No body. Returns `404` if that link doesn't belong to this event.

Response `200`:

```json
{ "success": true }
```

---

## Attendees

### `GET /events/:id/attendees`

Everyone signed up for the dinner, from every source.

Response `200`:

```json
{
  "eventId": 21,
  "members": [
    {
      "userId": 5,
      "fullName": "Jane Doe",
      "status": "going",
      "additionalGuests": 1,
      "guestNames": [],
      "facebookGuests": ["Carol Smith", null],
      "source": "facebook_sync",
      "attended": null,
      "isWalkin": false,
      "updatedAt": "2026-09-27T05:00:00.000Z"
    }
  ],
  "publicGuests": [
    { "guestLinkId": 3, "name": "Pat Smith", "attended": null, "createdAt": "2026-09-27T05:00:00.000Z" }
  ],
  "facebookOnly": [
    { "facebookAccountId": 12, "name": "Don Weaver", "plusOnes": 1, "plusOneNames": ["Pat Lee"], "attended": null }
  ],
  "totalGoing": 4
}
```

- `status` is `going`, `maybe` or `not_going`.
- `source` shows who created a member's RSVP: `member` (the member themselves),
  `admin` (an admin's "Add to Going"), or `facebook_sync`.
- `guestNames` are the guests the member added on the website.
  `facebookGuests` are their +1s from the Facebook comments, kept separately
  (`null` means an unnamed +1).
- `facebookOnly` lists people Going on Facebook whose Facebook account isn't
  linked to a member yet. `plusOnes` counts all their +1s; `plusOneNames` are
  the named ones.
- `totalGoing` is the merged headcount (defined under the sync below).

---

## Facebook sync

### `POST /facebook-sync`

Send the Going lists for one or more Facebook events in a single call. This is
Muse's extraction format as-is. The server:

1. applies every list first,
2. then reconciles each affected dinner against all of its lists together,
3. then works out the counts.

So every Facebook event gets back its dinner's **final** merged headcount.

Request:

| Field | Type | Required | Notes |
|---|---|---|---|
| `events` | array | yes | Up to 100 Facebook events. |
| `events[].dinnerbears_event_id` | number | yes | The dinner this Facebook event mirrors. |
| `events[].facebook_event_id` | string | yes | Digits from the Facebook event URL. Linked automatically on first sight. |
| `events[].facebook_group` | string | no | The Facebook group, e.g. `Gem City Bears`. |
| `events[].going_count` | number | no | Facebook's own Going count. If it doesn't match `guests`, the list is treated as partial and nobody is removed for that event. |
| `events[].guests` | array | yes | Everyone on the Going tab, up to 500. Leave out "Interested". `[]` means nobody is Going. |
| `events[].guests[].name` | string | yes | Name as shown on Facebook. |
| `events[].guests[].profile_url` | string | yes | The person's **current** vanity URL. |
| `events[].guests[].facebook_user_id` | string | yes | The numeric Facebook profile ID. This is the permanent key; a changed vanity URL just updates. |
| `events[].guests[].plus_one_names` | string[] | no | Names of the +1s from the Facebook comments, up to 20. The same name may repeat — two `"Guest"` entries are two people. |
| `events[].guests[].plus_ones` | number | no | 0–20. Total +1s. Send it on its own for comments like "+2" with no names (no placeholder names needed); anything beyond `plus_one_names` counts as unnamed. |
| `events[].facebook_event_url`, `events[].title` | string | no | Informational; ignored. |
| `extracted_at` | ISO date | no | When the lists were read. A Facebook event whose last applied list is newer is skipped. |
| `note` | string | no | Informational; ignored. |

```json
{
  "events": [
    {
      "dinnerbears_event_id": 21,
      "facebook_event_id": "1617936020344888",
      "facebook_group": "Cincinnati Tuesday Night Bear Dinners",
      "going_count": 3,
      "guests": [
        { "name": "Rob Tippenhauer", "profile_url": "https://www.facebook.com/rob.tippenhauer", "facebook_user_id": "100000000000001" },
        { "name": "Don Weaver", "profile_url": "https://www.facebook.com/don.weaver.718", "facebook_user_id": "100000000000002", "plus_one_names": ["Pat Lee"], "plus_ones": 2 }
      ]
    },
    {
      "dinnerbears_event_id": 21,
      "facebook_event_id": "1072447435694919",
      "facebook_group": "Gem City Bears",
      "going_count": 1,
      "guests": [
        { "name": "Steve Brack", "profile_url": "https://www.facebook.com/SSBohio", "facebook_user_id": "100000000000003" }
      ]
    }
  ],
  "extracted_at": "2026-09-27T10:13:00-04:00"
}
```

**How people are counted.** Every Facebook person is saved as a Facebook account,
keyed by `facebook_user_id`. An admin links accounts to members on the website
(**Admin → Security → Facebook Accounts**); one member can have several. The
server never links anyone by name on its own, though it suggests likely matches.

| Situation | Result |
|---|---|
| Account linked to a member who isn't Going on the website | Marked Going. They get the usual confirmation email, noting the Facebook sync added them. |
| Linked member's +1s | Their Facebook +1s are kept **beside** the guests they added on the website, never merged into them. A Facebook +1 is only skipped if it has the same name as one of their named website guests. Facebook +1s follow the comments on every sync, up or down; website guests are never changed. |
| Linked member with two Facebook accounts, or on both groups' lists | Counted once. |
| Linked member no longer on **any** of the dinner's Facebook lists | Removed, but only if the sync made their RSVP. A website RSVP stays and just loses its Facebook +1s. |
| RSVP made on the website (by the member or an admin) | **Never removed** by the sync. |
| Account not linked to a member | A **Facebook-only attendee**: counted, with their +1s, and shown on the event page (with their +1 names, like a member's) and in the attendance dialog. Counted once however many lists they're on. |
| Account linked to a banned or deleted member | Not added and not counted; listed in `warnings`. |

Each Facebook event's list is tracked separately. Someone who drops off the
Cincinnati list but is still on the Gem City Bears list is still Going.

**Headcount (`totalGoing`)** is members Going plus their website guests and
Facebook +1s, plus Facebook-only attendees plus their +1s, plus public guest
signups. Write it into that
Facebook event's description.

Response `200`:

```json
{
  "extractedAt": "2026-09-27T10:13:00-04:00",
  "events": [
    { "facebookEventId": "1617936020344888", "dinnerbearsEventId": 21, "group": "Cincinnati Tuesday Night Bear Dinners", "status": "ok", "accepted": 2, "complete": false, "totalGoing": 5 },
    { "facebookEventId": "1072447435694919", "dinnerbearsEventId": 21, "group": "Gem City Bears", "status": "ok", "accepted": 1, "complete": true, "totalGoing": 5 }
  ],
  "added":   [{ "eventId": 21, "userId": 5, "name": "Jane Doe", "facebookGuests": ["Carol Smith"] }],
  "guestsChanged": [{ "eventId": 21, "userId": 8, "name": "Bob Brown", "facebookGuests": ["Dan Jones", null], "from": ["Dan Jones"] }],
  "removed": [{ "eventId": 21, "userId": 11, "name": "Carl Carter" }],
  "unmatched": [
    {
      "facebookAccountId": 12,
      "name": "Don Weaver",
      "profileUrl": "https://www.facebook.com/don.weaver.718",
      "suggestions": [{ "id": 31, "fullName": "Don Weaver" }]
    }
  ],
  "warnings": ["Facebook event 1617936020344888: going_count didn't match the guests sent — nobody was removed from it"]
}
```

- `events[].status` is `ok`, `skipped` (an older list than the one already
  applied) or `error`. On `error`, `error` says why, for example "already
  linked to event 27", or the dinner is a draft or already past. One failed
  Facebook event doesn't stop the others.
- `guestsChanged` lists members whose Facebook +1s changed (`null` = an
  unnamed +1).
- `unmatched` lists Facebook people not yet linked to a member (and not marked
  "not a member"). `suggestions` holds members with the same name, for Rob to
  confirm on the Facebook Accounts page.

---

## Suggested run

1. `GET /me`. Rotate the token if it expires within 14 days.
2. `GET /events` for upcoming dinners and their `facebookEvents`.
3. For each dinner with no Facebook event, create one on Facebook: the
   Cincinnati group always, plus Gem City Bears for Dayton dinners. Record each
   one with `PUT /events/:id/facebook-events/:facebookEventId`.
4. For each dinner, `GET /events/:id/invite-links`. Create any missing flavor
   with `POST /events/:id/invite-links`, and post the URLs to Facebook.
5. Read every linked Facebook event's Going list, then send them all in one
   `POST /facebook-sync`.
6. Write each Facebook event's `totalGoing` into its description, for example
   "Currently we have 5 going (as of 10:13 AM)".
7. Log the report, especially `unmatched` and `warnings`.

## Audit

Every write shows up in the website's audit log (**Admin → Security → Audit
Log**) under the Muse account:

- `facebook.sync` (one per run), `rsvp.facebook_sync` (one per RSVP changed)
- `facebook.event_link`, `facebook.event_unlink`
- `muse.invite_create`, `muse.invite_revoke`
- `integration.token_rotate`

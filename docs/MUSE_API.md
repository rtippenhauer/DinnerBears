# Muse API reference

Everything the Muse Facebook-event sync can call on DinnerBears. Added in
Phase 39.

What Muse can do:

| Data | Access |
|---|---|
| Events, locations, members | Read only |
| RSVPs | Created, updated and removed through the Facebook sync |
| Invite links | List, create, revoke |

Muse keeps its own mapping from Facebook events to DinnerBears event IDs.
DinnerBears doesn't store Facebook IDs.

| | |
|---|---|
| Stage | `https://stage.dinnerbears.com/api/v1/muse` |
| Production | `https://www.dinnerbears.com/api/v1/muse` |
| Auth | `Authorization: Bearer cet_…` on **every** request |
| Format | JSON request and response bodies (`Content-Type: application/json`) |
| Rate limit | 120 requests per minute |

Only the `/api/v1/muse/...` routes accept the token. It does not work on the
website's own endpoints (such as `/api/v1/events`), and it is never accepted
as a query parameter or a cookie.

## Errors

Errors come back as JSON with an HTTP status:

```json
{ "statusCode": 400, "message": "Can only RSVP to published events" }
```

`message` can also be an array of validation messages.

| Status | Meaning |
|---|---|
| `400` | The request body failed validation, or the action isn't allowed (for example, syncing a past or draft event). |
| `401` | The token is missing, wrong, revoked or expired, or the account isn't a Muse account. |
| `404` | The event or invite link wasn't found. |
| `429` | Rate limited. Back off and retry. |

---

## Token

The token is created by an admin at **Admin → Settings → Automation Accounts**.
It's shown once and lasts **60 days**. Muse should rotate it before it expires.
If it does expire, only an admin can issue a new one.

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

Suggested rule: at the start of each run, call `GET /me`, and rotate if
`tokenExpiresAt` is less than 14 days away.

---

## Members

### `GET /users`

Every active member. Match Facebook names against this list. It returns names
and IDs only, with no contact details.

Response `200`:

```json
[
  { "id": 1, "fullName": "Rob Tippenhauer", "cityId": 1, "role": "admin" },
  { "id": 5, "fullName": "Jane Doe", "cityId": 1, "role": "member" }
]
```

`role` is one of `member`, `non_validated`, `moderator`, `admin`.

---

## Cities and locations (read only)

### `GET /api/v1/cities` (public, no token needed)

Response `200`:

```json
[{ "id": 1, "name": "Cincinnati", "subdomain": "cincinnati", "isActive": true }]
```

### `GET /locations?cityId=1&search=pho`

Both query parameters are optional. `search` matches on the name.

Response `200`: an array of locations.

```json
[
  {
    "id": 42,
    "name": "Pho Lang Thang",
    "address": "1828 Vine St, Cincinnati, OH 45202",
    "lat": "39.1162000",
    "lng": "-84.5155000",
    "phone": "(513) 555-0100",
    "websiteUrl": "https://example.com",
    "description": null,
    "cityId": 1,
    "isActive": true,
    "isPrivate": false,
    "isResidence": false,
    "photos": [],
    "createdAt": "2026-01-10T18:00:00.000Z",
    "updatedAt": "2026-01-10T18:00:00.000Z"
  }
]
```

For a private location (someone's home), `address`, `lat`, `lng` and `photos`
come back empty.

---

## Events (read only)

Events are created and edited on the website. Muse reads them to find the
DinnerBears event ID for each Facebook event.

### Event object

These are the fields Muse will use. Responses include more fields than this;
ignore any you don't need.

```json
{
  "id": 12,
  "cityId": 1,
  "locationId": 42,
  "locationName": "Pho Lang Thang",
  "locationAddress": "1828 Vine St, Cincinnati, OH 45202",
  "title": "Tuesday Dinner",
  "description": null,
  "additionalInfo": null,
  "eventDate": "2026-10-06",
  "eventTime": "18:30:00",
  "status": "published",
  "isSecret": false,
  "facebookShareText": null,
  "publishedAt": "2026-09-27T05:00:00.000Z",
  "cancelledAt": null,
  "createdAt": "2026-09-27T05:00:00.000Z",
  "updatedAt": "2026-09-27T05:00:00.000Z"
}
```

- `status` is `draft`, `published` or `cancelled`.
- All dates and times are Eastern.

### `GET /events?cityId=1&fromDate=2026-10-01`

Upcoming events, including drafts. Both query parameters are optional.
`fromDate` (`YYYY-MM-DD`) replaces the default "upcoming" filter.

Response `200`: an array of event objects. Each one also has `goingCount`,
`totalAttending` (Going members plus their +1s) and `location`.

### `GET /events/:id`

Response `200`: the event object, plus `location`, `city`, `rsvps` and
`publicRsvps`. For RSVPs, `GET /events/:id/attendees` below is easier to work
with.

---

## Invite links

These are the same links as the event page's **Share** dialog:

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
link ever made for the event.

Response `200`:

```json
{
  "member":       { "id": 7, "flavor": "member", "url": "https://…/join/…", "…": "…" },
  "nonValidated": { "id": 8, "flavor": "non_validated", "url": "https://…/join/…", "…": "…" },
  "all": [ { "…": "…" } ]
}
```

`member` or `nonValidated` is `null` when that flavor has no active link. Create
one with the call below.

### `POST /events/:id/invite-links`

Request:

```json
{ "flavor": "member" }
```

`flavor` is `member` or `non_validated`. It defaults to `non_validated`.

Response `201`: the new invite link object.

### `PATCH /events/:id/invite-links/:inviteId/revoke`

No body.

Response `200`:

```json
{ "success": true }
```

Returns `404` if that link doesn't belong to this event.

---

## Attendees

### `GET /events/:id/attendees`

Every member RSVP, in any status, plus people who signed up with the public
guest form.

Response `200`:

```json
{
  "eventId": 12,
  "members": [
    {
      "userId": 5,
      "fullName": "Jane Doe",
      "status": "going",
      "additionalGuests": 1,
      "guestNames": [],
      "source": "facebook_sync",
      "attended": null,
      "isWalkin": false,
      "updatedAt": "2026-09-27T05:00:00.000Z"
    }
  ],
  "publicGuests": [
    { "guestLinkId": 3, "name": "Pat Smith", "attended": null, "createdAt": "2026-09-27T05:00:00.000Z" }
  ]
}
```

- `status` is `going`, `maybe` or `not_going`.
- `source` shows who created the RSVP: `member` (the member themselves),
  `admin` (an admin's "Add to Going"), or `facebook_sync`.
- `attended` is `null` until attendance is marked.

---

## Facebook RSVP sync

### `POST /events/:id/facebook-sync`

Send the **whole** current Going list from Facebook every time. Leave out anyone
marked "Interested". The server applies all the rules below, so sending the same
list twice changes nothing the second time.

Request:

| Field | Type | Required | Notes |
|---|---|---|---|
| `attendees` | array | yes | Up to 500 entries. `[]` means nobody is Going on Facebook. |
| `attendees[].name` | string | yes | Name as shown on Facebook. Matched against members' full names, ignoring case, accents and extra spaces. |
| `attendees[].plusOnes` | number | no | 0–20. The +1s read from the Facebook comments. |
| `attendees[].userId` | number | no | Use this member directly, without name matching. For when a Facebook name doesn't match the website name. |

```json
{
  "attendees": [
    { "name": "Jane Doe", "plusOnes": 1 },
    { "name": "Some Stranger", "plusOnes": 1 },
    { "name": "Jimmy D", "userId": 57 }
  ]
}
```

Rules:

| Situation | Result |
|---|---|
| Matched member, not Going on the website | Marked Going, with their +1s on their own RSVP. They get the usual confirmation email, with a note that the Facebook sync added them. |
| Matched member already Going on the website | Their +1s are raised if Facebook shows more. They are **never lowered**. |
| Going on the website but not on Facebook | Left alone. |
| The sync marked them Going, and they're no longer on Facebook's list | Their RSVP is removed. |
| RSVP created on the website (by the member or an admin) | **Never removed** by the sync. |
| No match, or two or more members share the name | Recorded, with their +1s, as guest names on the **sync host's** RSVP. For example: `Some Stranger`, `Some Stranger +1`. |

The sync host is set on the admin page. On this site it's Rob. The sync manages
the host's guest list for synced events, replacing it on each run.

The sync skips the RSVP deadline and the membership-fee check. It returns `400`
for draft and past events.

Response `200`:

```json
{
  "eventId": 12,
  "added":     [{ "userId": 5, "name": "Jane Doe", "facebookName": "Jane Doe", "plusOnes": 1 }],
  "raised":    [{ "userId": 8, "name": "Bob Brown", "facebookName": "Bob Brown", "plusOnes": 3, "from": 2 }],
  "unchanged": [{ "userId": 9, "name": "Alice Anders", "facebookName": "Alice Anders", "plusOnes": 0 }],
  "removed":   [{ "userId": 11, "name": "Carl Carter" }],
  "unmatched": [{ "name": "Some Stranger", "plusOnes": 1 }],
  "ambiguous": [{ "name": "Dan Smith", "candidates": [{ "id": 3, "fullName": "Dan Smith" }, { "id": 4, "fullName": "Dan Smith" }] }],
  "host": {
    "userId": 1,
    "name": "Rob Tippenhauer",
    "guestNames": ["Some Stranger", "Some Stranger +1", "Dan Smith"],
    "additionalGuests": 3,
    "changed": true
  },
  "warnings": []
}
```

- `ambiguous` lists names shared by more than one member. On later runs, send
  those people with an explicit `userId`.
- `host` is `null` when no sync host is set. In that case `warnings` says the
  unmatched people weren't recorded.

---

## Suggested run

1. `GET /me`. Rotate the token if it expires within 14 days.
2. `GET /events` to find the DinnerBears event ID for each Facebook event, and
   keep that mapping on Muse's side.
3. For each upcoming event:
   1. `GET /events/:id/invite-links`. Create any missing flavor with
      `POST /events/:id/invite-links`, then post the URLs to Facebook.
   2. `POST /events/:id/facebook-sync` with the Going list.
4. Log each sync report, especially `ambiguous` and `warnings`.

## Audit

Every write shows up in the website's audit log (**Admin → Security → Audit
Log**) under the Muse account:

- `muse.invite_create`, `muse.invite_revoke`
- `rsvp.facebook_sync` (one entry per RSVP changed)
- `integration.token_rotate`

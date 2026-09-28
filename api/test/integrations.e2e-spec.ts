import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { CityEntity } from '../src/database/entities/city.entity';
import { LocationEntity } from '../src/database/entities/location.entity';
import { UserEntity, UserRole, UserStatus } from '../src/database/entities/user.entity';
import { FacebookAccountEntity } from '../src/database/entities/facebook-account.entity';
import { MemberPointEntity, PointType } from '../src/database/entities/member-point.entity';
import { HardDeleteTask } from '../src/modules/tasks/hard-delete.task';
import { EventRsvpEntity, RsvpSource, RsvpStatus } from '../src/database/entities/event-rsvp.entity';
import { ApiTokenEntity } from '../src/database/entities/api-token.entity';
import { AuditLogEntity } from '../src/database/entities/audit-log.entity';

// Phase 39: automation accounts + the Muse API (token-only /muse routes),
// the Facebook RSVP sync, and admin "Add to Going".
describe('Integrations + Facebook RSVP sync (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Parameters<typeof request>[0];

  let city: CityEntity;
  let location: LocationEntity;
  let admin: UserEntity;
  let adminCookie: string;
  let moderatorCookie: string;
  let alice: UserEntity;
  let aliceCookie: string;
  let bob: UserEntity;
  let bobCookie: string;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    resetThrottler(app);
    city = await seedCity(dataSource);
    location = await seedLocation(dataSource, city.id);

    admin = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, fullName: 'Rob Admin', email: 'admin@example.test' });
    const moderator = await seedUser(dataSource, city.id, { role: UserRole.MODERATOR, fullName: 'Mo Derator', email: 'mod@example.test' });
    alice = await seedUser(dataSource, city.id, { fullName: 'Alice Anders', email: 'alice@example.test' });
    bob = await seedUser(dataSource, city.id, { fullName: 'Bob Brown', email: 'bob@example.test' });
    adminCookie = await loginAs(app, admin);
    moderatorCookie = await loginAs(app, moderator);
    aliceCookie = await loginAs(app, alice);
    bobCookie = await loginAs(app, bob);
  });

  function futureDate(days = 14): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // RSVP rules run on the Eastern calendar date, not UTC.
  function easternToday(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  }

  async function createEvent(overrides: Record<string, unknown> = {}): Promise<{ id: number }> {
    const created = await request(server)
      .post('/api/v1/events')
      .set('Cookie', adminCookie)
      .send({
        cityId: city.id,
        locationId: location.id,
        title: 'Test Dinner',
        eventDate: futureDate(),
        eventTime: '18:30',
        status: 'published',
        ...overrides,
      })
      .expect(201);
    return created.body;
  }

  async function createIntegration(name = 'Muse'): Promise<{ userId: number; token: string }> {
    const res = await request(server)
      .post('/api/v1/admin/integrations')
      .set('Cookie', adminCookie)
      .send({ name })
      .expect(201);
    return { userId: res.body.userId, token: res.body.issued.token };
  }

  const bearer = (token: string) => `Bearer ${token}`;

  function rsvpOf(eventId: number, userId: number): Promise<EventRsvpEntity | null> {
    return dataSource.getRepository(EventRsvpEntity).findOne({ where: { eventId, userId } });
  }

  describe('automation accounts + Muse tokens', () => {
    it('creates a hidden "<name>-automation" Muse account and returns the token once', async () => {
      const res = await request(server)
        .post('/api/v1/admin/integrations')
        .set('Cookie', adminCookie)
        .send({ name: 'Muse' })
        .expect(201);

      expect(res.body.name).toBe('Muse-automation');
      expect(res.body.role).toBe(UserRole.MUSE);
      expect(res.body.issued.token).toMatch(/^cet_/);
      const expiresInDays = (new Date(res.body.issued.expiresAt).getTime() - Date.now()) / 86_400_000;
      expect(expiresInDays).toBeGreaterThan(59);
      expect(expiresInDays).toBeLessThanOrEqual(60);

      const account = await dataSource.getRepository(UserEntity).findOneByOrFail({ id: res.body.userId });
      expect(account.isAutomationAccount).toBeTruthy();
      const stored = await dataSource.getRepository(ApiTokenEntity).findOneOrFail({ where: { userId: res.body.userId } });
      expect(stored.tokenHash).not.toContain(res.body.issued.token);

      const list = await request(server).get('/api/v1/admin/integrations').set('Cookie', adminCookie).expect(200);
      expect(JSON.stringify(list.body)).not.toContain(res.body.issued.token);
      expect(list.body.integrations[0].activeToken.tokenPrefix).toBe(res.body.issued.token.slice(0, 12));

      const leaderboard = await request(server).get('/api/v1/leaderboard').set('Cookie', adminCookie).expect(200);
      expect(JSON.stringify(leaderboard.body)).not.toContain('Muse-automation');
      const members = await request(server).get('/api/v1/users/members').set('Cookie', adminCookie).expect(200);
      expect(JSON.stringify(members.body)).not.toContain('Muse-automation');
    });

    it('creates a Claude-style automation account with no token', async () => {
      const res = await request(server)
        .post('/api/v1/admin/integrations')
        .set('Cookie', adminCookie)
        .send({ name: 'Claude', role: 'automation' })
        .expect(201);
      expect(res.body).toMatchObject({ name: 'Claude-automation', role: UserRole.AUTOMATION, issued: null });
    });

    it('is admin-only to manage', async () => {
      await request(server).post('/api/v1/admin/integrations').set('Cookie', moderatorCookie).send({ name: 'Muse' }).expect(403);
      await request(server).get('/api/v1/admin/integrations').set('Cookie', aliceCookie).expect(403);
    });

    it('authenticates /muse with the Authorization header only', async () => {
      const { token } = await createIntegration();
      const me = await request(server).get('/api/v1/muse/me').set('Authorization', bearer(token)).expect(200);
      expect(me.body.name).toBe('Muse-automation');
      expect(me.body.tokenExpiresAt).toBeTruthy();

      await request(server).get('/api/v1/muse/me').expect(401);
      await request(server).get('/api/v1/muse/me').set('Authorization', bearer('cet_nope')).expect(401);
      await request(server).get('/api/v1/muse/me').set('Authorization', token).expect(401);
      // A signed-in admin's session cookie doesn't open the Muse routes.
      await request(server).get('/api/v1/muse/me').set('Cookie', adminCookie).expect(401);
    });

    it('does not let the token reach any website endpoint', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await request(server).post(`/api/v1/events/${event.id}/rsvp`).set('Authorization', bearer(token)).send({ status: 'going' }).expect(401);
      await request(server).get('/api/v1/admin/integrations').set('Authorization', bearer(token)).expect(401);
      await request(server).get('/api/v1/users/me').set('Authorization', bearer(token)).expect(401);
      await request(server).get(`/api/v1/events/${event.id}/attendance`).set('Authorization', bearer(token)).expect(401);
    });

    it('lets Muse rotate its own token — the old one dies immediately', async () => {
      const { token } = await createIntegration();
      const rotated = await request(server).post('/api/v1/muse/token/rotate').set('Authorization', bearer(token)).expect(200);
      expect(rotated.body.token).toMatch(/^cet_/);
      expect(rotated.body.token).not.toBe(token);

      await request(server).get('/api/v1/muse/me').set('Authorization', bearer(token)).expect(401);
      await request(server).get('/api/v1/muse/me').set('Authorization', bearer(rotated.body.token)).expect(200);

      const audit = await dataSource.getRepository(AuditLogEntity).findOne({ where: { action: 'integration.token_rotate' } });
      expect(audit).toBeTruthy();
    });

    it('stops working once an admin revokes it, and when it expires', async () => {
      const { userId, token } = await createIntegration();
      await request(server).delete(`/api/v1/admin/integrations/${userId}/token`).set('Cookie', adminCookie).expect(200);
      await request(server).get('/api/v1/muse/me').set('Authorization', bearer(token)).expect(401);

      const regenerated = await request(server).post(`/api/v1/admin/integrations/${userId}/token`).set('Cookie', adminCookie).expect(201);
      await request(server).get('/api/v1/muse/me').set('Authorization', bearer(regenerated.body.token)).expect(200);

      await dataSource.getRepository(ApiTokenEntity).update({ userId }, { expiresAt: new Date(Date.now() - 1000) });
      await request(server).get('/api/v1/muse/me').set('Authorization', bearer(regenerated.body.token)).expect(401);
    });

    it('only lets automation accounts hold the automation roles — and they can move between them', async () => {
      const { userId, token } = await createIntegration();
      await request(server).post(`/api/v1/admin/users/${alice.id}/role`).set('Cookie', adminCookie).send({ role: 'muse' }).expect(403);
      await request(server).post(`/api/v1/admin/users/${alice.id}/role`).set('Cookie', adminCookie).send({ role: 'automation' }).expect(403);

      // Switched to Claude automation: the Muse token stops working…
      await request(server).post(`/api/v1/admin/users/${userId}/role`).set('Cookie', adminCookie).send({ role: 'automation' }).expect(200);
      await request(server).get('/api/v1/muse/me').set('Authorization', bearer(token)).expect(401);
      // …and back to Muse, it works again.
      await request(server).post(`/api/v1/admin/users/${userId}/role`).set('Cookie', adminCookie).send({ role: 'muse' }).expect(200);
      await request(server).get('/api/v1/muse/me').set('Authorization', bearer(token)).expect(200);
    });
  });

  describe('/muse data endpoints', () => {
    it('can read events and locations but not create or change them', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();

      const list = await request(server).get('/api/v1/muse/events').set('Authorization', bearer(token)).expect(200);
      expect(list.body.map((e: { id: number }) => e.id)).toContain(event.id);
      const one = await request(server).get(`/api/v1/muse/events/${event.id}`).set('Authorization', bearer(token)).expect(200);
      expect(one.body.title).toBe('Test Dinner');

      const locations = await request(server).get('/api/v1/muse/locations').set('Authorization', bearer(token)).expect(200);
      expect(locations.body.map((l: { id: number }) => l.id)).toContain(location.id);

      // No write routes exist for events or locations.
      await request(server)
        .post('/api/v1/muse/events')
        .set('Authorization', bearer(token))
        .send({ cityId: city.id, locationId: location.id, title: 'Nope', eventDate: futureDate(), eventTime: '18:30' })
        .expect(404);
      await request(server).patch(`/api/v1/muse/events/${event.id}`).set('Authorization', bearer(token)).send({ title: 'Nope' }).expect(404);
      await request(server)
        .post('/api/v1/muse/locations')
        .set('Authorization', bearer(token))
        .send({ name: 'Nope', address: '1 Main St', cityId: city.id })
        .expect(404);
    });

    it('lists real members only, without contact details', async () => {
      const { token } = await createIntegration();
      const res = await request(server).get('/api/v1/muse/users').set('Authorization', bearer(token)).expect(200);
      const names = res.body.map((u: { fullName: string }) => u.fullName);
      expect(names).toEqual(expect.arrayContaining(['Alice Anders', 'Bob Brown', 'Rob Admin']));
      expect(names).not.toContain('Muse-automation');
      expect(JSON.stringify(res.body)).not.toContain('@example.test');
    });

    it('lists, creates and revokes event invite links like the Share dialog', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();

      const empty = await request(server).get(`/api/v1/muse/events/${event.id}/invite-links`).set('Authorization', bearer(token)).expect(200);
      expect(empty.body).toMatchObject({ member: null, nonValidated: null, all: [] });

      const member = await request(server)
        .post(`/api/v1/muse/events/${event.id}/invite-links`)
        .set('Authorization', bearer(token))
        .send({ flavor: 'member' })
        .expect(201);
      expect(member.body.url).toMatch(new RegExp(`/join/${member.body.token}$`));
      await request(server)
        .post(`/api/v1/muse/events/${event.id}/invite-links`)
        .set('Authorization', bearer(token))
        .send({ flavor: 'non_validated' })
        .expect(201);

      const both = await request(server).get(`/api/v1/muse/events/${event.id}/invite-links`).set('Authorization', bearer(token)).expect(200);
      expect(both.body.member.id).toBe(member.body.id);
      expect(both.body.nonValidated.flavor).toBe('non_validated');

      await request(server)
        .patch(`/api/v1/muse/events/${event.id}/invite-links/${member.body.id}/revoke`)
        .set('Authorization', bearer(token))
        .expect(200);
      const after = await request(server).get(`/api/v1/muse/events/${event.id}/invite-links`).set('Authorization', bearer(token)).expect(200);
      expect(after.body.member).toBeNull();

      const other = await createEvent();
      await request(server)
        .patch(`/api/v1/muse/events/${other.id}/invite-links/${member.body.id}/revoke`)
        .set('Authorization', bearer(token))
        .expect(404);
    });
  });

  describe('Facebook sync', () => {
    // Two groups can each post a Facebook event for the same dinner.
    const CINCY = { id: '1617936020344888', group: 'Cincinnati Tuesday Night Bear Dinners' };
    const GEM = { id: '1072447435694919', group: 'Gem City Bears' };

    // Facebook people: numeric ID + current vanity URL, as Muse sends them.
    const fbPerson = (name: string, id: string, vanity: string, plus_ones?: number) => ({
      name,
      facebook_user_id: id,
      profile_url: `https://www.facebook.com/${vanity}`,
      ...(plus_ones !== undefined ? { plus_ones } : {}),
    });
    const ALICE_FB = fbPerson('Alice Anders', '1001', 'alice.anders');
    const BOB_FB = fbPerson('Bob Brown', '1002', 'bobbrown');
    const STRANGER = fbPerson('Some Stranger', '2001', 'some.stranger');
    const DON = fbPerson('Don Weaver', '2002', 'don.weaver.718');

    function fbEvent(eventId: number, fb: { id: string; group: string }, guests: object[], extra: Record<string, unknown> = {}) {
      return { dinnerbears_event_id: eventId, facebook_event_id: fb.id, facebook_group: fb.group, guests, ...extra };
    }

    async function sync(token: string, events: object[], extra: Record<string, unknown> = {}, status = 200) {
      return request(server)
        .post('/api/v1/muse/facebook-sync')
        .set('Authorization', bearer(token))
        .send({ events, ...extra })
        .expect(status);
    }

    async function accountId(facebookUserId: string): Promise<number> {
      const row = await dataSource.getRepository(FacebookAccountEntity).findOneByOrFail({ facebookUserId });
      return row.id;
    }

    async function linkAccount(facebookUserId: string, userId: number) {
      return request(server)
        .post(`/api/v1/admin/facebook-accounts/${await accountId(facebookUserId)}/link`)
        .set('Cookie', adminCookie)
        .send({ userId })
        .expect(201);
    }

    it('accepts Muse\'s extraction as-is and links the Facebook events to the dinner', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      const res = await sync(token, [
        fbEvent(event.id, CINCY, [STRANGER, DON], { going_count: 2, facebook_event_url: `https://www.facebook.com/events/${CINCY.id}/`, title: 'Dinner' }),
      ], { extracted_at: '2026-09-27T10:13:00-04:00', note: 'Going tab only' });

      expect(res.body.events).toEqual([
        expect.objectContaining({ facebookEventId: CINCY.id, dinnerbearsEventId: event.id, status: 'ok', accepted: 2, complete: true, totalGoing: 2 }),
      ]);
      const one = await request(server).get(`/api/v1/muse/events/${event.id}`).set('Authorization', bearer(token)).expect(200);
      expect(one.body.facebookEvents).toEqual([
        expect.objectContaining({ facebookEventId: CINCY.id, group: CINCY.group, lastGoingCount: 2 }),
      ]);
    });

    it('counts Facebook-only people once across both groups, and hands every Facebook event the merged total', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await request(server).post(`/api/v1/events/${event.id}/rsvp`).set('Cookie', bobCookie).send({ status: 'going', additionalGuests: 1 }).expect(201);

      const res = await sync(token, [
        fbEvent(event.id, CINCY, [STRANGER, DON]),
        fbEvent(event.id, GEM, [{ ...STRANGER, plus_ones: 1 }]),
      ]);

      // Bob + 1 guest (2) + Don (1) + Stranger with his +1 (2), Stranger counted once.
      expect(res.body.events.map((e: { totalGoing: number }) => e.totalGoing)).toEqual([5, 5]);
      expect(res.body.unmatched.map((u: { name: string }) => u.name).sort()).toEqual(['Don Weaver', 'Some Stranger']);

      const detail = await request(server).get(`/api/v1/events/${event.id}`).set('Cookie', aliceCookie).expect(200);
      expect(detail.body.facebookAttendees.map((f: { name: string; plusOnes: number }) => [f.name, f.plusOnes])).toEqual([
        ['Some Stranger', 1],
        ['Don Weaver', 0],
      ]);
      const list = await request(server).get('/api/v1/events').set('Cookie', aliceCookie).expect(200);
      expect(list.body.find((e: { id: number }) => e.id === event.id).goingCount).toBe(5);

      // Nothing lands on anyone's +1s.
      expect(await rsvpOf(event.id, admin.id)).toBeNull();
    });

    it('only suggests name matches — it never links or RSVPs a member by itself', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      const res = await sync(token, [fbEvent(event.id, CINCY, [ALICE_FB])]);
      expect(res.body.unmatched).toEqual([
        expect.objectContaining({ name: 'Alice Anders', suggestions: [{ id: alice.id, fullName: 'Alice Anders' }] }),
      ]);
      expect(res.body.added).toEqual([]);
      expect(await rsvpOf(event.id, alice.id)).toBeNull();
    });

    it('counts a linked member through their own RSVP — once, even with two Facebook accounts', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      const aliceSecond = fbPerson('Alice A', '1003', 'alice.second', 2);
      await sync(token, [fbEvent(event.id, CINCY, [{ ...ALICE_FB, plus_ones: 1 }]), fbEvent(event.id, GEM, [aliceSecond])]);

      await linkAccount('1001', alice.id);
      await linkAccount('1003', alice.id);
      const res = await sync(token, [fbEvent(event.id, CINCY, [{ ...ALICE_FB, plus_ones: 1 }]), fbEvent(event.id, GEM, [aliceSecond])]);

      // Her Facebook +1s sit beside her website guests (none), merged across
      // both accounts: the larger unnamed count, not the sum.
      expect(await rsvpOf(event.id, alice.id)).toMatchObject({
        status: RsvpStatus.GOING,
        additionalGuests: 0,
        facebookGuestCount: 2,
        source: RsvpSource.FACEBOOK_SYNC,
      });
      expect(res.body.unmatched).toEqual([]);
      expect(res.body.events[0].totalGoing).toBe(3); // Alice + her 2 guests, no Facebook-only duplicates
      const detail = await request(server).get(`/api/v1/events/${event.id}`).set('Cookie', aliceCookie).expect(200);
      expect(detail.body.facebookAttendees).toEqual([]);
    });

    it('linking marks the member Going right away, before the next sync', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await sync(token, [fbEvent(event.id, CINCY, [ALICE_FB])]);
      await linkAccount('1001', alice.id);
      expect(await rsvpOf(event.id, alice.id)).toMatchObject({ status: RsvpStatus.GOING, source: RsvpSource.FACEBOOK_SYNC });
    });

    it('tracks each Facebook event\'s list separately — dropping off one group isn\'t dropping off the dinner', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await sync(token, [fbEvent(event.id, CINCY, [ALICE_FB, STRANGER]), fbEvent(event.id, GEM, [ALICE_FB, STRANGER])]);
      await linkAccount('1001', alice.id);

      // Gone from the Cincinnati list only: still Going via Gem City Bears.
      let res = await sync(token, [fbEvent(event.id, CINCY, [])]);
      expect(res.body.removed).toEqual([]);
      expect(await rsvpOf(event.id, alice.id)).toMatchObject({ status: RsvpStatus.GOING });
      expect(res.body.events[0].totalGoing).toBe(2);

      // Gone from both: the sync-made RSVP goes, and so does the stranger.
      res = await sync(token, [fbEvent(event.id, GEM, [])]);
      expect(res.body.removed.map((r: { userId: number }) => r.userId)).toEqual([alice.id]);
      expect(await rsvpOf(event.id, alice.id)).toBeNull();
      expect(res.body.events[0].totalGoing).toBe(0);
    });

    it('keeps a member\'s Facebook +1s beside their website guests — never merging into them', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', bobCookie)
        .send({ status: 'going', additionalGuests: 2, guestNames: ['Carol Smith'] })
        .expect(201);
      await sync(token, [fbEvent(event.id, CINCY, [BOB_FB])]);
      await linkAccount('1002', bob.id);

      // Carol is already his website guest; Dan and one unnamed +1 are extra.
      const res = await sync(token, [fbEvent(event.id, CINCY, [{ ...BOB_FB, plus_one_names: ['carol smith', 'Dan Jones'], plus_ones: 3 }])]);
      expect(await rsvpOf(event.id, bob.id)).toMatchObject({
        additionalGuests: 2,
        guestNames: ['Carol Smith'],
        facebookGuestNames: ['Dan Jones', null],
        facebookGuestCount: 2,
        source: RsvpSource.MEMBER,
      });
      expect(res.body.events[0].totalGoing).toBe(5); // Bob + 2 website guests + 2 Facebook +1s

      // Facebook +1s follow the comments down as well as up; website guests don't move.
      await sync(token, [fbEvent(event.id, CINCY, [BOB_FB])]);
      expect(await rsvpOf(event.id, bob.id)).toMatchObject({ additionalGuests: 2, facebookGuestNames: null, facebookGuestCount: 0 });

      // Off Facebook entirely: the website RSVP stays, with its own guests.
      await sync(token, [fbEvent(event.id, CINCY, [{ ...BOB_FB, plus_one_names: ['Dan Jones'] }])]);
      const gone = await sync(token, [fbEvent(event.id, CINCY, [])]);
      expect(gone.body.removed).toEqual([]);
      expect(await rsvpOf(event.id, bob.id)).toMatchObject({ status: RsvpStatus.GOING, additionalGuests: 2, facebookGuestCount: 0 });
    });

    it('shows a Facebook-only person\'s named +1s like a member\'s', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      const res = await sync(token, [fbEvent(event.id, CINCY, [{ ...STRANGER, plus_one_names: ['Pat Lee'], plus_ones: 2 }])]);
      expect(res.body.events[0].totalGoing).toBe(3);

      const detail = await request(server).get(`/api/v1/events/${event.id}`).set('Cookie', aliceCookie).expect(200);
      expect(detail.body.facebookAttendees).toEqual([
        expect.objectContaining({ name: 'Some Stranger', plusOnes: 2, plusOneNames: ['Pat Lee'] }),
      ]);
      const attendance = await request(server).get(`/api/v1/events/${event.id}/attendance`).set('Cookie', adminCookie).expect(200);
      expect(attendance.body.find((a: { type: string }) => a.type === 'facebook').memberName).toBe('Some Stranger (+2: Pat Lee)');
    });

    it('removes nobody when going_count says the list is incomplete', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await sync(token, [fbEvent(event.id, CINCY, [STRANGER, DON])]);
      const res = await sync(token, [fbEvent(event.id, CINCY, [STRANGER], { going_count: 2 })]);
      expect(res.body.events[0]).toMatchObject({ complete: false, totalGoing: 2 });
      expect(res.body.warnings.join(' ')).toContain('going_count');
    });

    it('skips a list older than the one already applied', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await sync(token, [fbEvent(event.id, CINCY, [STRANGER, DON])], { extracted_at: '2026-09-27T12:00:00Z' });
      const res = await sync(token, [fbEvent(event.id, CINCY, [])], { extracted_at: '2026-09-27T11:00:00Z' });
      expect(res.body.events[0]).toMatchObject({ status: 'skipped', totalGoing: 2 });
    });

    it('fails one Facebook event without sinking the rest of the batch', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      const other = await createEvent();
      const past = await createEvent();
      await dataSource.query('UPDATE events SET event_date = ? WHERE id = ?', [futureDate(-3), past.id]);
      await sync(token, [fbEvent(event.id, CINCY, [STRANGER])]);

      const res = await sync(token, [
        fbEvent(other.id, CINCY, [DON]), // already linked to `event`
        fbEvent(past.id, { id: '999', group: 'x' }, [DON]),
        fbEvent(event.id, GEM, [DON]),
      ]);
      expect(res.body.events.map((e: { status: string }) => e.status)).toEqual(['error', 'error', 'ok']);
      expect(res.body.events[0].error).toContain('already linked');
      expect(res.body.events[2].totalGoing).toBe(2);
    });

    it('keeps accounts by Facebook ID and follows a changed vanity URL', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await sync(token, [fbEvent(event.id, CINCY, [DON])]);
      await sync(token, [fbEvent(event.id, CINCY, [fbPerson('Don W.', '2002', 'don.weaver.new')])]);

      const accounts = await dataSource.getRepository(FacebookAccountEntity).find({ where: { facebookUserId: '2002' } });
      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({ profileUrl: 'facebook.com/don.weaver.new', displayName: 'Don W.' });
    });

    it('requires both the profile URL and the numeric Facebook ID', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await sync(token, [fbEvent(event.id, CINCY, [{ name: 'No Id', profile_url: 'https://www.facebook.com/noid' }])], {}, 400);
    });

    it('carries a Facebook-only attendance mark over to the member, with points, when linked', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await sync(token, [fbEvent(event.id, CINCY, [ALICE_FB])]);

      const attendance = await request(server).get(`/api/v1/events/${event.id}/attendance`).set('Cookie', adminCookie).expect(200);
      const fbRow = attendance.body.find((a: { type: string }) => a.type === 'facebook');
      expect(fbRow).toMatchObject({ memberName: 'Alice Anders', attended: null });
      await request(server)
        .patch(`/api/v1/events/facebook-attendees/${fbRow.facebookAttendeeId}/attendance`)
        .set('Cookie', moderatorCookie)
        .send({ attended: true })
        .expect(200);

      await linkAccount('1001', alice.id);
      expect(await rsvpOf(event.id, alice.id)).toMatchObject({ status: RsvpStatus.GOING, attended: 1 });
      const points = await dataSource.getRepository(MemberPointEntity).find({ where: { userId: alice.id, pointType: PointType.ATTENDANCE } });
      expect(points).toHaveLength(1);
    });

    it('recognizes a banned member on a Going list — warns, never adds or counts them', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await sync(token, [fbEvent(event.id, CINCY, [BOB_FB])]);
      await linkAccount('1002', bob.id);
      await dataSource.getRepository(EventRsvpEntity).delete({ eventId: event.id, userId: bob.id });
      await dataSource.getRepository(UserEntity).update(bob.id, { status: UserStatus.SUSPENDED });

      const res = await sync(token, [fbEvent(event.id, CINCY, [BOB_FB])]);
      expect(res.body.warnings.join(' ')).toContain('Bob Brown (banned member)');
      expect(await rsvpOf(event.id, bob.id)).toBeNull();
      expect(res.body.events[0].totalGoing).toBe(0);

      const accounts = await request(server).get('/api/v1/admin/facebook-accounts').set('Cookie', adminCookie).expect(200);
      expect(accounts.body[0].member).toMatchObject({ id: bob.id, status: 'suspended' });
    });

    it('unlinks a member\'s Facebook account once their own account deletion completes', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await sync(token, [fbEvent(event.id, CINCY, [ALICE_FB])]);
      await linkAccount('1001', alice.id);
      await dataSource.getRepository(UserEntity).update(alice.id, {
        status: UserStatus.DELETED,
        hardDeleteAt: new Date(Date.now() - 1000),
      });

      await app.get(HardDeleteTask).runHardDelete();
      const account = await dataSource.getRepository(FacebookAccountEntity).findOneByOrFail({ facebookUserId: '1001' });
      expect(account).toMatchObject({ userId: null, status: 'unmatched' });
    });

    it('lets Muse link and unlink Facebook events directly', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      const other = await createEvent();
      await request(server)
        .put(`/api/v1/muse/events/${event.id}/facebook-events/${GEM.id}`)
        .set('Authorization', bearer(token))
        .send({ group: GEM.group })
        .expect(200);
      await request(server).put(`/api/v1/muse/events/${other.id}/facebook-events/${GEM.id}`).set('Authorization', bearer(token)).send({}).expect(409);
      await request(server).put(`/api/v1/muse/events/${event.id}/facebook-events/not-digits`).set('Authorization', bearer(token)).send({}).expect(400);

      const list = await request(server).get('/api/v1/muse/events').set('Authorization', bearer(token)).expect(200);
      expect(list.body.find((e: { id: number }) => e.id === event.id).facebookEvents).toEqual([
        expect.objectContaining({ facebookEventId: GEM.id, group: GEM.group }),
      ]);

      await sync(token, [fbEvent(event.id, GEM, [STRANGER])]);
      await request(server).delete(`/api/v1/muse/events/${event.id}/facebook-events/${GEM.id}`).set('Authorization', bearer(token)).expect(200);
      const detail = await request(server).get(`/api/v1/events/${event.id}`).set('Cookie', aliceCookie).expect(200);
      expect(detail.body.facebookAttendees).toEqual([]);
    });

    it('lists attendees for Muse, Facebook-only people and the headcount included', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await request(server).post(`/api/v1/events/${event.id}/rsvp`).set('Cookie', bobCookie).send({ status: 'maybe' }).expect(201);
      await sync(token, [fbEvent(event.id, CINCY, [{ ...STRANGER, plus_ones: 2 }])]);

      const res = await request(server).get(`/api/v1/muse/events/${event.id}/attendees`).set('Authorization', bearer(token)).expect(200);
      expect(res.body.members).toEqual([expect.objectContaining({ fullName: 'Bob Brown', status: 'maybe', source: 'member' })]);
      expect(res.body.facebookOnly).toEqual([expect.objectContaining({ name: 'Some Stranger', plusOnes: 2 })]);
      expect(res.body.totalGoing).toBe(3);
    });

    it('keeps the Facebook Accounts page admin-only', async () => {
      await request(server).get('/api/v1/admin/facebook-accounts').set('Cookie', moderatorCookie).expect(403);
    });
  });

  describe('POST /events/:id/attendance/going', () => {
    it('lets an admin mark a member Going on their behalf, with an audit trail', async () => {
      const event = await createEvent();
      const res = await request(server)
        .post(`/api/v1/events/${event.id}/attendance/going`)
        .set('Cookie', adminCookie)
        .send({ userId: alice.id, additionalGuests: 1 })
        .expect(201);
      expect(res.body).toMatchObject({ type: 'member', userId: alice.id, memberName: 'Alice Anders', source: 'admin' });
      expect(await rsvpOf(event.id, alice.id)).toMatchObject({ status: RsvpStatus.GOING, additionalGuests: 1, attended: null });

      const audit = await dataSource.getRepository(AuditLogEntity).findOne({ where: { action: 'rsvp.admin_add_going' } });
      expect(audit).toMatchObject({ userId: admin.id, entityId: event.id });
    });

    it('is admin-only', async () => {
      const event = await createEvent();
      await request(server).post(`/api/v1/events/${event.id}/attendance/going`).set('Cookie', moderatorCookie).send({ userId: alice.id }).expect(403);
    });
  });
});

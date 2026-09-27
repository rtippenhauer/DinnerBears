import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { CityEntity } from '../src/database/entities/city.entity';
import { LocationEntity } from '../src/database/entities/location.entity';
import { UserEntity, UserRole } from '../src/database/entities/user.entity';
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
      // First Muse account defaults the unmatched-guest host to its creator.
      expect(list.body.syncHost).toEqual({ id: admin.id, fullName: 'Rob Admin' });

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
      await request(server).post(`/api/v1/events/${event.id}/facebook-sync`).set('Authorization', bearer(token)).send({ attendees: [] }).expect(401);
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

    it('lists an event\'s attendees with +1s and who created each RSVP', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await request(server).post(`/api/v1/events/${event.id}/rsvp`).set('Cookie', bobCookie).send({ status: 'maybe' }).expect(201);
      await request(server)
        .post(`/api/v1/muse/events/${event.id}/facebook-sync`)
        .set('Authorization', bearer(token))
        .send({ attendees: [{ name: 'Alice Anders', plusOnes: 2 }] })
        .expect(200);

      const res = await request(server).get(`/api/v1/muse/events/${event.id}/attendees`).set('Authorization', bearer(token)).expect(200);
      const byName = Object.fromEntries(res.body.members.map((m: { fullName: string }) => [m.fullName, m]));
      expect(byName['Alice Anders']).toMatchObject({ status: 'going', additionalGuests: 2, source: 'facebook_sync' });
      expect(byName['Bob Brown']).toMatchObject({ status: 'maybe', source: 'member' });
      expect(res.body.publicGuests).toEqual([]);
    });
  });

  describe('facebook-sync', () => {
    // Muse calls /muse/events/:id/facebook-sync with its token; an admin can
    // run the same sync from /events/:id/facebook-sync with a session.
    async function sync(eventId: number, attendees: unknown[], auth: { token?: string; cookie?: string }, status = 200) {
      const req = auth.token
        ? request(server).post(`/api/v1/muse/events/${eventId}/facebook-sync`).set('Authorization', bearer(auth.token))
        : request(server).post(`/api/v1/events/${eventId}/facebook-sync`).set('Cookie', auth.cookie!);
      return req.send({ attendees }).expect(status);
    }

    it('adds matched members as Going, owned by the sync, and parks strangers on the host as +1s', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();

      const res = await sync(event.id, [
        { name: 'alice  anders', plusOnes: 1 },
        { name: 'Stranger Person', plusOnes: 1 },
      ], { token });

      expect(res.body.added.map((a: { userId: number }) => a.userId)).toEqual([alice.id]);
      const aliceRsvp = await rsvpOf(event.id, alice.id);
      expect(aliceRsvp).toMatchObject({ status: RsvpStatus.GOING, additionalGuests: 1, source: RsvpSource.FACEBOOK_SYNC });

      const hostRsvp = await rsvpOf(event.id, admin.id);
      expect(hostRsvp).toMatchObject({ status: RsvpStatus.GOING, additionalGuests: 2 });
      expect(hostRsvp!.guestNames).toEqual(['Stranger Person', 'Stranger Person +1']);
      expect(res.body.unmatched).toEqual([{ name: 'Stranger Person', plusOnes: 1 }]);

      const audits = await dataSource.getRepository(AuditLogEntity).find({ where: { action: 'rsvp.facebook_sync' } });
      expect(audits.length).toBeGreaterThanOrEqual(2);
    });

    it('is idempotent — a second identical run changes nothing', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      const attendees = [{ name: 'Alice Anders', plusOnes: 1 }, { name: 'Stranger Person' }];
      await sync(event.id, attendees, { token });
      const again = await sync(event.id, attendees, { token });
      expect(again.body.added).toEqual([]);
      expect(again.body.removed).toEqual([]);
      expect(again.body.unchanged.map((u: { userId: number }) => u.userId)).toEqual([alice.id]);
      expect(again.body.host.changed).toBe(false);
    });

    it('raises +1s for someone already Going but never lowers them', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await request(server).post(`/api/v1/events/${event.id}/rsvp`).set('Cookie', bobCookie).send({ status: 'going', additionalGuests: 2 }).expect(201);

      await sync(event.id, [{ name: 'Bob Brown', plusOnes: 1 }], { token });
      expect(await rsvpOf(event.id, bob.id)).toMatchObject({ additionalGuests: 2, source: RsvpSource.MEMBER });

      const raised = await sync(event.id, [{ name: 'Bob Brown', plusOnes: 3 }], { token });
      expect(raised.body.raised).toEqual([expect.objectContaining({ userId: bob.id, from: 2, plusOnes: 3 })]);
      expect(await rsvpOf(event.id, bob.id)).toMatchObject({ additionalGuests: 3, source: RsvpSource.MEMBER });
    });

    it('removes only RSVPs the sync created once they leave Facebook', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await request(server).post(`/api/v1/events/${event.id}/rsvp`).set('Cookie', bobCookie).send({ status: 'going' }).expect(201);
      await sync(event.id, [{ name: 'Alice Anders' }, { name: 'Bob Brown' }], { token });

      const res = await sync(event.id, [], { token });
      expect(res.body.removed.map((r: { userId: number }) => r.userId)).toEqual([alice.id]);
      expect(await rsvpOf(event.id, alice.id)).toBeNull();
      expect(await rsvpOf(event.id, bob.id)).toMatchObject({ status: RsvpStatus.GOING });
    });

    it('stops owning an RSVP the moment the member edits it themselves', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await sync(event.id, [{ name: 'Alice Anders' }], { token });
      await request(server).post(`/api/v1/events/${event.id}/rsvp`).set('Cookie', aliceCookie).send({ status: 'going', additionalGuests: 1 }).expect(201);

      await sync(event.id, [], { token });
      expect(await rsvpOf(event.id, alice.id)).toMatchObject({ status: RsvpStatus.GOING, source: RsvpSource.MEMBER });
    });

    it('never removes someone an admin added', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await request(server).post(`/api/v1/events/${event.id}/attendance/going`).set('Cookie', adminCookie).send({ userId: alice.id }).expect(201);
      await sync(event.id, [], { token });
      expect(await rsvpOf(event.id, alice.id)).toMatchObject({ status: RsvpStatus.GOING, source: RsvpSource.ADMIN });
    });

    it('reports duplicate names instead of guessing, and records them as host +1s', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await seedUser(dataSource, city.id, { fullName: 'Dan Smith' });
      await seedUser(dataSource, city.id, { fullName: 'Dan Smith' });

      const res = await sync(event.id, [{ name: 'Dan Smith' }], { token });
      expect(res.body.ambiguous[0].name).toBe('Dan Smith');
      expect(res.body.ambiguous[0].candidates).toHaveLength(2);
      expect(res.body.added).toEqual([]);
      expect((await rsvpOf(event.id, admin.id))!.guestNames).toEqual(['Dan Smith']);
    });

    it('matches by explicit userId when the Facebook name differs', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      const res = await sync(event.id, [{ name: 'Ally A.', userId: alice.id }], { token });
      expect(res.body.added).toEqual([expect.objectContaining({ userId: alice.id, facebookName: 'Ally A.' })]);
    });

    it('clears the host guest list when everyone unmatched is gone, removing a sync-made host RSVP', async () => {
      const { token } = await createIntegration();
      const event = await createEvent();
      await sync(event.id, [{ name: 'Stranger Person' }], { token });
      expect(await rsvpOf(event.id, admin.id)).toMatchObject({ source: RsvpSource.FACEBOOK_SYNC });

      await sync(event.id, [], { token });
      expect(await rsvpOf(event.id, admin.id)).toBeNull();
    });

    it('bypasses the RSVP deadline and membership gate but not past events', async () => {
      const { token } = await createIntegration();
      await request(server)
        .patch('/api/v1/admin/config/bulk')
        .set('Cookie', adminCookie)
        .send({ entries: [{ key: 'feature_require_membership', value: 'true' }] })
        .expect(200);
      const past = await createEvent({ eventDate: futureDate(10) });
      await dataSource.getRepository(EventRsvpEntity).save({ eventId: past.id, userId: alice.id, status: RsvpStatus.GOING, attended: true });

      const event = await createEvent({ eventDate: easternToday(), eventTime: '00:01' });
      await sync(event.id, [{ name: 'Alice Anders' }], { token });
      expect(await rsvpOf(event.id, alice.id)).toMatchObject({ status: RsvpStatus.GOING });

      await dataSource.query('UPDATE events SET event_date = ? WHERE id = ?', [futureDate(-3), event.id]);
      await sync(event.id, [{ name: 'Alice Anders' }], { token }, 400);
    });

    it('is open to admins and the integration only', async () => {
      const event = await createEvent();
      await sync(event.id, [], { cookie: adminCookie });
      await sync(event.id, [], { cookie: moderatorCookie }, 403);
      await sync(event.id, [], { cookie: aliceCookie }, 403);
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

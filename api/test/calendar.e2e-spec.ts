import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { CityEntity } from '../src/database/entities/city.entity';
import { LocationEntity } from '../src/database/entities/location.entity';
import { UserEntity, UserRole } from '../src/database/entities/user.entity';
import { EventEntity, EventStatus } from '../src/database/entities/event.entity';
import { EventRsvpEntity, RsvpStatus } from '../src/database/entities/event-rsvp.entity';
import { CalendarService } from '../src/modules/calendar/calendar.service';

const CLOUDFLARE_SECRET = 'test-cloudflare-email-secret-not-for-real-use';

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('Calendar / ICS Feed (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Parameters<typeof request>[0];
  let calendarService: CalendarService;

  let city: CityEntity;
  let location: LocationEntity;
  let admin: UserEntity;
  let member: UserEntity;
  let memberCookie: string;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    server = app.getHttpServer();
    calendarService = app.get(CalendarService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    resetThrottler(app);
    city = await seedCity(dataSource);
    location = await seedLocation(dataSource, city.id);

    admin = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    member = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    memberCookie = await loginAs(app, member);
  });

  async function seedEvent(overrides: Record<string, unknown> = {}): Promise<EventEntity> {
    const repo = dataSource.getRepository(EventEntity);
    return repo.save(
      repo.create({
        cityId: city.id,
        locationId: location.id,
        locationName: location.name,
        locationAddress: location.address,
        createdById: admin.id,
        title: 'Calendar Test Dinner',
        eventDate: dateOffset(14),
        eventTime: '18:30',
        status: EventStatus.PUBLISHED,
        ...overrides,
      }),
    );
  }

  describe('GET /calendar/feed.ics', () => {
    it('rejects a request with no token', async () => {
      await request(server).get('/api/v1/calendar/feed.ics').expect(401);
    });

    it('rejects an unknown token', async () => {
      await request(server).get('/api/v1/calendar/feed.ics').query({ token: 'nonexistent-token' }).expect(401);
    });

    it('returns a valid RFC 5545 feed with an upcoming published event', async () => {
      const event = await seedEvent();
      const token = await calendarService.getOrCreateToken(member.id);

      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);
      expect(res.headers['content-type']).toContain('text/calendar');
      expect(res.text).toContain('BEGIN:VCALENDAR');
      expect(res.text).toContain(`UID:dinnerbears-event-${event.id}@dinnerbears.com`);
      expect(res.text).toMatch(/DTSTART:\d{8}T\d{6}Z/);
      expect(res.text).toContain('STATUS:CONFIRMED');
      // Derived from BASE_DOMAIN, which test/setup-env.ts sets to 'localhost' —
      // it was the literal production address until de-branding.
      expect(res.text).toContain('ORGANIZER;CN=DinnerBears:mailto:calendar@localhost');
      expect(res.text).toContain('METHOD:PUBLISH');
    });

    it('returns the empty-feed skeleton when there are no matching events', async () => {
      const token = await calendarService.getOrCreateToken(member.id);

      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);
      expect(res.text).not.toContain('BEGIN:VEVENT');
      expect(res.text).not.toContain('X-WR-TIMEZONE');
    });

    it('excludes a cancelled event older than the 7-day grace window', async () => {
      await seedEvent({ status: EventStatus.CANCELLED, eventDate: dateOffset(-8) });
      const token = await calendarService.getOrCreateToken(member.id);

      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);
      expect(res.text).not.toContain('BEGIN:VEVENT');
    });

    it('includes a cancelled event still within the 7-day grace window', async () => {
      const event = await seedEvent({ status: EventStatus.CANCELLED, eventDate: dateOffset(-6) });
      const token = await calendarService.getOrCreateToken(member.id);

      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);
      expect(res.text).toContain(`UID:dinnerbears-event-${event.id}@dinnerbears.com`);
      expect(res.text).toContain('STATUS:CANCELLED');
      expect(res.text).toContain('[CANCELLED]');
    });

    it('folds a line longer than 75 octets', async () => {
      const longName = 'A'.repeat(120) + ' Location';
      await seedEvent({ locationName: longName });
      const token = await calendarService.getOrCreateToken(member.id);

      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);
      expect(res.text).toMatch(/SUMMARY:[^\r\n]*\r\n [^\r\n]+/);
    });

    it('rsvpOnly filters out events the member has not RSVPd to', async () => {
      const rsvpEvent = await seedEvent({ title: 'RSVPd Event' });
      await seedEvent({ title: 'Not RSVPd Event' });
      await dataSource.getRepository(EventRsvpEntity).save({ eventId: rsvpEvent.id, userId: member.id, status: RsvpStatus.GOING });
      await dataSource.getRepository(UserEntity).update(member.id, { calendarRsvpOnly: true });

      const token = await calendarService.getOrCreateToken(member.id);
      calendarService.invalidateForUser(member.id);
      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);

      expect(res.text).toContain(`UID:dinnerbears-event-${rsvpEvent.id}@dinnerbears.com`);
      const matches = res.text.match(/BEGIN:VEVENT/g) ?? [];
      expect(matches).toHaveLength(1);
    });

    it('cityFilter restricts the feed to the member\'s own city', async () => {
      const otherCity = await seedCity(dataSource);
      const otherLocation = await seedLocation(dataSource, otherCity.id);
      const otherCityEvent = await dataSource.getRepository(EventEntity).save(
        dataSource.getRepository(EventEntity).create({
          cityId: otherCity.id,
          locationId: otherLocation.id,
          locationName: otherLocation.name,
          locationAddress: otherLocation.address,
          createdById: admin.id,
          title: 'Other City Dinner',
          eventDate: dateOffset(14),
          eventTime: '18:30',
          status: EventStatus.PUBLISHED,
        }),
      );
      await seedEvent({ title: 'My City Dinner' });
      await dataSource.getRepository(UserEntity).update(member.id, { calendarCityFilter: 'city' });

      const token = await calendarService.getOrCreateToken(member.id);
      calendarService.invalidateForUser(member.id);
      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);

      expect(res.text).not.toContain(`UID:dinnerbears-event-${otherCityEvent.id}@dinnerbears.com`);
    });
  });

  describe('GET/PATCH /calendar/settings', () => {
    it('returns default settings with a feed URL', async () => {
      const res = await request(server).get('/api/v1/calendar/settings').set('Cookie', memberCookie).expect(200);
      expect(res.body.cityFilter).toBe('all');
      expect(res.body.rsvpOnly).toBeFalsy();
      expect(res.body.url).toContain('/calendar/feed.ics?token=');
    });

    it('updates settings and invalidates the cached feed', async () => {
      await seedEvent();
      const token = await calendarService.getOrCreateToken(member.id);
      await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);

      await request(server)
        .patch('/api/v1/calendar/settings')
        .set('Cookie', memberCookie)
        .send({ rsvpOnly: true, cityFilter: 'city' })
        .expect(200);

      const updated = await dataSource.getRepository(UserEntity).findOne({ where: { id: member.id } });
      expect(updated!.calendarRsvpOnly).toBeTruthy();
      expect(updated!.calendarCityFilter).toBe('city');

      // Cache should be invalidated — the event we RSVP'd to nothing for should now be filtered out
      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);
      expect(res.text).not.toContain('BEGIN:VEVENT');
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/calendar/settings').expect(401);
      await request(server).patch('/api/v1/calendar/settings').send({}).expect(401);
    });
  });

  describe('GET /calendar/token + GET /calendar/token/regenerate', () => {
    it('creates a token on first access', async () => {
      const res = await request(server).get('/api/v1/calendar/token').set('Cookie', memberCookie).expect(200);
      expect(res.body.url).toContain('/calendar/feed.ics?token=');

      const user = await dataSource.getRepository(UserEntity).findOne({ where: { id: member.id } });
      expect(user!.calendarToken).toBeTruthy();
    });

    it('regenerates the token, invalidating the old one', async () => {
      const oldToken = await calendarService.getOrCreateToken(member.id);
      await request(server).get('/api/v1/calendar/feed.ics').query({ token: oldToken }).expect(200);

      await request(server).get('/api/v1/calendar/token/regenerate').set('Cookie', memberCookie).expect(200);

      await request(server).get('/api/v1/calendar/feed.ics').query({ token: oldToken }).expect(401);

      const user = await dataSource.getRepository(UserEntity).findOne({ where: { id: member.id } });
      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token: user!.calendarToken }).expect(200);
      expect(res.text).toContain('BEGIN:VCALENDAR');
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/calendar/token').expect(401);
      await request(server).get('/api/v1/calendar/token/regenerate').expect(401);
    });
  });

  describe('POST /calendar/rsvp-reply', () => {
    function replyBody(eventId: number, partstat: string, email: string): string {
      return `BEGIN:VCALENDAR\r\nMETHOD:REPLY\r\nBEGIN:VEVENT\r\nUID:dinnerbears-event-${eventId}@dinnerbears.com\r\nATTENDEE;PARTSTAT=${partstat};CN=Reply Test:mailto:${email}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    }

    it('rejects a request with no secret header', async () => {
      await request(server).post('/api/v1/calendar/rsvp-reply').send({ raw: 'anything' }).expect(401);
    });

    it('rejects a request with the wrong secret', async () => {
      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', 'wrong-secret')
        .send({ raw: 'anything' })
        .expect(401);
    });

    it('accepts ACCEPTED and upserts a Going RSVP', async () => {
      const event = await seedEvent();

      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', CLOUDFLARE_SECRET)
        .send({ raw: replyBody(event.id, 'ACCEPTED', member.email) })
        .expect(200);

      const rsvp = await dataSource.getRepository(EventRsvpEntity).findOne({ where: { eventId: event.id, userId: member.id } });
      expect(rsvp!.status).toBe(RsvpStatus.GOING);
    });

    it('maps TENTATIVE to Maybe and DECLINED to Not Going', async () => {
      const event = await seedEvent();

      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', CLOUDFLARE_SECRET)
        .send({ raw: replyBody(event.id, 'TENTATIVE', member.email) })
        .expect(200);
      let rsvp = await dataSource.getRepository(EventRsvpEntity).findOne({ where: { eventId: event.id, userId: member.id } });
      expect(rsvp!.status).toBe(RsvpStatus.MAYBE);

      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', CLOUDFLARE_SECRET)
        .send({ raw: replyBody(event.id, 'DECLINED', member.email) })
        .expect(200);
      rsvp = await dataSource.getRepository(EventRsvpEntity).findOne({ where: { eventId: event.id, userId: member.id } });
      expect(rsvp!.status).toBe(RsvpStatus.NOT_GOING);
    });

    it('ignores an unrecognized PARTSTAT without error', async () => {
      const event = await seedEvent();

      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', CLOUDFLARE_SECRET)
        .send({ raw: replyBody(event.id, 'NEEDS-ACTION', member.email) })
        .expect(200);

      const rsvp = await dataSource.getRepository(EventRsvpEntity).findOne({ where: { eventId: event.id, userId: member.id } });
      expect(rsvp).toBeNull();
    });

    it('ignores a reply for an event that is not published', async () => {
      const draftEvent = await seedEvent({ status: EventStatus.DRAFT });

      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', CLOUDFLARE_SECRET)
        .send({ raw: replyBody(draftEvent.id, 'ACCEPTED', member.email) })
        .expect(200);

      const rsvp = await dataSource.getRepository(EventRsvpEntity).findOne({ where: { eventId: draftEvent.id, userId: member.id } });
      expect(rsvp).toBeNull();
    });

    it('ignores a reply from an email with no matching user', async () => {
      const event = await seedEvent();

      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', CLOUDFLARE_SECRET)
        .send({ raw: replyBody(event.id, 'ACCEPTED', 'nobody@example.test') })
        .expect(200);

      const count = await dataSource.getRepository(EventRsvpEntity).count({ where: { eventId: event.id } });
      expect(count).toBe(0);
    });

    it('ignores a malformed body with no iCal block', async () => {
      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', CLOUDFLARE_SECRET)
        .send({ raw: 'not an ical email at all' })
        .expect(200);
    });
  });

  describe('CalendarService.buildInviteAttachment (Phase 16b — direct call, no HTTP side effect to observe)', () => {
    it('builds a METHOD:REQUEST invite with an ATTENDEE RSVP line and a DTSTAMP', async () => {
      const event = { id: 1, locationName: 'Test Place', locationAddress: '123 Main St', eventDate: dateOffset(14), eventTime: '18:30', updatedAt: new Date() } as EventEntity;

      const ics = await calendarService.buildInviteAttachment(event, { name: 'Guest Name', email: 'guest@example.test' }, 'http://localhost:8081');

      expect(ics).toContain('METHOD:REQUEST');
      expect(ics).toContain(`UID:dinnerbears-event-${event.id}@dinnerbears.com`);
      expect(ics).toContain('ATTENDEE;CN=Guest Name;RSVP=TRUE:mailto:guest@example.test');
      // Derived from BASE_DOMAIN, which test/setup-env.ts sets to 'localhost'. It
      // was the literal production address until the de-branding commit made it
      // config-derived — unnoticed because the same commit made
      // buildInviteAttachment async without awaiting it here, which stopped this
      // whole FILE from compiling and so from running at all.
      expect(ics).toContain('ORGANIZER;CN=DinnerBears:mailto:calendar@localhost');
      expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
    });

    it('increments SEQUENCE on a repeat send for the same event, even when the event itself is unchanged', async () => {
      // Regression test: SEQUENCE used to be derived from event.updatedAt, so
      // re-confirming the same RSVP (toggling away and back to Going) resent
      // the exact same SEQUENCE every time — calendar clients had no signal
      // that a later email superseded an earlier one and created a duplicate
      // pending invitation per message instead of updating one in place.
      //
      // Two sends a second apart is all this can see, which is why it passed
      // throughout the 999999-second wrap that replaced the original bug with
      // a slower one. The monotonicity that actually matters is covered in
      // src/common/utils/ics-sequence.spec.ts.
      const event = { id: 2, locationName: 'Test Place', locationAddress: '123 Main St', eventDate: dateOffset(14), eventTime: '18:30', updatedAt: new Date() } as EventEntity;
      const recipient = { name: 'Guest Name', email: 'guest@example.test' };

      const first = await calendarService.buildInviteAttachment(event, recipient, 'http://localhost:8081');
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const second = await calendarService.buildInviteAttachment(event, recipient, 'http://localhost:8081');

      const extractSequence = (ics: string) => Number(ics.match(/SEQUENCE:(\d+)/)?.[1]);
      expect(extractSequence(second)).toBeGreaterThan(extractSequence(first));
    });
  });
});

import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser } from './utils/seed';
import { CityEntity } from '../src/database/entities/city.entity';
import { LocationEntity } from '../src/database/entities/location.entity';
import { UserEntity, UserRole } from '../src/database/entities/user.entity';
import { EventEntity, EventStatus } from '../src/database/entities/event.entity';
import { EventRsvpEntity, RsvpStatus } from '../src/database/entities/event-rsvp.entity';

const CLOUDFLARE_SECRET = 'test-cloudflare-email-secret-not-for-real-use';

// Calendar Accept/Maybe/Decline replies arrive as raw email through the
// Cloudflare Email Worker. Gmail sends the text/calendar part quoted-printable:
// BEGIN:VCALENDAR stays readable but every "=" becomes "=3D", which the parser
// used to reject — no Gmail reply was ever recorded.
describe('Calendar email replies (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Parameters<typeof request>[0];
  let city: CityEntity;
  let location: LocationEntity;
  let admin: UserEntity;
  let member: UserEntity;

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
    admin = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    member = await seedUser(dataSource, city.id, { email: 'larry@example.test' });
  });

  async function seedEvent(): Promise<EventEntity> {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const repo = dataSource.getRepository(EventEntity);
    return repo.save(
      repo.create({
        cityId: city.id,
        locationId: location.id,
        locationName: location.name,
        locationAddress: location.address,
        createdById: admin.id,
        title: 'Reply Test Dinner',
        eventDate: d.toISOString().slice(0, 10),
        eventTime: '18:30',
        status: EventStatus.PUBLISHED,
      }),
    );
  }

  // The shape of a real Gmail "Accepted:" reply, trimmed: quoted-printable
  // calendar part with =3D escapes, a UTF-8 name and a soft line break.
  function gmailReply(eventId: number, partstat: string, email: string): string {
    return [
      'From: Larry <' + email + '>',
      'To: calendar@dinnerbears.com',
      'Subject: Accepted: Dinner @ Tue Oct 20, 2026',
      'Content-Type: multipart/mixed; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Larry has accepted this invitation.',
      '--b1',
      'Content-Type: text/calendar; charset="UTF-8"; method=REPLY',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'BEGIN:VCALENDAR',
      'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
      'VERSION:2.0',
      'METHOD:REPLY',
      'BEGIN:VEVENT',
      'DTSTART:20261020T223000Z',
      `ATTENDEE;CUTYPE=3DINDIVIDUAL;ROLE=3DREQ-PARTICIPANT;PARTSTAT=3D${partstat};CN=3DLarry Mart=`,
      `=C3=ADn;X-NUM-GUESTS=3D0:mailto:${email}`,
      `UID:dinnerbears-event-${eventId}@dinnerbears.com`,
      'END:VEVENT',
      'END:VCALENDAR',
      '--b1--',
    ].join('\r\n');
  }

  const rsvpFor = (eventId: number) =>
    dataSource.getRepository(EventRsvpEntity).findOne({ where: { eventId, userId: member.id } });

  async function send(raw: string) {
    await request(server)
      .post('/api/v1/calendar/rsvp-reply')
      .set('X-Cloudflare-Secret', CLOUDFLARE_SECRET)
      .send({ raw })
      .expect(200);
  }

  it('records a Gmail (quoted-printable) Accept as Going', async () => {
    const event = await seedEvent();
    await send(gmailReply(event.id, 'ACCEPTED', member.email));
    expect((await rsvpFor(event.id))?.status).toBe(RsvpStatus.GOING);
  });

  it('records Gmail Maybe and Decline too', async () => {
    const event = await seedEvent();
    await send(gmailReply(event.id, 'TENTATIVE', member.email));
    expect((await rsvpFor(event.id))?.status).toBe(RsvpStatus.MAYBE);
    await send(gmailReply(event.id, 'DECLINED', member.email));
    expect((await rsvpFor(event.id))?.status).toBe(RsvpStatus.NOT_GOING);
  });

  it('still reads an unencoded reply (PARTSTAT=ACCEPTED is not mistaken for an escape)', async () => {
    const event = await seedEvent();
    await send(
      `BEGIN:VCALENDAR\r\nMETHOD:REPLY\r\nBEGIN:VEVENT\r\nUID:dinnerbears-event-${event.id}@dinnerbears.com\r\n` +
        `ATTENDEE;PARTSTAT=ACCEPTED;CN=Plain:mailto:${member.email}\r\nEND:VEVENT\r\nEND:VCALENDAR`,
    );
    expect((await rsvpFor(event.id))?.status).toBe(RsvpStatus.GOING);
  });
});

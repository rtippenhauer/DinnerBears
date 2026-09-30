import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { CityEntity } from '../src/database/entities/city.entity';
import { EventEntity } from '../src/database/entities/event.entity';
import { LocationEntity } from '../src/database/entities/location.entity';
import { UserEntity, UserRole } from '../src/database/entities/user.entity';
import { EmailService } from '../src/modules/email/email.service';

// v1.6.1: an event keeps its own copy of its location's name and address.
// Upcoming events must follow a location that's fixed later; past events keep
// what the place was called at the time.
describe('Event location details follow the location (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Parameters<typeof request>[0];
  let city: CityEntity;
  let location: LocationEntity;
  let admin: UserEntity;
  let adminCookie: string;
  let memberCookie: string;

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
    location = await seedLocation(dataSource, city.id, { name: 'Izzyâs Forest Park', address: '1198 Smiley Ave, Forest Park, OH 45240' });
    admin = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    const member = await seedUser(dataSource, city.id, { email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    memberCookie = await loginAs(app, member);
  });

  function date(offsetDays: number): string {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
  }

  async function createEvent(eventDate: string): Promise<number> {
    const res = await request(server)
      .post('/api/v1/events')
      .set('Cookie', adminCookie)
      .send({ cityId: city.id, locationId: location.id, title: 'Dinner', eventDate, eventTime: '18:30', status: 'published' })
      .expect(201);
    return res.body.id;
  }

  const saved = (id: number) => dataSource.getRepository(EventEntity).findOneByOrFail({ id });

  it('editing a location updates its upcoming events, not its past or cancelled ones', async () => {
    const upcoming = await createEvent(date(7));
    const today = await createEvent(date(0));
    const past = await createEvent(date(10));
    await dataSource.getRepository(EventEntity).update(past, { eventDate: date(-7) });
    const cancelled = await createEvent(date(14));
    await dataSource.getRepository(EventEntity).update(cancelled, { status: 'cancelled' as never });

    await request(server)
      .patch(`/api/v1/locations/${location.id}`)
      .set('Cookie', adminCookie)
      .send({ name: "Izzy's - Forest Park in Cincinnati" })
      .expect(200);

    expect((await saved(upcoming)).locationName).toBe("Izzy's - Forest Park in Cincinnati");
    expect((await saved(today)).locationName).toBe("Izzy's - Forest Park in Cincinnati");
    expect((await saved(past)).locationName).toBe('Izzyâs Forest Park');
    expect((await saved(cancelled)).locationName).toBe('Izzyâs Forest Park');

    const list = await request(server).get('/api/v1/events?upcoming=true').set('Cookie', memberCookie).expect(200);
    expect(list.body.find((e: { id: number }) => e.id === upcoming).locationName).toBe("Izzy's - Forest Park in Cincinnati");
  });

  it('saving an upcoming event re-copies its location — without emailing anyone', async () => {
    const id = await createEvent(date(7));
    await request(server).post(`/api/v1/events/${id}/rsvp`).set('Cookie', memberCookie).send({ status: 'going' }).expect(201);
    // The location was fixed some other way (e.g. directly in the database).
    await dataSource.getRepository(LocationEntity).update(location.id, {
      name: "Izzy's - Forest Park in Cincinnati",
      address: '1198 Smiley Ave, Cincinnati, OH 45240, USA',
    });

    const queue = jest.spyOn(app.get(EmailService), 'queue');
    await request(server).patch(`/api/v1/events/${id}`).set('Cookie', adminCookie).send({ title: 'Dinner at Izzy’s' }).expect(200);

    expect(await saved(id)).toMatchObject({
      locationName: "Izzy's - Forest Park in Cincinnati",
      locationAddress: '1198 Smiley Ave, Cincinnati, OH 45240, USA',
    });
    expect(queue).not.toHaveBeenCalled();
    queue.mockRestore();
  });

  it('saving a past event leaves its location details as they were', async () => {
    const id = await createEvent(date(7));
    await dataSource.getRepository(EventEntity).update(id, { eventDate: date(-7) });
    await dataSource.getRepository(LocationEntity).update(location.id, { name: 'Renamed Since' });

    await request(server).patch(`/api/v1/events/${id}`).set('Cookie', adminCookie).send({ title: 'Old dinner' }).expect(200);
    expect((await saved(id)).locationName).toBe('Izzyâs Forest Park');
  });
});

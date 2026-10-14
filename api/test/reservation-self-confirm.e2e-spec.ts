import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { CityEntity } from '../src/database/entities/city.entity';
import { LocationEntity } from '../src/database/entities/location.entity';
import { UserEntity, UserRole } from '../src/database/entities/user.entity';
import { EventEntity, EventStatus } from '../src/database/entities/event.entity';

// The member asked to make the reservation sees "I Made the Reservation" on
// the event page. It used to call the admin-only PATCH and fail with
// "Failed to update" for every ordinary member.
describe('Assignee confirms their own reservation (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Parameters<typeof request>[0];
  let city: CityEntity;
  let location: LocationEntity;
  let admin: UserEntity;
  let assignee: UserEntity;
  let assigneeCookie: string;
  let otherCookie: string;

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
    assignee = await seedUser(dataSource, city.id, { fullName: 'Larry Martin', email: 'larry@example.test' });
    const other = await seedUser(dataSource, city.id, { email: 'other@example.test' });
    assigneeCookie = await loginAs(app, assignee);
    otherCookie = await loginAs(app, other);
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
        title: 'Reservation Dinner',
        eventDate: d.toISOString().slice(0, 10),
        eventTime: '18:30',
        status: EventStatus.PUBLISHED,
        reservationAssigneeId: assignee.id,
      }),
    );
  }

  const saved = (id: number) => dataSource.getRepository(EventEntity).findOneByOrFail({ id });

  it('lets the assigned member mark the reservation made', async () => {
    const event = await seedEvent();
    await request(server).post(`/api/v1/events/${event.id}/reservation/confirm`).set('Cookie', assigneeCookie).expect(201);

    const row = await saved(event.id);
    expect(Boolean(row.reservationConfirmed)).toBe(true);
    expect(row.reservationConfirmedBy).toBe('Larry Martin');
  });

  it('refuses any other member, and leaves the reservation unconfirmed', async () => {
    const event = await seedEvent();
    await request(server).post(`/api/v1/events/${event.id}/reservation/confirm`).set('Cookie', otherCookie).expect(403);
    expect(Boolean((await saved(event.id)).reservationConfirmed)).toBe(false);
  });

  it('requires a login', async () => {
    const event = await seedEvent();
    await request(server).post(`/api/v1/events/${event.id}/reservation/confirm`).expect(401);
  });

  it('still keeps the full reservation PATCH admin/moderator-only', async () => {
    const event = await seedEvent();
    await request(server)
      .patch(`/api/v1/events/${event.id}/reservation`)
      .set('Cookie', assigneeCookie)
      .send({ confirmed: true })
      .expect(403);
  });
});

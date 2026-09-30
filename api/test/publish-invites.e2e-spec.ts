import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { CityEntity } from '../src/database/entities/city.entity';
import { LocationEntity } from '../src/database/entities/location.entity';
import { UserRole } from '../src/database/entities/user.entity';
import { EmailService } from '../src/modules/email/email.service';

// Members who set Manage Calendar → auto-invite get an email + calendar
// invite when an event is published — whether it was published from a draft
// or created already published (the second path used to send nothing).
describe('Auto-invites on publish (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Parameters<typeof request>[0];
  let city: CityEntity;
  let otherCity: CityEntity;
  let location: LocationEntity;
  let adminCookie: string;
  let sendNow: jest.SpyInstance;

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
    otherCity = await seedCity(dataSource);
    location = await seedLocation(dataSource, city.id);
    const admin = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    adminCookie = await loginAs(app, admin);
    await seedUser(dataSource, otherCity.id, { fullName: 'Larry All', email: 'larry@example.test', calendarAutoInvite: 'all' });
    await seedUser(dataSource, city.id, { fullName: 'Cindy City', email: 'cindy@example.test', calendarAutoInvite: 'city' });
    await seedUser(dataSource, otherCity.id, { fullName: 'Other City', email: 'other@example.test', calendarAutoInvite: 'city' });
    await seedUser(dataSource, city.id, { fullName: 'No Invites', email: 'none@example.test', calendarAutoInvite: 'none' });
    sendNow = jest.spyOn(app.get(EmailService), 'sendNow').mockResolvedValue(undefined);
  });

  afterEach(() => sendNow.mockRestore());

  function futureDate(days = 14): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  async function createEvent(status: 'draft' | 'published'): Promise<number> {
    const res = await request(server)
      .post('/api/v1/events')
      .set('Cookie', adminCookie)
      .send({ cityId: city.id, locationId: location.id, title: 'Dinner', eventDate: futureDate(), eventTime: '18:30', status })
      .expect(201);
    return res.body.id;
  }

  // Invites are sent in the background; give them a moment.
  async function invitedEmails(): Promise<string[]> {
    for (let i = 0; i < 20 && sendNow.mock.calls.length < 2; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 200));
    return sendNow.mock.calls.map(([dto]) => (dto as { toEmail: string }).toEmail).sort();
  }

  it('invites "all" and same-city members when an event is created already published', async () => {
    await createEvent('published');
    expect(await invitedEmails()).toEqual(['cindy@example.test', 'larry@example.test']);
  });

  it('still invites when a draft is published', async () => {
    const id = await createEvent('draft');
    await new Promise((r) => setTimeout(r, 300));
    expect(sendNow).not.toHaveBeenCalled();

    await request(server).patch(`/api/v1/events/${id}`).set('Cookie', adminCookie).send({ status: 'published' }).expect(200);
    expect(await invitedEmails()).toEqual(['cindy@example.test', 'larry@example.test']);
  });

  it('sends nothing for an event created as a draft', async () => {
    await createEvent('draft');
    await new Promise((r) => setTimeout(r, 500));
    expect(sendNow).not.toHaveBeenCalled();
  });
});

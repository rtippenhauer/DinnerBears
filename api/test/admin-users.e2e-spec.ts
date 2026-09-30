import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { CityEntity } from '../src/database/entities/city.entity';
import { UserRole } from '../src/database/entities/user.entity';

describe('Admin User Management (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Parameters<typeof request>[0];

  let city: CityEntity;
  let adminCookie: string;
  let moderatorCookie: string;
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
    city = await seedCity(dataSource);

    const admin = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    const moderator = await seedUser(dataSource, city.id, { role: UserRole.MODERATOR, email: 'mod@example.test' });
    const member = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    moderatorCookie = await loginAs(app, moderator);
    memberCookie = await loginAs(app, member);
  });

  describe('GET /admin/users (read list)', () => {
    it('lists users when authenticated as admin', async () => {
      const res = await request(server).get('/api/v1/admin/users').set('Cookie', adminCookie).expect(200);
      expect(res.body.some((u: { email: string }) => u.email === 'member@example.test')).toBe(true);
    });

    it('lists users when authenticated as moderator', async () => {
      await request(server).get('/api/v1/admin/users').set('Cookie', moderatorCookie).expect(200);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/admin/users').expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      await request(server).get('/api/v1/admin/users').set('Cookie', memberCookie).expect(403);
    });
  });

  describe('POST /admin/users/:id/ban and /unban (update status)', () => {
    it('bans a member when authenticated as admin', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'target@example.test' });

      await request(server).post(`/api/v1/admin/users/${target.id}/ban`).set('Cookie', adminCookie).expect(200);

      const res = await request(server).get('/api/v1/admin/users').set('Cookie', adminCookie).expect(200);
      const banned = res.body.find((u: { id: number }) => u.id === target.id);
      expect(banned.status).toBe('suspended');
    });

    it('bans a member when authenticated as moderator', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'target@example.test' });

      await request(server).post(`/api/v1/admin/users/${target.id}/ban`).set('Cookie', moderatorCookie).expect(200);
    });

    it('rejects a moderator banning another moderator', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.MODERATOR, email: 'target@example.test' });

      await request(server).post(`/api/v1/admin/users/${target.id}/ban`).set('Cookie', moderatorCookie).expect(403);
    });

    it('rejects banning an admin', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, email: 'target@example.test' });

      await request(server).post(`/api/v1/admin/users/${target.id}/ban`).set('Cookie', adminCookie).expect(403);
    });

    it('rejects banning yourself', async () => {
      const admin = await request(server).get('/api/v1/admin/users').set('Cookie', adminCookie).expect(200);
      const self = admin.body.find((u: { email: string }) => u.email === 'admin@example.test');

      await request(server).post(`/api/v1/admin/users/${self.id}/ban`).set('Cookie', adminCookie).expect(400);
    });

    it('rejects banning an already-banned user', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'target@example.test' });
      await request(server).post(`/api/v1/admin/users/${target.id}/ban`).set('Cookie', adminCookie).expect(200);

      await request(server).post(`/api/v1/admin/users/${target.id}/ban`).set('Cookie', adminCookie).expect(400);
    });

    it('returns 404 banning a nonexistent user', async () => {
      await request(server).post('/api/v1/admin/users/999999/ban').set('Cookie', adminCookie).expect(404);
    });

    it('rejects unauthenticated ban requests', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'target@example.test' });
      await request(server).post(`/api/v1/admin/users/${target.id}/ban`).expect(401);
    });

    it('rejects ban requests from a member (insufficient role)', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'target@example.test' });
      await request(server).post(`/api/v1/admin/users/${target.id}/ban`).set('Cookie', memberCookie).expect(403);
    });

    it('unbans a suspended user when authenticated as admin', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'target@example.test' });
      await request(server).post(`/api/v1/admin/users/${target.id}/ban`).set('Cookie', adminCookie).expect(200);

      await request(server).post(`/api/v1/admin/users/${target.id}/unban`).set('Cookie', adminCookie).expect(200);

      const res = await request(server).get('/api/v1/admin/users').set('Cookie', adminCookie).expect(200);
      const unbanned = res.body.find((u: { id: number }) => u.id === target.id);
      expect(unbanned.status).toBe('active');
    });

    it('rejects unbanning a user who is not banned', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'target@example.test' });
      await request(server).post(`/api/v1/admin/users/${target.id}/unban`).set('Cookie', adminCookie).expect(400);
    });

    it('rejects unban requests from a moderator (admin-only)', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'target@example.test' });
      await request(server).post(`/api/v1/admin/users/${target.id}/ban`).set('Cookie', adminCookie).expect(200);

      await request(server).post(`/api/v1/admin/users/${target.id}/unban`).set('Cookie', moderatorCookie).expect(403);
    });
  });

  describe('POST /admin/users/:id/role (update role)', () => {
    it('changes a member\'s role when authenticated as admin', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'target@example.test' });

      await request(server)
        .post(`/api/v1/admin/users/${target.id}/role`)
        .set('Cookie', adminCookie)
        .send({ role: 'moderator' })
        .expect(200);

      const res = await request(server).get('/api/v1/admin/users').set('Cookie', adminCookie).expect(200);
      const updated = res.body.find((u: { id: number }) => u.id === target.id);
      expect(updated.role).toBe('moderator');
    });

    it('rejects promoting a user directly to admin', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'target@example.test' });

      await request(server)
        .post(`/api/v1/admin/users/${target.id}/role`)
        .set('Cookie', adminCookie)
        .send({ role: 'admin' })
        .expect(403);
    });

    it('rejects changing an admin\'s role', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, email: 'target@example.test' });

      await request(server)
        .post(`/api/v1/admin/users/${target.id}/role`)
        .set('Cookie', adminCookie)
        .send({ role: 'member' })
        .expect(403);
    });

    it('allows promoting the automation account to admin', async () => {
      const automation = await seedUser(dataSource, city.id, {
        role: UserRole.AUTOMATION,
        email: 'automation@dinnerbears.internal',
        isAutomationAccount: true,
      });

      await request(server)
        .post(`/api/v1/admin/users/${automation.id}/role`)
        .set('Cookie', adminCookie)
        .send({ role: 'admin' })
        .expect(200);
    });

    it('allows flipping the automation account back down from admin', async () => {
      const automation = await seedUser(dataSource, city.id, {
        role: UserRole.ADMIN,
        email: 'automation@dinnerbears.internal',
        isAutomationAccount: true,
      });

      await request(server)
        .post(`/api/v1/admin/users/${automation.id}/role`)
        .set('Cookie', adminCookie)
        .send({ role: 'automation' })
        .expect(200);

      const res = await request(server).get('/api/v1/admin/users').set('Cookie', adminCookie).expect(200);
      const updated = res.body.find((u: { id: number }) => u.id === automation.id);
      expect(updated.role).toBe('automation');
    });

    it('rejects changing your own role', async () => {
      const admin = await request(server).get('/api/v1/admin/users').set('Cookie', adminCookie).expect(200);
      const self = admin.body.find((u: { email: string }) => u.email === 'admin@example.test');

      await request(server)
        .post(`/api/v1/admin/users/${self.id}/role`)
        .set('Cookie', adminCookie)
        .send({ role: 'moderator' })
        .expect(400);
    });

    it('returns 404 for a nonexistent user', async () => {
      await request(server)
        .post('/api/v1/admin/users/999999/role')
        .set('Cookie', adminCookie)
        .send({ role: 'moderator' })
        .expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'target@example.test' });
      await request(server)
        .post(`/api/v1/admin/users/${target.id}/role`)
        .send({ role: 'moderator' })
        .expect(401);
    });

    it('rejects requests from a moderator (admin-only)', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'target@example.test' });
      await request(server)
        .post(`/api/v1/admin/users/${target.id}/role`)
        .set('Cookie', moderatorCookie)
        .send({ role: 'moderator' })
        .expect(403);
    });
  });

  describe('DELETE /admin/users/:id', () => {
    it('deletes a member when authenticated as admin', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'target@example.test' });

      await request(server).delete(`/api/v1/admin/users/${target.id}`).set('Cookie', adminCookie).expect(204);

      const res = await request(server).get('/api/v1/admin/users').set('Cookie', adminCookie).expect(200);
      expect(res.body.some((u: { id: number }) => u.id === target.id)).toBe(false);
    });

    it('rejects deleting an admin', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, email: 'target@example.test' });
      await request(server).delete(`/api/v1/admin/users/${target.id}`).set('Cookie', adminCookie).expect(403);
    });

    it('rejects deleting yourself', async () => {
      const admin = await request(server).get('/api/v1/admin/users').set('Cookie', adminCookie).expect(200);
      const self = admin.body.find((u: { email: string }) => u.email === 'admin@example.test');

      await request(server).delete(`/api/v1/admin/users/${self.id}`).set('Cookie', adminCookie).expect(400);
    });

    it('returns 404 for a nonexistent user', async () => {
      await request(server).delete('/api/v1/admin/users/999999').set('Cookie', adminCookie).expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'target@example.test' });
      await request(server).delete(`/api/v1/admin/users/${target.id}`).expect(401);
    });

    it('rejects requests from a moderator (admin-only)', async () => {
      const target = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'target@example.test' });
      await request(server).delete(`/api/v1/admin/users/${target.id}`).set('Cookie', moderatorCookie).expect(403);
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, seedCooperative, seedSuperAdmin, cookieFor, TEST_PASSWORD, models } from './helpers.js';
import app from '../../server/app.js';
import { asSystem } from '../../server/context.js';

let A; let superAdmin;
const as = (user) => ({
  get: (path) => request(app).get(path).set('Cookie', cookieFor(user)),
  post: (path, body) => request(app).post(path).set('Cookie', cookieFor(user)).send(body),
  patch: (path, body) => request(app).patch(path).set('Cookie', cookieFor(user)).send(body),
});

beforeAll(async () => {
  await startDb();
  A = await seedCooperative('Alpha', 'ALP', { capacityLimit: 2000 });
  superAdmin = await seedSuperAdmin();
}, 120_000);
afterAll(stopDb);

describe('sign-in', () => {
  it('accepts an email or a mobile number and sets an httpOnly cookie', async () => {
    const byEmail = await request(app).post('/api/auth/login').send({ login: 'admin@alp.test', password: TEST_PASSWORD }).expect(200);
    expect(byEmail.body.user).toMatchObject({ name: 'Alpha Admin', roleLabel: 'Cooperative Admin', cooperativeName: 'Alpha' });
    expect(byEmail.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(JSON.stringify(byEmail.body)).not.toMatch(/passwordHash/);

    const byPhone = await request(app).post('/api/auth/login').send({ login: A.farmer.phone, password: TEST_PASSWORD }).expect(200);
    expect(byPhone.body.user.roleLabel).toBe('Farmer/Member');
  });

  it('rejects a wrong password, an unknown user, and an inactive user', async () => {
    await request(app).post('/api/auth/login').send({ login: 'admin@alp.test', password: 'wrong' }).expect(401);
    await request(app).post('/api/auth/login').send({ login: 'nobody@alp.test', password: TEST_PASSWORD }).expect(401);
    await asSystem(() => models.User.updateOne({ _id: A.staff._id }, { active: false }));
    await request(app).post('/api/auth/login').send({ login: 'staff@alp.test', password: TEST_PASSWORD }).expect(401);
    await asSystem(() => models.User.updateOne({ _id: A.staff._id }, { active: true }));
  });

  it('blocks sign-in when the cooperative is suspended', async () => {
    await models.Cooperative.updateOne({ _id: A.coop._id }, { status: 'suspended' });
    await request(app).post('/api/auth/login').send({ login: 'admin@alp.test', password: TEST_PASSWORD }).expect(403);
    await models.Cooperative.updateOne({ _id: A.coop._id }, { status: 'active' });
  });

  it('requires a valid session', async () => {
    await request(app).get('/api/members').expect(401);
    await request(app).get('/api/members').set('Cookie', 'onionet_session=not-a-token').expect(401);
  });
});

describe('roles', () => {
  it('Cooperative Staff can work with farmers but cannot change the layout', async () => {
    await as(A.staff).get('/api/members').expect(200);
    await as(A.staff).get('/api/quadrants').expect(200);
    await as(A.staff).post('/api/quadrants', { code: '1-B', floor: 1, capacity: 100, fillOrder: 2 }).expect(403);
    await as(A.staff).patch(`/api/quadrants/${A.records.Quadrant._id}`, { capacity: 5 }).expect(403);
  });

  it('Cooperative Admin can change the layout', async () => {
    await as(A.admin).post('/api/quadrants', { code: '1-B', floor: 1, capacity: 500, fillOrder: 2 }).expect(201);
  });

  it('Farmers cannot reach staff routes', async () => {
    for (const path of ['/api/members', '/api/batches', '/api/sacks', '/api/tags', '/api/transactions', '/api/quadrants', '/api/cooperative']) {
      await as(A.farmer).get(path).expect(403);
    }
  });

  it('only the Super Admin reaches /admin, and has no access to farmer data', async () => {
    await as(A.admin).get('/api/admin/cooperatives').expect(403);
    await as(A.staff).get('/api/admin/cooperatives').expect(403);
    const res = await as(superAdmin).get('/api/admin/cooperatives').expect(200);
    expect(res.body.cooperatives.map((c) => c.name)).toContain('Alpha');
    await as(superAdmin).get('/api/members').expect(403);
  });
});

describe('plan capacity limit', () => {
  it('blocks a layout that holds more sacks than the plan allows', async () => {
    // Limit 2,000; layout so far: 1-A 1,250 + 1-B 500.
    const tooBig = await as(A.admin).post('/api/quadrants', { code: '1-C', floor: 1, capacity: 251, fillOrder: 3 }).expect(400);
    expect(tooBig.body.error).toMatch(/plan allows 2,000/);
    await as(A.admin).post('/api/quadrants', { code: '1-C', floor: 1, capacity: 250, fillOrder: 3 }).expect(201);
    await as(A.admin).patch(`/api/quadrants/${A.records.Quadrant._id}`, { capacity: 1251 }).expect(400);
    await as(A.admin).patch(`/api/quadrants/${A.records.Quadrant._id}`, { capacity: 1000 }).expect(200);
  });
});

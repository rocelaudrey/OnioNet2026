import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, seedCooperative, seedSuperAdmin, cookieFor, models } from './helpers.js';
import app from '../../server/app.js';
import { asSystem } from '../../server/context.js';

const DAY = 86_400_000;
let A; let B; let owner; let created;
const sys = (fn) => asSystem(fn);
const post = (user, path, body) => request(app).post(path).set('Cookie', cookieFor(user)).send(body);
const patch = (user, path, body) => request(app).patch(path).set('Cookie', cookieFor(user)).send(body);
const get = (user, path) => request(app).get(path).set('Cookie', cookieFor(user));
const login = (name, password) => request(app).post('/api/auth/login').send({ login: name, password });
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const onboarding = (over = {}) => ({
  name: 'Charlie Growers', facilityName: 'Charlie Cold Storage', address: 'Bambang, Nueva Vizcaya', tagPrefix: 'chg',
  contractMonths: 4,
  subscription: { plan: 'starter', status: 'active', endsAt: ymd(new Date(Date.now() + 20 * DAY)), capacityLimit: 5000, enabledFeatures: ['farmer_portal', 'pdf_reports'] },
  layout: { floors: 2, perFloor: 2, capacityEach: 1000 },
  admin: { name: 'Carla Admin', email: 'carla@charlie.test' },
  ...over,
});

beforeAll(async () => {
  await startDb();
  A = await seedCooperative('Alpha', 'ALP');
  B = await seedCooperative('Bravo', 'BRV');
  owner = await seedSuperAdmin();
}, 120_000);
afterAll(stopDb);

describe('Super Admin access', () => {
  it('is for the Super Admin only', async () => {
    for (const user of [A.admin, A.staff, A.farmer]) {
      await get(user, '/api/admin/overview').expect(403);
      await post(user, '/api/admin/cooperatives', onboarding()).expect(403);
    }
  });

  it('cannot open farmer or cooperative pages meant for cooperative users', async () => {
    for (const path of ['/api/members', '/api/batches', '/api/reports/members', '/api/transactions', '/api/dashboard', '/api/me/summary']) {
      await get(owner, path).expect(403);
    }
  });
});

describe('onboarding a cooperative', () => {
  it('creates the cooperative, its layout, and its first admin with a one-time password', async () => {
    const res = await post(owner, '/api/admin/cooperatives', onboarding()).expect(201);
    created = res.body;
    expect(created.cooperative.name).toBe('Charlie Growers');
    expect(created.admin).toEqual({ name: 'Carla Admin', email: 'carla@charlie.test', phone: '' });
    expect(created.temporaryPassword).toMatch(/^[A-Za-z0-9]{10}$/);

    const coop = await models.Cooperative.findById(created.cooperative.id).lean();
    expect(coop).toMatchObject({ status: 'active', settings: { tagPrefix: 'CHG', contractMonths: 4 } });
    expect(coop.subscription).toMatchObject({ plan: 'starter', status: 'active', capacityLimit: 5000, enabledFeatures: ['farmer_portal', 'pdf_reports'] });
    const quadrants = await sys(() => models.Quadrant.find({ cooperativeId: coop._id }).sort('fillOrder').lean());
    expect(quadrants.map((q) => q.code)).toEqual(['1-A', '1-B', '2-A', '2-B']);
    expect(JSON.stringify(await sys(() => models.AuditLog.find({ entityType: 'Cooperative', action: 'create' }).lean()))).not.toContain(created.temporaryPassword);
  });

  it('lets the new admin sign in, change the password, and see only their cooperative', async () => {
    const first = await login('carla@charlie.test', created.temporaryPassword).expect(200);
    expect(first.body.user).toMatchObject({ cooperativeName: 'Charlie Growers', roleLabel: 'Cooperative Admin', mustChangePassword: true });
    const cookie = first.headers['set-cookie'][0].split(';')[0];
    await request(app).post('/api/auth/change-password').set('Cookie', cookie).send({ currentPassword: created.temporaryPassword, newPassword: 'charlie-admin-pass' }).expect(200);
    const quads = (await request(app).get('/api/quadrants').set('Cookie', cookie).expect(200)).body;
    expect(quads.capacityLimit).toBe(5000);
    expect(quads.quadrants).toHaveLength(4);
    expect((await request(app).get('/api/members').set('Cookie', cookie).expect(200)).body.members).toEqual([]);
    // The onboarding entry is also in the new cooperative's own audit log.
    const log = (await request(app).post('/api/audit-logs/search').set('Cookie', cookie).send({ entityType: 'Cooperative' }).expect(200)).body.entries;
    expect(log[0]).toMatchObject({ action: 'create', actorName: 'Platform Owner', entityLabel: 'Charlie Growers' });
  });

  it('rejects a taken or bad tag prefix, a layout bigger than the plan, and a missing admin', async () => {
    expect((await post(owner, '/api/admin/cooperatives', onboarding({ tagPrefix: 'alp', admin: { name: 'X', email: 'x1@x.test' } })).expect(409)).body.error).toMatch(/tag prefix/);
    await post(owner, '/api/admin/cooperatives', onboarding({ tagPrefix: 'A', admin: { name: 'X', email: 'x2@x.test' } })).expect(400);
    await post(owner, '/api/admin/cooperatives', onboarding({ tagPrefix: 'TOOLONG1', admin: { name: 'X', email: 'x3@x.test' } })).expect(400);
    expect((await post(owner, '/api/admin/cooperatives', onboarding({ tagPrefix: 'DLT', layout: { floors: 2, perFloor: 4, capacityEach: 1000 }, admin: { name: 'X', email: 'x4@x.test' } })).expect(400)).body.error)
      .toBe('This layout holds 8,000 sacks, but the plan allows 5,000.');
    await post(owner, '/api/admin/cooperatives', onboarding({ tagPrefix: 'DLT', admin: { name: 'X' } })).expect(400);
    expect((await post(owner, '/api/admin/cooperatives', onboarding({ tagPrefix: 'DLT', admin: { name: 'X', email: 'carla@charlie.test' } })).expect(409)).body.error).toMatch(/email or mobile/);
    // Nothing half-made was left behind.
    expect(await models.Cooperative.countDocuments({ 'settings.tagPrefix': 'DLT' })).toBe(0);
  });

  it('can start with no layout, which the cooperative admin sets up later', async () => {
    const res = await post(owner, '/api/admin/cooperatives', onboarding({ name: 'Delta', tagPrefix: 'DLT', layout: undefined, admin: { name: 'Dina', phone: '09171230000' } })).expect(201);
    expect(await sys(() => models.Quadrant.countDocuments({ cooperativeId: res.body.cooperative.id }))).toBe(0);
  });
});

describe('overview', () => {
  it('totals every cooperative with counts only, never farmer details', async () => {
    const o = (await get(owner, '/api/admin/overview').expect(200)).body;
    expect(o.totals).toMatchObject({ cooperatives: 4, active: 4, suspended: 0 });
    const alpha = o.cooperatives.find((c) => c.name === 'Alpha');
    expect(alpha).toMatchObject({ tagPrefix: 'ALP', capacity: 1250, sacksStored: 1, activeFarmers: 1, activeTeam: 2 });
    expect(o.totals.sacksStored).toBe(2); // Alpha and Bravo each have one seeded sack
    expect(o.totals.capacity).toBe(1250 + 1250 + 4000);
    const everything = JSON.stringify(o);
    expect(everything).not.toMatch(/Juan|ALP-M-|passwordHash|09\d{9}/);
  });

  it('lists plans ending within 30 days, and plans that have already ended', async () => {
    await models.Cooperative.updateOne({ _id: B.coop._id }, { 'subscription.endsAt': new Date(Date.now() - 2 * DAY), 'subscription.status': 'active' });
    const o = (await get(owner, '/api/admin/overview').expect(200)).body;
    expect(o.endingSoon.map((c) => c.name)).toEqual(['Bravo', 'Charlie Growers', 'Delta']);
    expect(o.endingSoon[0].subscription).toMatchObject({ ended: true, endingSoon: false });
    expect(o.endingSoon[1].subscription).toMatchObject({ endingSoon: true, ended: false });
    expect(o.totals).toMatchObject({ endingSoon: 2, ended: 1 });
  });
});

describe('managing a cooperative', () => {
  it('shows a cooperative with its admins, never its farmers', async () => {
    const d = (await get(owner, `/api/admin/cooperatives/${A.coop._id}`).expect(200)).body;
    expect(d.cooperative).toMatchObject({ name: 'Alpha', tagPrefix: 'ALP' });
    expect(d.admins.map((a) => a.name)).toEqual(['Alpha Admin']);
    expect(JSON.stringify(d)).not.toMatch(/Juan|Alpha Staff|passwordHash/);
    await get(owner, '/api/admin/cooperatives/not-an-id').expect(404);
  });

  it('suspends a cooperative, which stops its users signing in, and reactivates it', async () => {
    await patch(owner, `/api/admin/cooperatives/${A.coop._id}`, { status: 'suspended' }).expect(200);
    await login('admin@alp.test', 'correct-horse-battery').expect(403);
    await patch(owner, `/api/admin/cooperatives/${A.coop._id}`, { status: 'paused' }).expect(400);
    await patch(owner, `/api/admin/cooperatives/${A.coop._id}`, { status: 'active', facilityName: 'Alpha Cold Storage 2' }).expect(200);
    await login('admin@alp.test', 'correct-horse-battery').expect(200);
    const platform = await sys(() => models.AuditLog.find({ cooperativeId: null, entityType: 'Cooperative', action: 'update' }).lean());
    expect(platform.length).toBe(2);
    const theirs = await sys(() => models.AuditLog.find({ cooperativeId: A.coop._id, entityType: 'Cooperative', action: 'update' }).lean());
    expect(theirs.at(-1).changes).toEqual(expect.arrayContaining([{ field: 'status', from: 'suspended', to: 'active' }]));
  });

  it('changes a subscription, and will not set a limit below the layout already built', async () => {
    const res = await patch(owner, `/api/admin/cooperatives/${A.coop._id}/subscription`, {
      plan: 'pro', capacityLimit: 20000, enabledFeatures: ['farmer_portal', 'tag_import', 'tag_import'], endsAt: ymd(new Date(Date.now() + 365 * DAY)),
    }).expect(200);
    expect(res.body.cooperative.subscription).toMatchObject({ plan: 'pro', capacityLimit: 20000, enabledFeatures: ['farmer_portal', 'tag_import'], endingSoon: false });
    expect((await patch(owner, `/api/admin/cooperatives/${A.coop._id}/subscription`, { capacityLimit: 1000 }).expect(400)).body.error)
      .toBe("This cooperative's layout already holds 1,250 sacks. The limit cannot be lower than that.");
    await patch(owner, `/api/admin/cooperatives/${A.coop._id}/subscription`, { enabledFeatures: ['teleport'] }).expect(400);
    await patch(owner, `/api/admin/cooperatives/${A.coop._id}/subscription`, { status: 'free' }).expect(400);
    await patch(owner, `/api/admin/cooperatives/${A.coop._id}/subscription`, { startedAt: '2027-01-01', endsAt: '2026-01-01' }).expect(400);
    // The cooperative feels it at once: its features and its layout limit.
    const me = (await get(A.admin, '/api/auth/me')).body.user;
    expect(me.features).toEqual(['farmer_portal', 'tag_import']);
    const log = await sys(() => models.AuditLog.findOne({ cooperativeId: A.coop._id, entityType: 'Subscription' }).lean());
    expect(log.changes.map((c) => c.field)).toEqual(expect.arrayContaining(['plan', 'capacityLimit', 'enabledFeatures', 'endsAt']));
  });

  it('adds another cooperative admin and resets a locked-out admin\'s password', async () => {
    const added = await post(owner, `/api/admin/cooperatives/${A.coop._id}/admins`, { name: 'Second Admin', phone: '09178880000' }).expect(201);
    await login('09178880000', added.body.temporaryPassword).expect(200);
    await post(owner, `/api/admin/cooperatives/${A.coop._id}/admins`, { name: 'Dup', email: 'staff@alp.test' }).expect(409);

    const reset = await post(owner, `/api/admin/cooperatives/${A.coop._id}/admins/${A.admin._id}/reset-password`).expect(200);
    await login('admin@alp.test', 'correct-horse-battery').expect(401);
    expect((await login('admin@alp.test', reset.body.temporaryPassword).expect(200)).body.user.mustChangePassword).toBe(true);
    // Only admins: not staff, not farmer logins, not another cooperative's admin.
    await post(owner, `/api/admin/cooperatives/${A.coop._id}/admins/${A.staff._id}/reset-password`).expect(404);
    await post(owner, `/api/admin/cooperatives/${A.coop._id}/admins/${A.farmer._id}/reset-password`).expect(404);
    await post(owner, `/api/admin/cooperatives/${A.coop._id}/admins/${B.admin._id}/reset-password`).expect(404);
  });

  it('cooperative admins cannot change their own plan', async () => {
    await patch(A.admin, '/api/cooperative', { subscription: { capacityLimit: 999999 } }).expect(200);
    expect((await models.Cooperative.findById(A.coop._id).lean()).subscription.capacityLimit).toBe(20000);
    await patch(A.admin, `/api/admin/cooperatives/${A.coop._id}/subscription`, { capacityLimit: 999999 }).expect(403);
  });
});

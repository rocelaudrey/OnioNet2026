import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, seedCooperative, seedSuperAdmin, cookieFor, TEST_PASSWORD, models } from './helpers.js';
import app from '../../server/app.js';
import { asSystem } from '../../server/context.js';

let A; let B; let superAdmin;
const as = (user) => {
  const call = (method) => (path, body) => request(app)[method](path).set('Cookie', cookieFor(user)).send(body);
  return { get: call('get'), post: call('post'), patch: call('patch') };
};
const login = (name, password) => request(app).post('/api/auth/login').send({ login: name, password });
const audits = (filter) => asSystem(() => models.AuditLog.find(filter).sort('occurredAt').lean());

beforeAll(async () => {
  await startDb();
  A = await seedCooperative('Alpha', 'ALP');
  B = await seedCooperative('Bravo', 'BRV');
  superAdmin = await seedSuperAdmin();
}, 120_000);
afterAll(stopDb);

describe('Settings > Fees', () => {
  it('starts with both built-in fees at zero and no discount', async () => {
    const res = await as(A.staff).get('/api/cooperative/fees').expect(200);
    expect(res.body.fees).toEqual({ storageFeeCentavos: 0, overdueFeePerDayCentavos: 0, memberDiscountPercent: 0, added: [] });
  });

  it('lets the admin edit the built-in fees and the member discount, with an audit trail', async () => {
    const res = await as(A.admin).patch('/api/cooperative/fees', {
      storageFeeCentavos: 15000, overdueFeePerDayCentavos: 150, memberDiscountPercent: 10,
    }).expect(200);
    expect(res.body.fees).toMatchObject({ storageFeeCentavos: 15000, overdueFeePerDayCentavos: 150, memberDiscountPercent: 10 });

    const [log] = await audits({ entityType: 'Fees' });
    expect(String(log.cooperativeId)).toBe(String(A.coop._id));
    expect(log.actorName).toBe('Alpha Admin');
    expect(log.changes).toEqual([
      { field: 'storageFeeCentavos', from: 0, to: 15000 },
      { field: 'overdueFeePerDayCentavos', from: 0, to: 150 },
      { field: 'memberDiscountPercent', from: 0, to: 10 },
    ]);
  });

  it('allows the overdue fee to be zero and writes no audit entry when nothing changed', async () => {
    await as(A.admin).patch('/api/cooperative/fees', { overdueFeePerDayCentavos: 0 }).expect(200);
    const before = (await audits({ entityType: 'Fees' })).length;
    await as(A.admin).patch('/api/cooperative/fees', { overdueFeePerDayCentavos: 0 }).expect(200);
    expect((await audits({ entityType: 'Fees' })).length).toBe(before);
  });

  it('rejects amounts that are not whole centavos, negative amounts, and bad discounts', async () => {
    for (const body of [
      { storageFeeCentavos: 10.5 }, { storageFeeCentavos: -1 }, { storageFeeCentavos: '100' },
      { overdueFeePerDayCentavos: -5 }, { memberDiscountPercent: 101 }, { memberDiscountPercent: -1 },
    ]) {
      await as(A.admin).patch('/api/cooperative/fees', body).expect(400);
    }
  });

  it('does not let staff or farmers change fees', async () => {
    await as(A.staff).patch('/api/cooperative/fees', { storageFeeCentavos: 1 }).expect(403);
    await as(A.staff).post('/api/cooperative/fees/added', { name: 'X', amountCentavos: 1, chargedPer: 'sack' }).expect(403);
    await as(A.farmer).get('/api/cooperative/fees').expect(403);
  });

  it('lets the admin add, edit, and turn off other fees; there is no way to delete one', async () => {
    const added = await as(A.admin).post('/api/cooperative/fees/added', {
      name: 'Handling Fee', amountCentavos: 500, chargedPer: 'sack', appliesTo: 'every_batch',
    }).expect(201);
    const fee = added.body.fees.added[0];
    expect(fee).toMatchObject({ name: 'Handling Fee', amountCentavos: 500, chargedPer: 'sack', appliesTo: 'every_batch', active: true });

    const edited = await as(A.admin).patch(`/api/cooperative/fees/added/${fee.id}`, { amountCentavos: 750, active: false }).expect(200);
    expect(edited.body.fees.added[0]).toMatchObject({ amountCentavos: 750, active: false });
    const log = (await audits({ entityType: 'Fee', action: 'update' })).at(-1);
    expect(log.changes).toEqual([
      { field: 'amountCentavos', from: 500, to: 750 },
      { field: 'active', from: true, to: false },
    ]);

    await as(A.admin).post('/api/cooperative/fees/added', { name: 'Bad', amountCentavos: 100, chargedPer: 'per_moon' }).expect(400);
    await as(A.admin).post('/api/cooperative/fees/added', { amountCentavos: 100, chargedPer: 'sack' }).expect(400);
    await request(app).delete(`/api/cooperative/fees/added/${fee.id}`).set('Cookie', cookieFor(A.admin)).expect(404);
  });

  it('keeps each cooperative\'s fees separate', async () => {
    const res = await as(B.admin).get('/api/cooperative/fees').expect(200);
    expect(res.body.fees).toEqual({ storageFeeCentavos: 0, overdueFeePerDayCentavos: 0, memberDiscountPercent: 0, added: [] });
  });
});

describe('Settings > Profile', () => {
  it('lets the admin edit the profile and intake options but not the name, prefix, or plan', async () => {
    const res = await as(A.admin).patch('/api/cooperative', {
      facilityName: 'Alpha Cold Storage Annex', contact: { phone: '0917 000 0000' }, contractMonths: 4,
      sizeClasses: ['Large', 'Medium', ' Large ', ''], grades: ['A', 'B'],
      name: 'Hacked', tagPrefix: 'ZZZ', subscription: { capacityLimit: 999999 },
    }).expect(200);
    expect(res.body.cooperative).toMatchObject({
      name: 'Alpha', tagPrefix: 'ALP', facilityName: 'Alpha Cold Storage Annex',
      contractMonths: 4, sizeClasses: ['Large', 'Medium'], grades: ['A', 'B'],
    });
    expect(res.body.cooperative.subscription.capacityLimit).toBe(10000);
    await as(A.admin).patch('/api/cooperative', { contractMonths: 0 }).expect(400);
    await as(A.staff).patch('/api/cooperative', { facilityName: 'Nope' }).expect(403);
  });
});

describe('Settings > Layout', () => {
  it('shows how many sacks each quadrant holds', async () => {
    const res = await as(A.admin).get('/api/quadrants').expect(200);
    expect(res.body.capacityLimit).toBe(10000);
    expect(res.body.quadrants).toEqual([expect.objectContaining({ code: '1-A', capacity: 1250, used: 1, active: true })]);
  });

  it('will not shrink a quadrant below what it holds, or turn off one that still has sacks', async () => {
    const id = A.records.Quadrant._id;
    await as(A.admin).patch(`/api/quadrants/${id}`, { capacity: 0 }).expect(400);
    await as(A.admin).patch(`/api/quadrants/${id}`, { active: false }).expect(400);
    await as(A.admin).patch(`/api/quadrants/${id}`, { capacity: 1 }).expect(200);
    await as(A.admin).post('/api/quadrants', { code: '1-A', floor: 1, capacity: 10, fillOrder: 9 }).expect(409);
  });
});

describe('Settings > Users', () => {
  let created; let tempPassword;

  it('is for the Cooperative Admin only', async () => {
    await as(A.staff).get('/api/users').expect(403);
    await as(A.farmer).get('/api/users').expect(403);
    await as(superAdmin).get('/api/users').expect(403);
  });

  it('lists only this cooperative\'s staff and admins, never farmers or password data', async () => {
    const res = await as(A.admin).get('/api/users').expect(200);
    expect(res.body.users.map((u) => u.name).sort()).toEqual(['Alpha Admin', 'Alpha Staff']);
    expect(res.body.users.find((u) => u.name === 'Alpha Admin').isYou).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });

  it('creates a staff account with a one-time temporary password', async () => {
    const res = await as(A.admin).post('/api/users', { name: 'Pedro Cruz', phone: '09170001111', role: 'coop_staff' }).expect(201);
    created = res.body.user; tempPassword = res.body.temporaryPassword;
    expect(created).toMatchObject({ name: 'Pedro Cruz', roleLabel: 'Cooperative Staff', active: true, mustChangePassword: true });
    expect(tempPassword).toMatch(/^[A-Za-z0-9]{10}$/);
    const saved = await asSystem(() => models.User.findById(created.id).select('+passwordHash').lean());
    expect(String(saved.cooperativeId)).toBe(String(A.coop._id));
    expect(saved.passwordHash).not.toContain(tempPassword);
    expect(JSON.stringify(await audits({ entityType: 'User' }))).not.toContain(tempPassword);
  });

  it('rejects a bad role, a missing sign-in name, and a sign-in name already in use', async () => {
    await as(A.admin).post('/api/users', { name: 'X', email: 'x@alp.test', role: 'super_admin' }).expect(400);
    await as(A.admin).post('/api/users', { name: 'X', email: 'x@alp.test', role: 'member' }).expect(400);
    await as(A.admin).post('/api/users', { name: 'X', role: 'coop_staff' }).expect(400);
    await as(A.admin).post('/api/users', { name: 'X', email: 'staff@alp.test', role: 'coop_staff' }).expect(409);
    await as(A.admin).post('/api/users', { name: 'X', email: 'staff@brv.test', role: 'coop_staff' }).expect(409);
  });

  it('makes the new user change the temporary password', async () => {
    const first = await login('09170001111', tempPassword).expect(200);
    expect(first.body.user.mustChangePassword).toBe(true);
    const cookie = first.headers['set-cookie'][0].split(';')[0];
    const change = (body) => request(app).post('/api/auth/change-password').set('Cookie', cookie).send(body);
    await change({ currentPassword: 'wrong', newPassword: 'a-brand-new-password' }).expect(400);
    await change({ currentPassword: tempPassword, newPassword: 'short' }).expect(400);
    await change({ currentPassword: tempPassword, newPassword: tempPassword }).expect(400);
    await change({ currentPassword: tempPassword, newPassword: 'a-brand-new-password' }).expect(200);
    await login('09170001111', tempPassword).expect(401);
    const again = await login('09170001111', 'a-brand-new-password').expect(200);
    expect(again.body.user.mustChangePassword).toBe(false);
  });

  it('edits a user and records what changed', async () => {
    const res = await as(A.admin).patch(`/api/users/${created.id}`, { role: 'coop_admin', name: 'Pedro S. Cruz' }).expect(200);
    expect(res.body.user).toMatchObject({ name: 'Pedro S. Cruz', roleLabel: 'Cooperative Admin' });
    const log = (await audits({ entityType: 'User', action: 'update' })).at(-1);
    expect(log.changes).toEqual([
      { field: 'name', from: 'Pedro Cruz', to: 'Pedro S. Cruz' },
      { field: 'role', from: 'coop_staff', to: 'coop_admin' },
    ]);
  });

  it('stops an admin from locking themselves out', async () => {
    await as(A.admin).patch(`/api/users/${A.admin._id}`, { active: false }).expect(400);
    await as(A.admin).patch(`/api/users/${A.admin._id}`, { role: 'coop_staff' }).expect(400);
    await as(A.admin).post(`/api/users/${A.admin._id}/reset-password`).expect(400);
  });

  it('resets a password to a new temporary one', async () => {
    const res = await as(A.admin).post(`/api/users/${created.id}/reset-password`).expect(200);
    await login('09170001111', 'a-brand-new-password').expect(401);
    const ok = await login('09170001111', res.body.temporaryPassword).expect(200);
    expect(ok.body.user.mustChangePassword).toBe(true);
  });

  it('turning a user off ends their access at once, even with a live session', async () => {
    await as(A.staff).get('/api/members').expect(200);
    await as(A.admin).patch(`/api/users/${A.staff._id}`, { active: false }).expect(200);
    await as(A.staff).get('/api/members').expect(401);
    await login('staff@alp.test', TEST_PASSWORD).expect(401);
    await as(A.admin).patch(`/api/users/${A.staff._id}`, { active: true }).expect(200);
    await as(A.staff).get('/api/members').expect(200);
  });

  it('a role change ends the old session', async () => {
    await as(A.admin).patch(`/api/users/${A.staff._id}`, { role: 'coop_admin' }).expect(200);
    await as(A.staff).get('/api/members').expect(401); // token still says Staff
    await as(A.admin).patch(`/api/users/${A.staff._id}`, { role: 'coop_staff' }).expect(200);
  });

  it('cannot see or change another cooperative\'s users, or farmer logins', async () => {
    await as(A.admin).patch(`/api/users/${B.staff._id}`, { active: false }).expect(404);
    await as(A.admin).post(`/api/users/${B.staff._id}/reset-password`).expect(404);
    await as(A.admin).patch(`/api/users/${A.farmer._id}`, { role: 'coop_admin' }).expect(404);
    const untouched = await asSystem(() => models.User.findById(B.staff._id).lean());
    expect(untouched.active).toBe(true);
    await login('staff@brv.test', TEST_PASSWORD).expect(200);
  });
});

describe('Super Admin password change', () => {
  it('works and is logged as a platform entry with no cooperative', async () => {
    await as(superAdmin).post('/api/auth/change-password', { currentPassword: TEST_PASSWORD, newPassword: 'platform-owner-new-pass' }).expect(200);
    await login('owner@onionet.test', 'platform-owner-new-pass').expect(200);
    const log = (await audits({ action: 'password_reset', actorName: 'Platform Owner' })).at(-1);
    expect(log.cooperativeId).toBeNull();
  });
});

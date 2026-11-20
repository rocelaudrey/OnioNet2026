import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, seedCooperative, cookieFor, models } from './helpers.js';
import app from '../../server/app.js';
import { asSystem } from '../../server/context.js';

let A; let B;
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
  await models.Cooperative.updateOne({ _id: A.coop._id }, { 'subscription.enabledFeatures': ['farmer_portal'] });
}, 120_000);
afterAll(stopDb);

describe('Farmers', () => {
  let maria;

  it('adds a farmer with the next member number and all the optional details', async () => {
    const res = await as(A.staff).post('/api/members', {
      tier: 'guest', firstName: ' Maria ', lastName: 'Dela Cruz', phone: '09175550001',
      address: { regionCode: '0200000000', provinceCode: '0205000000', municipalityCode: '0205002000', barangayCode: '0205002010' },
      birthDate: '1980-05-17', farmAreaHa: '1.5', rsbsaNo: '02-50-01-001-000001', joinedAt: '',
    }).expect(201);
    maria = res.body.member;
    expect(maria).toMatchObject({
      memberNo: 'ALP-M-0002', tier: 'guest', firstName: 'Maria', fullName: 'Maria Dela Cruz',
      farmAreaHa: 1.5, rsbsaNo: '02-50-01-001-000001', status: 'active', joinedAt: null,
      address: { barangay: 'Nagcuartelan', municipality: 'Aritao', province: 'Nueva Vizcaya', region: 'Region II (Cagayan Valley)', country: 'Philippines' },
    });
    expect(maria.addressLine).toBe('Nagcuartelan, Aritao, Nueva Vizcaya');
    expect(maria.birthDate).toMatch(/^1980-05-17/);
  });

  it('accepts only addresses from the official list', async () => {
    const res = await as(A.staff).post('/api/members', { tier: 'member', firstName: 'Bad', lastName: 'Place', address: { regionCode: '0200000000', provinceCode: '0205000000', municipalityCode: '1380300000' } }).expect(400);
    expect(res.body.error).toMatch(/not in the chosen province/);
    // Typed place names are not accepted: without codes, nothing is stored.
    const typed = await as(A.staff).patch(`/api/members/${A.records.Member._id}`, { address: { barangay: 'Somewhere' } }).expect(200);
    expect(typed.body.member.address).toMatchObject({ barangay: '', municipality: '', province: '' });
  });

  it('needs only a tier and a name; everything else is optional', async () => {
    await as(A.staff).post('/api/members', { tier: 'member', firstName: 'Jose', lastName: 'Ramos' }).expect(201);
    await as(A.staff).post('/api/members', { firstName: 'No', lastName: 'Tier' }).expect(400);
    await as(A.staff).post('/api/members', { tier: 'vip', firstName: 'Bad', lastName: 'Tier' }).expect(400);
    await as(A.staff).post('/api/members', { tier: 'member', lastName: 'NoFirst' }).expect(400);
    await as(A.staff).post('/api/members', { tier: 'member', firstName: 'A', lastName: 'B', farmAreaHa: -1 }).expect(400);
    await as(A.staff).post('/api/members', { tier: 'member', firstName: 'A', lastName: 'B', birthDate: '2999-01-01' }).expect(400);
    // Rejected forms did not use up member numbers.
    const next = await as(A.staff).post('/api/members', { tier: 'member', firstName: 'Ana', lastName: 'Reyes' }).expect(201);
    expect(next.body.member.memberNo).toBe('ALP-M-0004');
  });

  it('searches by name or member number, with filters, inside the request body', async () => {
    const search = (body) => as(A.staff).post('/api/members/search', body).expect(200);
    expect((await search({ q: 'dela' })).body.members.map((m) => m.fullName)).toEqual(['Maria Dela Cruz']);
    expect((await search({ q: 'cruz maria' })).body.members.map((m) => m.fullName)).toEqual(['Maria Dela Cruz']);
    expect((await search({ q: 'M-0003' })).body.members.map((m) => m.fullName)).toEqual(['Jose Ramos']);
    expect((await search({ q: 'zzz' })).body.members).toEqual([]);
    expect((await search({ q: '.*' })).body.members).toEqual([]); // typed text is never a pattern
    expect((await search({ tier: 'guest' })).body.members.map((m) => m.fullName)).toEqual(['Maria Dela Cruz']);
    const all = await search({});
    expect(all.body.total).toBe(4);
    expect(all.body.totals).toEqual({ all: 4, members: 3, guests: 1, traders: 0, inactive: 0 });
    // Never another cooperative's farmers, even though both have a "Juan".
    expect((await search({ q: 'Juan' })).body.members.map((m) => m.fullName)).toEqual(['Juan Alpha']);
  });

  it('edits a farmer and records exactly what changed', async () => {
    const res = await as(A.staff).patch(`/api/members/${maria.id}`, {
      tier: 'member', address: { ...{ regionCode: '0200000000', provinceCode: '0205000000', municipalityCode: '0205002000', barangayCode: '0205002010' }, street: 'Purok 3' }, phone: '09175550002',
    }).expect(200);
    expect(res.body.member).toMatchObject({ tier: 'member', phone: '09175550002' });
    const log = (await audits({ entityType: 'Member', action: 'update' })).at(-1);
    expect(log.entityLabel).toBe('Maria Dela Cruz');
    expect(log.changes).toEqual([
      { field: 'tier', from: 'guest', to: 'member' },
      { field: 'phone', from: '09175550001', to: '09175550002' },
      { field: 'address.street', from: '', to: 'Purok 3' },
    ]);
  });

  it('shows one farmer with their login state and storage counts', async () => {
    const res = await as(A.staff).get(`/api/members/${A.records.Member._id}`).expect(200);
    expect(res.body.member.fullName).toBe('Juan Alpha');
    expect(res.body.storage).toEqual({ batches: 1, sacksStored: 1 });
    expect(res.body.portal).toMatchObject({ hasLogin: true, active: true });
    expect((await as(A.staff).get(`/api/members/${maria.id}`)).body.portal).toEqual({ hasLogin: false });
  });

  describe('farmer login', () => {
    let tempPassword;

    it('is created with a one-time temporary password, using the farmer\'s mobile number', async () => {
      const res = await as(A.staff).post(`/api/members/${maria.id}/portal-access`, { action: 'enable' }).expect(200);
      tempPassword = res.body.temporaryPassword;
      expect(tempPassword).toMatch(/^[A-Za-z0-9]{10}$/);
      expect(res.body.portal).toMatchObject({ hasLogin: true, active: true, phone: '09175550002', mustChangePassword: true });
      expect(JSON.stringify(await audits({}))).not.toContain(tempPassword);

      const signedIn = await login('09175550002', tempPassword).expect(200);
      expect(signedIn.body.user).toMatchObject({ name: 'Maria Dela Cruz', roleLabel: 'Farmer/Member', mustChangePassword: true });
      const cookie = signedIn.headers['set-cookie'][0].split(';')[0];
      await request(app).get('/api/members').set('Cookie', cookie).expect(403);
    });

    it('needs a mobile number or email, and one that is not already used', async () => {
      const ana = (await as(A.staff).post('/api/members/search', { q: 'Ana' })).body.members[0];
      await as(A.staff).post(`/api/members/${ana.id}/portal-access`, { action: 'enable' }).expect(400);
      await as(A.staff).post(`/api/members/${ana.id}/portal-access`, { action: 'enable', phone: '09175550002' }).expect(409);
      await as(A.staff).post(`/api/members/${ana.id}/portal-access`, { action: 'bogus' }).expect(400);
      await as(A.staff).post(`/api/members/${ana.id}/portal-access`, { action: 'reset' }).expect(400);
    });

    it('can be reset, turned off, and turned back on without a new password', async () => {
      const reset = await as(A.staff).post(`/api/members/${maria.id}/portal-access`, { action: 'reset' }).expect(200);
      await login('09175550002', tempPassword).expect(401);
      await login('09175550002', reset.body.temporaryPassword).expect(200);

      const off = await as(A.staff).post(`/api/members/${maria.id}/portal-access`, { action: 'disable' }).expect(200);
      expect(off.body.portal.active).toBe(false);
      await login('09175550002', reset.body.temporaryPassword).expect(401);

      const on = await as(A.staff).post(`/api/members/${maria.id}/portal-access`, { action: 'enable' }).expect(200);
      expect(on.body.temporaryPassword).toBeUndefined();
      await login('09175550002', reset.body.temporaryPassword).expect(200);
    });

    it('is turned off when the farmer is made inactive', async () => {
      await as(A.staff).patch(`/api/members/${maria.id}`, { status: 'inactive' }).expect(200);
      const res = await as(A.staff).get(`/api/members/${maria.id}`).expect(200);
      expect(res.body.portal.active).toBe(false);
      await as(A.staff).post(`/api/members/${maria.id}/portal-access`, { action: 'enable' }).expect(400);
      expect((await as(A.staff).post('/api/members/search', {})).body.totals).toEqual({ all: 4, members: 3, guests: 0, traders: 0, inactive: 1 });
    });

    it('is blocked when the plan does not include the farmer portal', async () => {
      const res = await as(B.staff).post(`/api/members/${B.records.Member._id}/portal-access`, { action: 'reset' }).expect(403);
      expect(res.body.error).toMatch(/not available on your plan/);
    });
  });

  it('cannot reach another cooperative\'s farmer', async () => {
    await as(A.staff).get(`/api/members/${B.records.Member._id}`).expect(404);
    await as(A.staff).post(`/api/members/${B.records.Member._id}/portal-access`, { action: 'disable' }).expect(404);
    await as(A.staff).get('/api/members/not-an-id').expect(404);
  });
});

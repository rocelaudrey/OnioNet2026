import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, seedCooperative, cookieFor, models } from './helpers.js';
import app from '../../server/app.js';
import { asSystem } from '../../server/context.js';

let A; let B; let farmerId;
const sys = (fn) => asSystem(fn);
const send = (method, user, path, body) => request(app)[method](path).set('Cookie', cookieFor(user)).send(body);
const post = (user, path, body) => send('post', user, path, body);
const patch = (user, path, body) => send('patch', user, path, body);
const get = (user, path) => request(app).get(path).set('Cookie', cookieFor(user));
// Riverside lot in Nagcuartelan, Aritao, Nueva Vizcaya.
const ARITAO = { regionCode: '0200000000', provinceCode: '0205000000', municipalityCode: '0205002000', barangayCode: '0205002010' };

beforeAll(async () => {
  await startDb();
  A = await seedCooperative('Alpha', 'ALP');
  B = await seedCooperative('Bravo', 'BRV');
  await models.Cooperative.updateOne({ _id: A.coop._id }, { 'settings.fees.storageFeeCentavos': 27000, 'settings.fees.memberDiscountPercent': 10 });
  farmerId = String(A.records.Member._id);
  // The seeded delivery already holds number 1.
  await sys(() => models.Counter.updateOne({ cooperativeId: A.coop._id, key: `batch:${new Date().getFullYear()}` }, { value: 1 }, { upsert: true }));
  await sys(() => models.Counter.updateOne({ cooperativeId: A.coop._id, key: 'member' }, { value: 1 }, { upsert: true }));
}, 120_000);
afterAll(stopDb);

describe('traders', () => {
  it('can be added, and their deliveries get no member discount', async () => {
    const trader = (await post(A.staff, '/api/members', { tier: 'trader', firstName: 'Tess', lastName: 'Trader' }).expect(201)).body.member;
    expect(trader.tier).toBe('trader');
    const batch = (await post(A.staff, '/api/batches', { memberId: trader.id, declaredSackCount: 2 }).expect(201)).body.batch;
    const saved = await sys(() => models.Batch.findById(batch.id).lean());
    expect(saved.ownerType).toBe('trader');
    expect(saved.feeTerms.memberDiscountPercent).toBe(0);
    const list = (await post(A.staff, '/api/members/search', { tier: 'trader' }).expect(200)).body;
    expect(list.members.map((m) => m.fullName)).toEqual(['Tess Trader']);
    expect(list.totals.traders).toBe(1);
  });
});

describe('farms', () => {
  let farmId;

  it('staff add a farm with an official place, and it is audited', async () => {
    await post(A.staff, `/api/members/${farmerId}/farms`, { name: 'Riverside lot' }).expect(400); // no place
    await post(A.staff, `/api/members/${farmerId}/farms`, { name: '', location: ARITAO }).expect(400);
    const res = await post(A.staff, `/api/members/${farmerId}/farms`, { name: 'Riverside lot', location: { ...ARITAO, street: 'Sitio Pulo' }, areaHa: '1.5' }).expect(201);
    const farm = res.body.member.farms[0];
    farmId = farm.id;
    expect(farm).toMatchObject({ name: 'Riverside lot', areaHa: 1.5, active: true, locationLine: 'Sitio Pulo, Nagcuartelan, Aritao, Nueva Vizcaya' });
    const log = await sys(() => models.AuditLog.findOne({ cooperativeId: A.coop._id, entityType: 'Farm' }).lean());
    expect(log).toMatchObject({ action: 'create', entityLabel: expect.stringContaining('Riverside lot') });
  });

  it('a delivery records the farm it came from, copied at intake', async () => {
    const batch = (await post(A.staff, '/api/batches', { memberId: farmerId, declaredSackCount: 3, farmId }).expect(201)).body.batch;
    let detail = (await get(A.staff, `/api/batches/${batch.id}`).expect(200)).body.batch;
    expect(detail.farm).toMatchObject({ name: 'Riverside lot', location: 'Sitio Pulo, Nagcuartelan, Aritao, Nueva Vizcaya' });
    expect(detail.ownerFarms.map((f) => f.name)).toEqual(['Riverside lot']);

    // Renaming the farm later does not rewrite the delivery's record.
    await patch(A.staff, `/api/members/${farmerId}/farms/${farmId}`, { name: 'River lot' }).expect(200);
    detail = (await get(A.staff, `/api/batches/${batch.id}`).expect(200)).body.batch;
    expect(detail.farm.name).toBe('Riverside lot');
  });

  it('rejects a farm that belongs to another farmer or is no longer used', async () => {
    const other = (await post(A.staff, '/api/members', { tier: 'member', firstName: 'Olga', lastName: 'Other' }).expect(201)).body.member;
    await post(A.staff, '/api/batches', { memberId: other.id, declaredSackCount: 1, farmId }).expect(400);
    await patch(A.staff, `/api/members/${farmerId}/farms/${farmId}`, { active: false }).expect(200);
    await post(A.staff, '/api/batches', { memberId: farmerId, declaredSackCount: 1, farmId }).expect(400);
    await patch(A.staff, `/api/members/${farmerId}/farms/${farmId}`, { active: true }).expect(200);
  });

  it('another cooperative cannot see or change the farm', async () => {
    await patch(B.staff, `/api/members/${farmerId}/farms/${farmId}`, { name: 'Taken' }).expect(404);
    await post(B.staff, `/api/members/${farmerId}/farms`, { name: 'X', location: ARITAO }).expect(404);
  });
});

describe('delivery condition', () => {
  it('is recorded at intake and on later checks, with who checked and an audit entry', async () => {
    const batch = (await post(A.staff, '/api/batches', {
      memberId: farmerId, declaredSackCount: 2, condition: { rating: 'good', notes: 'Dry and firm' },
    }).expect(201)).body.batch;
    let detail = (await get(A.staff, `/api/batches/${batch.id}`).expect(200)).body.batch;
    expect(detail.condition).toMatchObject({ rating: 'good', notes: 'Dry and firm', checkedByName: A.staff.name });

    await patch(A.staff, `/api/batches/${batch.id}`, { condition: { rating: 'excellent' } }).expect(400);
    detail = (await patch(A.staff, `/api/batches/${batch.id}`, { condition: { rating: 'fair', notes: 'Some sprouting' } }).expect(200)).body.batch;
    expect(detail.condition).toMatchObject({ rating: 'fair', notes: 'Some sprouting' });
    const log = await sys(() => models.AuditLog.findOne({ cooperativeId: A.coop._id, entityType: 'Batch', 'changes.field': 'condition' }).lean());
    expect(log.changes.find((c) => c.field === 'condition')).toMatchObject({ from: 'good (Dry and firm)', to: 'fair (Some sprouting)' });
  });
});

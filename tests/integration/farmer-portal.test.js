import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, seedCooperative, cookieFor, models } from './helpers.js';
import app from '../../server/app.js';
import { asSystem } from '../../server/context.js';
import { encodeTagQr } from '../../server/lib/qr.js';
import { makeTagCode } from '../../server/lib/tagCode.js';

const DAY = 86_400_000;
const YEAR = new Date().getFullYear();
let A; let B; let mine; let other; let otherFarmer; let neighbor;
const sys = (fn) => asSystem(fn);
const qr = (n) => encodeTagQr(makeTagCode('ALP', n), 'test-qr-secret');
const post = (user, path, body) => request(app).post(path).set('Cookie', cookieFor(user)).send(body);
const get = (user, path) => request(app).get(path).set('Cookie', cookieFor(user));
const me = async (path, user = A.farmer) => (await get(user, `/api/me/${path}`).expect(200)).body;

beforeAll(async () => {
  await startDb();
  A = await seedCooperative('Alpha', 'ALP');
  B = await seedCooperative('Bravo', 'BRV');
  await sys(() => models.Batch.updateMany({}, { status: 'stored' }));
  for (const key of ['tag', 'tagLot', `batch:${YEAR}`]) {
    await sys(() => models.Counter.updateOne({ cooperativeId: A.coop._id, key }, { value: 1 }, { upsert: true }));
  }
  await models.Cooperative.updateMany({}, { 'subscription.enabledFeatures': ['farmer_portal'] });
  await models.Cooperative.updateOne({ _id: A.coop._id }, { 'settings.fees.storageFeeCentavos': 10000, 'settings.fees.overdueFeePerDayCentavos': 500 });
  await post(A.admin, '/api/tag-lots', { quantity: 20 }).expect(201); // tags 2..21
  const q = String(A.records.Quadrant._id);
  // The signed-in farmer (Juan Alpha): 6 sacks, 2 released, contract ended, on an installment plan.
  mine = (await post(A.staff, '/api/batches', { memberId: String(A.records.Member._id), declaredSackCount: 6, variety: 'Red Creole' }).expect(201)).body.batch.id;
  await post(A.staff, '/api/custody/gate-in-range', { batchId: mine, quadrantId: q, first: qr(2), last: qr(7), method: 'range_scan' }).expect(201);
  await post(A.staff, `/api/batches/${mine}/finish-receiving`).expect(200);
  const rel = (await post(A.staff, '/api/custody/releases', { batchId: mine }).expect(201)).body.releaseNo;
  for (const n of [2, 3]) await post(A.staff, '/api/custody/gate-out', { batchId: mine, releaseNo: rel, text: qr(n) }).expect(201);
  await post(A.staff, '/api/transactions', { batchId: mine, type: 'payment', method: 'cash', amountCentavos: 20000 }).expect(201);
  const tomorrow = new Date(Date.now() + DAY);
  await post(A.admin, `/api/batches/${mine}/payment-plan`, { count: 2, frequency: 'monthly', firstDueDate: `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}` }).expect(201);
  await sys(() => models.Batch.updateOne({ _id: mine }, { contractEnd: new Date(Date.now() - 1.5 * DAY) }));
  // Another farmer in the same cooperative, with a login of their own.
  neighbor = (await post(A.staff, '/api/members', { tier: 'member', firstName: 'Nena', lastName: 'Neighbor', phone: '09175550123' }).expect(201)).body.member;
  other = (await post(A.staff, '/api/batches', { memberId: neighbor.id, declaredSackCount: 2 }).expect(201)).body.batch.id;
  await post(A.staff, '/api/custody/gate-in-range', { batchId: other, quadrantId: q, first: qr(10), last: qr(11), method: 'range_scan' }).expect(201);
  await post(A.staff, `/api/batches/${other}/finish-receiving`).expect(200);
  await post(A.staff, `/api/members/${neighbor.id}/portal-access`, { action: 'enable' }).expect(200);
  otherFarmer = await sys(() => models.User.findOne({ memberId: neighbor.id }).lean());
}, 120_000);
afterAll(stopDb);

describe('farmer portal', () => {
  it('summary: the farmer\'s own sacks, deliveries, and balance, matching the cooperative\'s figures', async () => {
    const s = await me('summary');
    const page = (await get(A.staff, `/api/members/${A.records.Member._id}`)).body;
    expect(s.member).toMatchObject({ name: 'Juan Alpha', memberNo: 'ALP-M-0001' });
    expect(s).toMatchObject({
      sacksStored: page.storage.sacksStored, deliveries: page.storage.batches, balanceCentavos: page.account.balanceCentavos,
      deliveriesInStorage: 2, overdueDeliveries: 1, lateInstallments: 0,
    });
    expect(s.sacksStored).toBe(1 + 4); // the seeded sack and 4 of the 6
    expect(s.nextInstallment).toMatchObject({ batchNo: expect.stringMatching(/^ALP-B-/) });
    expect(new Date(s.nextContractEnd) < new Date()).toBe(true);
  });

  it('deliveries: lists only the farmer\'s own', async () => {
    const { deliveries } = await me('batches');
    expect(deliveries).toHaveLength(2);
    expect(deliveries.map((d) => d.id)).not.toContain(other);
    expect(deliveries[0]).toMatchObject({ id: mine, sacksReceived: 6, sacksStored: 4, overdue: true, planStatus: 'on_track' });
  });

  it('one delivery: charges from the fee service, payments, sacks and where they are, releases', async () => {
    const d = await me(`batches/${mine}`);
    const staffView = (await get(A.staff, `/api/batches/${mine}`)).body;
    expect(d.delivery.account.totalCentavos).toBe(staffView.account.totalCentavos);
    expect(d.delivery.account.balanceCentavos).toBe(staffView.account.balanceCentavos);
    expect(d.delivery.account.plan.installments).toHaveLength(2);
    expect(d.delivery.transactions.map((t) => t.amountCentavos)).toEqual([20000]);
    expect(d.sacks.map((x) => [x.sackNo, x.status, x.quadrantCode])).toEqual([
      [1, 'released', ''], [2, 'released', ''], [3, 'stored', '1-A'], [4, 'stored', '1-A'], [5, 'stored', '1-A'], [6, 'stored', '1-A'],
    ]);
    expect(d.releases).toEqual([expect.objectContaining({ sacks: 2 })]);
  });

  it('leaves out staff names and anything about other farmers', async () => {
    const all = JSON.stringify([await me('summary'), await me('batches'), await me(`batches/${mine}`), await me('ledger'), await me('sacks')]);
    expect(all).not.toMatch(/Alpha Staff|Alpha Admin|recordedByName|createdByName|voidReason|Nena|Neighbor|cooperativeId|passwordHash/);
  });

  it('cannot open another farmer\'s delivery, in the same cooperative or another', async () => {
    await get(A.farmer, `/api/me/batches/${other}`).expect(404);
    await get(A.farmer, `/api/me/batches/${B.records.Batch._id}`).expect(404);
    await get(A.farmer, '/api/me/batches/not-an-id').expect(404);
    const theirs = await me('batches', otherFarmer);
    expect(theirs.deliveries.map((d) => d.id)).toEqual([other]);
    await get(otherFarmer, `/api/me/batches/${mine}`).expect(404);
    expect((await me('batches', B.farmer)).deliveries.map((d) => d.batchNo)).toEqual(['BRV-B-2026-0001'.replace('2026', String(YEAR))]);
  });

  it('ledger: the farmer\'s statement, the same as the cooperative\'s statement of account', async () => {
    const ledger = await me('ledger');
    const report = (await get(A.staff, `/api/reports/statement/${A.records.Member._id}`)).body;
    expect(ledger.totals).toEqual(report.totals);
    expect(ledger.deliveries.map((d) => d.account.totalCentavos)).toEqual(report.deliveries.map((d) => d.account.totalCentavos));
  });

  it('sacks: how many are stored and where', async () => {
    expect(await me('sacks')).toEqual({ total: 5, byQuadrant: [{ code: '1-A', count: 5 }] });
  });

  it('is read-only and for farmers only', async () => {
    for (const path of ['summary', 'batches', 'ledger']) {
      await get(A.staff, `/api/me/${path}`).expect(403);
      await get(A.admin, `/api/me/${path}`).expect(403);
    }
    await post(A.farmer, '/api/me/batches', {}).expect(404);
    await post(A.farmer, '/api/transactions', { batchId: mine, type: 'payment', method: 'cash', amountCentavos: 100 }).expect(403);
    await get(A.farmer, `/api/batches/${mine}`).expect(403);
  });

  it('is closed when the plan does not include the farmer portal, or the login is turned off', async () => {
    await models.Cooperative.updateOne({ _id: A.coop._id }, { 'subscription.enabledFeatures': [] });
    expect((await get(A.farmer, '/api/me/summary').expect(403)).body.error).toMatch(/not available on your plan/);
    await models.Cooperative.updateOne({ _id: A.coop._id }, { 'subscription.enabledFeatures': ['farmer_portal'] });
    await post(A.staff, `/api/members/${neighbor.id}/portal-access`, { action: 'disable' }).expect(200);
    await get(otherFarmer, '/api/me/summary').expect(401);
  });
});

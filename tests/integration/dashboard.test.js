import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, seedCooperative, cookieFor, models } from './helpers.js';
import app from '../../server/app.js';
import { asSystem } from '../../server/context.js';
import { encodeTagQr } from '../../server/lib/qr.js';
import { makeTagCode } from '../../server/lib/tagCode.js';

const DAY = 86_400_000;
const YEAR = new Date().getFullYear();
let A; let B; let batchId; let otherId;
const sys = (fn) => asSystem(fn);
const qr = (n) => encodeTagQr(makeTagCode('ALP', n), 'test-qr-secret');
const post = (user, path, body) => request(app).post(path).set('Cookie', cookieFor(user)).send(body);
const get = (user, path) => request(app).get(path).set('Cookie', cookieFor(user));
const dashboard = async (user = A.staff, query = '') => (await get(user, `/api/dashboard${query}`).expect(200)).body;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

beforeAll(async () => {
  await startDb();
  A = await seedCooperative('Alpha', 'ALP');
  B = await seedCooperative('Bravo', 'BRV');
  await sys(() => models.Batch.updateMany({}, { status: 'stored' }));
  for (const key of ['tag', 'tagLot', `batch:${YEAR}`]) {
    await sys(() => models.Counter.updateOne({ cooperativeId: A.coop._id, key }, { value: 1 }, { upsert: true }));
  }
  await models.Cooperative.updateOne({ _id: A.coop._id }, { 'settings.fees.storageFeeCentavos': 10000, 'settings.fees.overdueFeePerDayCentavos': 500 });
  await post(A.admin, '/api/tag-lots', { quantity: 30 }).expect(201); // tags 2..31
  const member = String(A.records.Member._id);
  const q = String(A.records.Quadrant._id);
  // Delivery 1: 10 sacks by range, 3 released. Delivery 2: 2 sacks one by one, still receiving 1 more.
  batchId = (await post(A.staff, '/api/batches', { memberId: member, declaredSackCount: 10 }).expect(201)).body.batch.id;
  await post(A.staff, '/api/custody/gate-in-range', { batchId, quadrantId: q, first: qr(2), last: qr(11), method: 'range_scan' }).expect(201);
  await post(A.staff, `/api/batches/${batchId}/finish-receiving`).expect(200);
  const rel = (await post(A.admin, '/api/custody/releases', { batchId }).expect(201)).body.releaseNo;
  for (const n of [2, 3, 4]) await post(A.admin, '/api/custody/gate-out', { batchId, releaseNo: rel, text: qr(n) }).expect(201);
  otherId = (await post(A.staff, '/api/batches', { memberId: member, declaredSackCount: 3 }).expect(201)).body.batch.id;
  for (const n of [20, 21]) await post(A.staff, '/api/custody/gate-in', { batchId: otherId, text: qr(n), quadrantId: q }).expect(201);
  await post(A.staff, '/api/transactions', { batchId, type: 'payment', method: 'cash', amountCentavos: 25000 }).expect(201);
  const tag30 = await sys(() => models.Tag.findOne({ code: makeTagCode('ALP', 30) }).lean());
  await post(A.staff, `/api/tags/${tag30._id}/status`, { status: 'damaged' }).expect(200);
}, 120_000);
afterAll(stopDb);

describe('cooperative dashboard', () => {
  it('shows storage that matches the Inventory page', async () => {
    const d = await dashboard();
    const inv = (await get(A.staff, '/api/batches/summary')).body;
    expect(d.storage).toMatchObject({ capacity: inv.capacity, stored: inv.stored, pending: inv.pending, available: inv.available });
    // 1 seeded + 7 + 2 stored, 1 still expected, of 1,250.
    expect(d.storage).toMatchObject({ capacity: 1250, stored: 10, pending: 1, available: 1239, percentUsed: 0.9, level: 'optimal' });
  });

  it('shows money that matches the Transactions page', async () => {
    const d = await dashboard();
    const tx = (await get(A.staff, '/api/transactions/summary')).body;
    expect(d.money).toEqual(tx);
    // Delivery 1: 10 x 100.00 - 250.00 paid = 750.00. Delivery 2: 2 x 100.00 = 200.00.
    expect(d.money).toMatchObject({ outstandingCentavos: 95000, unpaidDeliveries: 2, collectedTodayCentavos: 25000 + 50000 }); // + the seed's payment
  });

  it('counts tags by status', async () => {
    const d = await dashboard();
    // 1 seeded (on a sack) + 30 made: 7 + 2 + 1 on sacks, 1 damaged.
    expect(d.tags).toEqual({ available: 20, assigned: 10, damaged: 1, lost: 0, retired: 0 });
  });

  it('charts sacks scanned in and out per day', async () => {
    const d = await dashboard(A.staff, '?days=7');
    expect(d.chart.days).toBe(7);
    expect(d.chart.points).toHaveLength(7);
    expect(d.chart.points.at(-1)).toEqual({ date: ymd(new Date()), entries: 13, releases: 3 }); // 12 + the seed's sack
    expect(d.chart.points.slice(0, -1).every((p) => p.entries === 0 && p.releases === 0)).toBe(true);
    expect((await dashboard(A.staff, '?days=99')).chart.days).toBe(14);
  });

  it('groups a range or a run of scans into one activity line, newest first', async () => {
    const { activity } = await dashboard();
    // The shared test seed adds one sack and one payment before everything else.
    expect(activity.map((a) => a.title)).toEqual([
      expect.stringMatching(/^Tag ALP-000030-. marked damaged$/),
      'Payment received',
      '2 sacks received',
      '3 sacks released',
      '10 sacks received by range',
      'Payment received',
      '1 sack received',
    ]);
    const payment = activity.find((a) => a.kind === 'payment');
    expect(payment).toMatchObject({ amountCentavos: 25000 });
    expect(payment.detail).toMatch(/^Juan Alpha · ALP-R-\d{4}-0001 · by Alpha Staff$/);
    const range = activity.find((a) => a.title.endsWith('by range'));
    expect(range.detail).toMatch(/^Juan Alpha · ALP-B-\d{4}-\d{4} · by Alpha Staff$/);
    expect(JSON.stringify(activity)).not.toMatch(/cooperativeId/);
  });

  it('lists what needs attention: overdue deliveries, open intake, late installments, damaged tags', async () => {
    await sys(() => models.Batch.updateOne({ _id: batchId }, { contractEnd: new Date(Date.now() - 2 * DAY) }));
    await post(A.admin, `/api/batches/${otherId}/payment-plan`, { count: 2, frequency: 'weekly', firstDueDate: ymd(new Date()) }).expect(201);
    await sys(async () => {
      const b = await models.Batch.findById(otherId);
      b.paymentPlan.installments[0].dueDate = new Date(Date.now() - 3 * DAY);
      b.markModified('paymentPlan');
      await b.save();
    });
    const d = await dashboard();
    expect(d.attention).toEqual({
      overdueDeliveries: 1, overdueSacks: 7, receiving: 1, latePlans: 1, lateInstallmentsCentavos: 10000, damagedOrLostTags: 1,
    });
    // 7 stored sacks x 3 started days, plus 3 sacks released just now (2 started days each).
    expect(d.money.overdueFeesCentavos).toBe((7 * 3 + 3 * 2) * 500);
  });

  it('is for cooperative users only, and shows only their cooperative', async () => {
    await get(A.farmer, '/api/dashboard').expect(403);
    await dashboard(A.admin);
    const theirs = await dashboard(B.staff);
    expect(theirs.storage.stored).toBe(1);
    expect(theirs.money.outstandingCentavos).toBe(0);
    expect(theirs.tags.available).toBe(0);
    expect(theirs.activity.every((a) => !a.detail.includes('Alpha'))).toBe(true);
  });
});

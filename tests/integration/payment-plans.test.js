import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, seedCooperative, cookieFor, models } from './helpers.js';
import app from '../../server/app.js';
import { asSystem } from '../../server/context.js';
import { encodeTagQr } from '../../server/lib/qr.js';
import { makeTagCode } from '../../server/lib/tagCode.js';

const DAY = 86_400_000;
const YEAR = new Date().getFullYear();
let A; let B; let batchId;
const sys = (fn) => asSystem(fn);
const qr = (n) => encodeTagQr(makeTagCode('ALP', n), 'test-qr-secret');
const post = (user, path, body) => request(app).post(path).set('Cookie', cookieFor(user)).send(body);
const get = (user, path) => request(app).get(path).set('Cookie', cookieFor(user));
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inDays = (n) => ymd(new Date(Date.now() + n * DAY));
const plan = (user, body) => post(user, `/api/batches/${batchId}/payment-plan`, body);
const account = async () => (await get(A.staff, `/api/batches/${batchId}`).expect(200)).body.account;
const pay = (user, amountCentavos) => post(user, '/api/transactions', { batchId, type: 'payment', method: 'cash', amountCentavos });

beforeAll(async () => {
  await startDb();
  A = await seedCooperative('Alpha', 'ALP');
  B = await seedCooperative('Bravo', 'BRV');
  await sys(() => models.Batch.updateMany({}, { status: 'stored' }));
  for (const key of ['tag', 'tagLot', `batch:${YEAR}`]) {
    await sys(() => models.Counter.updateOne({ cooperativeId: A.coop._id, key }, { value: 1 }, { upsert: true }));
  }
  await models.Cooperative.updateOne({ _id: A.coop._id }, { 'settings.fees.storageFeeCentavos': 15000, 'settings.fees.overdueFeePerDayCentavos': 1000 });
  await post(A.admin, '/api/tag-lots', { quantity: 10 }).expect(201);
  batchId = (await post(A.staff, '/api/batches', { memberId: String(A.records.Member._id), declaredSackCount: 6 }).expect(201)).body.batch.id;
  await post(A.staff, '/api/custody/gate-in-range', { batchId, quadrantId: String(A.records.Quadrant._id), first: qr(2), last: qr(7), method: 'range_scan' }).expect(201);
  await post(A.staff, `/api/batches/${batchId}/finish-receiving`).expect(200);
  // Balance: 6 x 150.00 = 900.00; a 100.00 payment before the plan leaves 800.00.
  await pay(A.staff, 10000).expect(201);
}, 120_000);
afterAll(stopDb);

describe('setting up an installment plan', () => {
  it('is for the Cooperative Admin only', async () => {
    await plan(A.staff, { count: 3, frequency: 'monthly', firstDueDate: inDays(7) }).expect(403);
    await plan(A.farmer, { count: 3, frequency: 'monthly', firstDueDate: inDays(7) }).expect(403);
  });

  it('previews a schedule that splits the current balance exactly, without saving it', async () => {
    const res = await plan(A.admin, { count: 3, frequency: 'monthly', firstDueDate: inDays(7), dryRun: true }).expect(200);
    expect(res.body.balanceCentavos).toBe(80000);
    expect(res.body.installments.map((i) => i.amountCentavos)).toEqual([26666, 26666, 26668]);
    const dates = res.body.installments.map((i) => new Date(i.dueDate));
    expect(ymd(dates[0])).toBe(inDays(7));
    expect(dates[1].getDate()).toBe(dates[0].getDate() > 28 ? dates[1].getDate() : dates[0].getDate());
    expect((await account()).plan).toBeNull();
  });

  it('rejects bad terms', async () => {
    for (const body of [
      { count: 1, frequency: 'monthly', firstDueDate: inDays(7) },
      { count: 13, frequency: 'monthly', firstDueDate: inDays(7) },
      { count: 2.5, frequency: 'monthly', firstDueDate: inDays(7) },
      { count: 3, frequency: 'daily', firstDueDate: inDays(7) },
      { count: 3, frequency: 'weekly', firstDueDate: inDays(-1) },
      { count: 3, frequency: 'weekly', firstDueDate: 'soon' },
    ]) await plan(A.admin, body).expect(400);
  });

  it('saves the plan, records who set it up, and writes an audit entry', async () => {
    const res = await plan(A.admin, { count: 4, frequency: 'every_2_weeks', firstDueDate: inDays(0), notes: 'Agreed at the office' }).expect(201);
    const p = res.body.account.plan;
    expect(p).toMatchObject({ status: 'on_track', createdByName: 'Alpha Admin', frequency: 'every_2_weeks', totalCentavos: 80000, remainingCentavos: 80000, notes: 'Agreed at the office' });
    expect(p.installments.map((i) => [i.amountCentavos, i.status])).toEqual([[20000, 'due'], [20000, 'upcoming'], [20000, 'upcoming'], [20000, 'upcoming']]);
    const gap = new Date(p.installments[1].dueDate) - new Date(p.installments[0].dueDate);
    expect(Math.round(gap / DAY)).toBe(14);
    const log = await sys(() => models.AuditLog.findOne({ entityType: 'PaymentPlan' }).lean());
    expect(log.changes[0].to).toBe('4 × every 2 weeks, ₱800.00 in total');
  });

  it('allows only one active plan', async () => {
    expect((await plan(A.admin, { count: 2, frequency: 'monthly', firstDueDate: inDays(3) }).expect(409)).body.error).toMatch(/already has an installment plan/);
  });
});

describe('paying by installments', () => {
  it('applies payments to installments in order, and still allows any amount up to the balance', async () => {
    await pay(A.staff, 30000).expect(201);
    const p = (await account()).plan;
    expect(p.installments.map((i) => [i.paidCentavos, i.status])).toEqual([[20000, 'paid'], [10000, 'due'], [0, 'upcoming'], [0, 'upcoming']]);
    expect(p).toMatchObject({ paidCentavos: 30000, remainingCentavos: 50000, next: { number: 2 } });
  });

  it('flags late installments on the delivery, the farmer, the inventory list, and the Transactions summary', async () => {
    // Pretend the second installment was due 3 days ago.
    await sys(async () => {
      const b = await models.Batch.findById(batchId);
      b.paymentPlan.installments[1].dueDate = new Date(Date.now() - 3 * DAY);
      b.markModified('paymentPlan');
      await b.save();
    });
    const p = (await account()).plan;
    expect(p).toMatchObject({ status: 'late', lateCount: 1, lateCentavos: 10000 });
    const farmer = (await get(A.staff, `/api/members/${A.records.Member._id}`)).body;
    expect(farmer.deliveries.find((d) => d.id === batchId).planStatus).toBe('late');
    const list = (await post(A.staff, '/api/batches/search', {})).body.batches;
    expect(list.find((b) => b.id === batchId).planStatus).toBe('late');
    const summary = (await get(A.staff, '/api/transactions/summary')).body;
    expect(summary).toMatchObject({ latePlans: 1, lateInstallmentsCentavos: 10000 });
  });

  it('is back on track once the late amount is paid, and voiding that payment makes it late again', async () => {
    const res = await pay(A.staff, 10000).expect(201);
    expect((await account()).plan.status).toBe('on_track');
    await post(A.admin, `/api/transactions/${res.body.transaction.id}/void`, { reason: 'Bounced' }).expect(200);
    expect((await account()).plan.status).toBe('late');
    await pay(A.staff, 10000).expect(201);
  });

  it('shows the plan progress on the receipt', async () => {
    const t = (await post(A.staff, '/api/transactions/search', { type: 'payment', status: 'valid' })).body.transactions[0];
    const receipt = (await get(A.staff, `/api/transactions/${t.id}`).expect(200)).body;
    expect(receipt.delivery.plan).toMatchObject({ status: 'on_track', paidCentavos: 40000, remainingCentavos: 40000 });
  });

  it('shows new overdue fees as not covered by the plan', async () => {
    await sys(() => models.Batch.updateOne({ _id: batchId }, { contractEnd: new Date(Date.now() - 1.5 * DAY) }));
    const a = await account();
    expect(a.overdueCentavos).toBe(6 * 2 * 1000);
    expect(a.plan).toMatchObject({ remainingCentavos: 40000, notCoveredCentavos: 12000 });
    expect(a.balanceCentavos).toBe(52000);
  });

  it('is completed when the balance is paid off', async () => {
    await pay(A.staff, 52000).expect(201);
    const a = await account();
    expect(a.balanceCentavos).toBe(0);
    expect(a.plan).toMatchObject({ status: 'completed', remainingCentavos: 0, lateCount: 0, next: null });
    expect((await plan(A.admin, { count: 2, frequency: 'monthly', firstDueDate: inDays(3) }).expect(409)).body.error).toMatch(/already has/);
  });
});

describe('cancelling a plan', () => {
  it('needs a reason, keeps the payments, and lets a new plan be set up', async () => {
    await sys(() => models.Batch.updateOne({ _id: batchId }, { contractEnd: new Date(Date.now() - 4.5 * DAY) })); // new overdue fees
    await post(A.staff, `/api/batches/${batchId}/payment-plan/cancel`, { reason: 'x' }).expect(403);
    await post(A.admin, `/api/batches/${batchId}/payment-plan/cancel`, {}).expect(400);
    const res = await post(A.admin, `/api/batches/${batchId}/payment-plan/cancel`, { reason: 'Farmer asked for new terms' }).expect(200);
    expect(res.body.account.plan).toBeNull();
    expect(res.body.account.paidCentavos).toBe(102000);
    await post(A.admin, `/api/batches/${batchId}/payment-plan/cancel`, { reason: 'again' }).expect(400);
    const fresh = await plan(A.admin, { count: 2, frequency: 'weekly', firstDueDate: inDays(1) }).expect(201);
    expect(fresh.body.account.plan.totalCentavos).toBe(fresh.body.account.balanceCentavos);
  });
});

describe('limits and separation', () => {
  it('refuses a delivery with nothing owed, coop stock, and another cooperative', async () => {
    const coop = (await post(A.staff, '/api/batches', { coopOwned: true, declaredSackCount: 1 }).expect(201)).body.batch.id;
    await post(A.admin, `/api/batches/${coop}/payment-plan`, { count: 2, frequency: 'monthly', firstDueDate: inDays(3) }).expect(400);
    await post(B.admin, `/api/batches/${batchId}/payment-plan`, { count: 2, frequency: 'monthly', firstDueDate: inDays(3) }).expect(404);
    await post(B.admin, `/api/batches/${batchId}/payment-plan/cancel`, { reason: 'x' }).expect(404);
    expect((await post(B.admin, '/api/transactions/summary', {})).status).toBe(404); // summary is GET only
    expect((await get(B.admin, '/api/transactions/summary')).body.latePlans).toBe(0);
  });

  it('refuses a balance too small to split', async () => {
    const small = (await post(A.staff, '/api/batches', { memberId: String(A.records.Member._id), declaredSackCount: 1 }).expect(201)).body.batch.id;
    await post(A.staff, '/api/custody/gate-in-range', { batchId: small, quadrantId: String(A.records.Quadrant._id), first: qr(9), last: qr(9), method: 'range_scan' }).expect(201);
    // ₱150.00 owed, paid down to ₱1.50: two installments would be under ₱1.00 each.
    await post(A.staff, '/api/transactions', { batchId: small, type: 'payment', method: 'cash', amountCentavos: 14850 }).expect(201);
    expect((await post(A.admin, `/api/batches/${small}/payment-plan`, { count: 2, frequency: 'weekly', firstDueDate: inDays(1) }).expect(400)).body.error)
      .toBe('The balance is ₱1.50, too small for 2 installments.');
  });
});

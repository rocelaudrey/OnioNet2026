import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, seedCooperative, cookieFor, models } from './helpers.js';
import app from '../../server/app.js';
import { asSystem } from '../../server/context.js';
import { encodeTagQr } from '../../server/lib/qr.js';
import { makeTagCode } from '../../server/lib/tagCode.js';

const YEAR = new Date().getFullYear();
let A; let B; let batchId; let coopBatch;
const sys = (fn) => asSystem(fn);
const qr = (n) => encodeTagQr(makeTagCode('ALP', n), 'test-qr-secret');
const post = (user, path, body) => request(app).post(path).set('Cookie', cookieFor(user)).send(body);
const get = (user, path) => request(app).get(path).set('Cookie', cookieFor(user));
const charge = (user, body) => post(user, '/api/transactions', { batchId, type: 'charge', ...body });
const account = async () => (await get(A.staff, `/api/batches/${batchId}`).expect(200)).body.account;

beforeAll(async () => {
  await startDb();
  A = await seedCooperative('Alpha', 'ALP');
  B = await seedCooperative('Bravo', 'BRV');
  await sys(() => models.Batch.updateMany({}, { status: 'stored' }));
  for (const key of ['tag', 'tagLot', `batch:${YEAR}`]) {
    await sys(() => models.Counter.updateOne({ cooperativeId: A.coop._id, key }, { value: 1 }, { upsert: true }));
  }
  // FAFOGGGA-style fees: ₱270 storage, no automatic overdue fee, no discount.
  await models.Cooperative.updateOne({ _id: A.coop._id }, { 'settings.fees.storageFeeCentavos': 27000, 'settings.contractMonths': 4 });
  await post(A.admin, '/api/tag-lots', { quantity: 10 }).expect(201);
  const q = String(A.records.Quadrant._id);
  batchId = (await post(A.staff, '/api/batches', { memberId: String(A.records.Member._id), declaredSackCount: 5 }).expect(201)).body.batch.id;
  await post(A.staff, '/api/custody/gate-in-range', { batchId, quadrantId: q, first: qr(2), last: qr(6), method: 'range_scan' }).expect(201);
  await post(A.staff, `/api/batches/${batchId}/finish-receiving`).expect(200);
  coopBatch = (await post(A.staff, '/api/batches', { coopOwned: true, declaredSackCount: 1 }).expect(201)).body.batch.id;
}, 120_000);
afterAll(stopDb);

describe('manual charges', () => {
  it('staff add a hauling charge, which raises the balance and shows as its own line', async () => {
    expect(await account()).toMatchObject({ totalCentavos: 135000, balanceCentavos: 135000 });
    const res = await charge(A.staff, { chargeKind: 'hauling', amountCentavos: 10000, notes: '₱20 × 5 sacks' }).expect(201);
    expect(res.body.transaction.receiptNo).toBe(`ALP-R-${YEAR}-0001`);
    const a = await account();
    expect(a).toMatchObject({ manualCentavos: 10000, totalCentavos: 145000, balanceCentavos: 145000 });
    expect(a.lines.at(-1)).toMatchObject({ label: 'Hauling fee', note: '₱20 × 5 sacks', amountCentavos: 10000, manual: true });
    const saved = await sys(() => models.Transaction.findById(res.body.transaction.id).lean());
    expect(saved).toMatchObject({ type: 'charge', chargeKind: 'hauling', amountCentavos: 10000 });
    expect(saved.method).toBeNull();
    expect(String(saved.recordedBy)).toBe(String(A.staff._id));
  });

  it('an overdue charge can be any amount, and payments can then cover it', async () => {
    await charge(A.staff, { chargeKind: 'overdue', amountCentavos: 250000, notes: 'Oct–Nov' }).expect(201);
    expect((await account()).balanceCentavos).toBe(395000);
    await post(A.staff, '/api/transactions', { batchId, type: 'payment', method: 'cash', amountCentavos: 395000 }).expect(201);
    expect((await account()).balanceCentavos).toBe(0);
  });

  it('needs a kind, and a description for "other"', async () => {
    await charge(A.staff, { amountCentavos: 100 }).expect(400);
    await charge(A.staff, { chargeKind: 'storage', amountCentavos: 100 }).expect(400);
    expect((await charge(A.staff, { chargeKind: 'other', amountCentavos: 100 }).expect(400)).body.error).toMatch(/Describe/);
    await charge(A.staff, { chargeKind: 'hauling', amountCentavos: 0 }).expect(400);
    await charge(A.staff, { chargeKind: 'hauling', amountCentavos: 100, paidAt: '2999-01-01' }).expect(400);
  });

  it('is refused for cooperative stock, another cooperative, and farmers', async () => {
    await post(A.staff, '/api/transactions', { batchId: coopBatch, type: 'charge', chargeKind: 'hauling', amountCentavos: 100 }).expect(400);
    await charge(B.staff, { chargeKind: 'hauling', amountCentavos: 100 }).expect(404);
    await charge(A.farmer, { chargeKind: 'hauling', amountCentavos: 100 }).expect(403);
  });

  it('only an admin can void a charge, and voiding takes it off the balance', async () => {
    const res = await charge(A.staff, { chargeKind: 'other', amountCentavos: 5000, notes: 'Pallet rental' }).expect(201);
    expect((await account()).balanceCentavos).toBe(5000);
    await post(A.staff, `/api/transactions/${res.body.transaction.id}/void`, { reason: 'x' }).expect(403);
    await post(A.admin, `/api/transactions/${res.body.transaction.id}/void`, { reason: 'Entered twice' }).expect(200);
    expect((await account()).balanceCentavos).toBe(0);
  });

  it('shows on the statement, the farmer\'s portal, and the fees report, and is not counted as money collected', async () => {
    const statement = (await get(A.staff, `/api/reports/statement/${A.records.Member._id}`).expect(200)).body;
    const d = statement.deliveries.find((x) => String(x.id) === batchId);
    expect(d.account.lines.filter((l) => l.manual).map((l) => l.label)).toEqual(['Hauling fee', 'Overdue charge']);
    expect(d.transactions.map((t) => t.type)).toEqual(['charge', 'charge', 'payment', 'charge']);
    await models.Cooperative.updateOne({ _id: A.coop._id }, { 'subscription.enabledFeatures': ['farmer_portal'] });
    const mine = (await get(A.farmer, `/api/me/batches/${batchId}`).expect(200)).body.delivery;
    expect(mine.account.manualCentavos).toBe(260000);
    const fees = (await get(A.staff, '/api/reports/fees').expect(200)).body;
    expect(fees.period).toMatchObject({ chargedCentavos: 10000 + 250000, paymentsCentavos: 395000 + 50000 });
    const summary = (await get(A.staff, '/api/transactions/summary')).body;
    expect(summary.collectedTodayCentavos).toBe(395000 + 50000);
  });

  it('added after an installment plan, it is not counted as paid toward the plan', async () => {
    await charge(A.staff, { chargeKind: 'overdue', amountCentavos: 30000 }).expect(201);
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await post(A.admin, `/api/batches/${batchId}/payment-plan`, { count: 2, frequency: 'weekly', firstDueDate: ymd }).expect(201);
    await charge(A.staff, { chargeKind: 'overdue', amountCentavos: 2000 }).expect(201);
    const a = await account();
    expect(a.plan).toMatchObject({ totalCentavos: 30000, paidCentavos: 0, notCoveredCentavos: 2000 });
  });
});

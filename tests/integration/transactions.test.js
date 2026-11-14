import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, seedCooperative, cookieFor, models } from './helpers.js';
import app from '../../server/app.js';
import { asSystem } from '../../server/context.js';
import { encodeTagQr } from '../../server/lib/qr.js';
import { makeTagCode } from '../../server/lib/tagCode.js';

const DAY = 86_400_000;
const SECRET = 'test-qr-secret';
const YEAR = new Date().getFullYear();
let A; let B; let batchId; let guestBatchId; let coopBatchId;
const sys = (fn) => asSystem(fn);
const qr = (n) => encodeTagQr(makeTagCode('ALP', n), SECRET);
const post = (user, path, body) => request(app).post(path).set('Cookie', cookieFor(user)).send(body);
const get = (user, path) => request(app).get(path).set('Cookie', cookieFor(user));
const pay = (user, body) => post(user, '/api/transactions', { batchId, type: 'payment', method: 'cash', ...body });
const balance = async (id = batchId) => (await get(A.staff, `/api/batches/${id}`).expect(200)).body.account.balanceCentavos;
const quadrantId = () => String(A.records.Quadrant._id);

async function receive(memberId, count, first, extra = {}) {
  const id = (await post(A.staff, '/api/batches', { memberId, declaredSackCount: count, ...extra }).expect(201)).body.batch.id;
  await post(A.staff, '/api/custody/gate-in-range', { batchId: id, quadrantId: quadrantId(), first: qr(first), last: qr(first + count - 1), method: 'range_scan' }).expect(201);
  await post(A.staff, `/api/batches/${id}/finish-receiving`).expect(200);
  return id;
}

beforeAll(async () => {
  await startDb();
  A = await seedCooperative('Alpha', 'ALP');
  B = await seedCooperative('Bravo', 'BRV');
  await sys(() => models.Batch.updateMany({}, { status: 'stored' }));
  for (const key of ['tag', 'tagLot', `batch:${YEAR}`]) {
    await sys(() => models.Counter.updateOne({ cooperativeId: A.coop._id, key }, { value: 1 }, { upsert: true }));
  }
  await models.Cooperative.updateOne({ _id: A.coop._id }, {
    'settings.fees': {
      storageFeeCentavos: 15000, overdueFeePerDayCentavos: 200, memberDiscountPercent: 10,
      added: [
        { name: 'Handling', amountCentavos: 500, chargedPer: 'sack', appliesTo: 'every_batch', active: true },
        { name: 'Loading', amountCentavos: 2000, chargedPer: 'batch', appliesTo: 'every_batch', active: true },
        { name: 'Cooling', amountCentavos: 1000, chargedPer: 'sack_per_month', appliesTo: 'every_batch', active: true },
      ],
    },
  });
  await post(A.admin, '/api/tag-lots', { quantity: 60 }).expect(201); // tags 2..61
  const member = String(A.records.Member._id);
  batchId = await receive(member, 10, 2);
  const guest = (await post(A.staff, '/api/members', { tier: 'guest', firstName: 'Gina', lastName: 'Guest' }).expect(201)).body.member.id;
  guestBatchId = await receive(guest, 2, 20);
  coopBatchId = await receive(undefined, 1, 30, { coopOwned: true });

  // Pretend the member's sacks came in 100 days ago (4 started months) and the
  // contract ended 10.5 days ago (11 started days overdue per sack).
  await sys(() => models.Sack.updateMany({ batchId }, { gateInAt: new Date(Date.now() - 100 * DAY) }));
  await sys(() => models.Batch.updateOne({ _id: batchId }, { contractEnd: new Date(Date.now() - 10.5 * DAY), receivedAt: new Date(Date.now() - 100 * DAY) }));
  // Release 2 of the 10 sacks, as if they left 60 days ago (2 months in, before the contract ended).
  const rel = (await post(A.staff, '/api/custody/releases', { batchId }).expect(201)).body.releaseNo;
  for (const n of [2, 3]) await post(A.staff, '/api/custody/gate-out', { batchId, releaseNo: rel, text: qr(n) }).expect(201);
  await sys(() => models.Sack.updateMany({ batchId, status: 'released' }, { gateOutAt: new Date(Date.now() - 60 * DAY) }));
}, 120_000);
afterAll(stopDb);

// storage 10 x 150.00 = 1,500.00 | handling 10 x 5.00 = 50.00 | loading 20.00
// cooling (8 sacks x 4 months + 2 sacks x 2 months) = 36 x 10.00 = 360.00
// subtotal 1,930.00, member discount 10% = 193.00
// overdue 8 sacks x 11 days = 88 x 2.00 = 176.00 (released sacks left before the contract ended)
// total 1,930.00 - 193.00 + 176.00 = 1,913.00
const TOTAL = 191300;

describe('charges', () => {
  it('works out every charge for a delivery from the fee service', async () => {
    const { account } = (await get(A.staff, `/api/batches/${batchId}`).expect(200)).body;
    expect(account.lines.map((l) => [l.label, l.quantity, l.amountCentavos])).toEqual([
      ['Storage fee', 10, 150000],
      ['Handling', 10, 5000],
      ['Loading', 1, 2000],
      ['Cooling', 36, 36000],
      ['Overdue fee', 88, 17600],
    ]);
    expect(account).toMatchObject({
      subtotalCentavos: 193000, discountPercent: 10, discountCentavos: 19300, overdueCentavos: 17600,
      overdueSacks: 8, overdueSackDays: 88, totalCentavos: TOTAL, paidCentavos: 0, balanceCentavos: TOTAL,
    });
  });

  it('gives guests no discount and charges cooperative stock nothing', async () => {
    const guest = (await get(A.staff, `/api/batches/${guestBatchId}`)).body.account;
    expect(guest).toMatchObject({ discountCentavos: 0, totalCentavos: 2 * 15000 + 2 * 500 + 2000 + 2 * 1000 });
    expect((await get(A.staff, `/api/batches/${coopBatchId}`)).body.account.totalCentavos).toBe(0);
  });

  it('shows the same balance on the delivery, the farmer, the inventory list, and the outstanding total', async () => {
    const guestTotal = 35000;
    const fromDelivery = await balance();
    const farmer = (await get(A.staff, `/api/members/${A.records.Member._id}`).expect(200)).body;
    const fromFarmer = farmer.deliveries.find((d) => d.id === batchId).balanceCentavos;
    const list = (await post(A.staff, '/api/batches/search', {}).expect(200)).body.batches;
    const fromList = list.find((b) => b.id === batchId).balanceCentavos;
    const summary = (await get(A.staff, '/api/transactions/summary').expect(200)).body;
    expect([fromDelivery, fromFarmer, fromList]).toEqual([TOTAL, TOTAL, TOTAL]);
    // The seeded delivery has a ₱500.00 credit; credits are not outstanding.
    expect(summary).toMatchObject({ outstandingCentavos: TOTAL + guestTotal, unpaidDeliveries: 2, overdueFeesCentavos: 17600 });
    expect(farmer.account.balanceCentavos).toBe(TOTAL - 50000);
  });
});

describe('payments', () => {
  let firstReceipt;

  it('records a cash payment with the next receipt number, and lowers the balance', async () => {
    const res = await pay(A.staff, { amountCentavos: 100000 }).expect(201);
    expect(res.body.transaction.receiptNo).toBe(`ALP-R-${YEAR}-0001`);
    firstReceipt = res.body.transaction.id;
    expect(await balance()).toBe(TOTAL - 100000);
    const saved = await sys(() => models.Transaction.findById(firstReceipt).lean());
    expect(saved).toMatchObject({ type: 'payment', method: 'cash', amountCentavos: 100000 });
    expect(String(saved.recordedBy)).toBe(String(A.staff._id));
    expect(String(saved.memberId)).toBe(String(A.records.Member._id));
    expect(String(saved.cooperativeId)).toBe(String(A.coop._id));
    const log = await sys(() => models.AuditLog.findOne({ entityType: 'Transaction', entityId: saved._id }).lean());
    expect(log).toMatchObject({ action: 'create', actorName: 'Alpha Staff' });
  });

  it('will not take more than the balance', async () => {
    const left = TOTAL - 100000;
    const res = await pay(A.staff, { amountCentavos: left + 1 }).expect(400);
    expect(res.body.error).toBe('The balance is ₱913.00. Payment cannot be more than that.');
  });

  it('needs a reference number for GCash and bank payments', async () => {
    expect((await pay(A.staff, { amountCentavos: 1300, method: 'gcash' }).expect(400)).body.error).toMatch(/reference number/);
    await pay(A.staff, { amountCentavos: 1300, method: 'bank', referenceNo: ' ' }).expect(400);
    await pay(A.staff, { amountCentavos: 1300, method: 'gcash', referenceNo: '1234 567 890' }).expect(201);
    expect(await balance()).toBe(TOTAL - 101300);
  });

  it('rejects bad amounts, types, methods, and dates', async () => {
    for (const amountCentavos of [0, -100, 10.5, '100', undefined]) await pay(A.staff, { amountCentavos }).expect(400);
    await pay(A.staff, { amountCentavos: 100, type: 'gift' }).expect(400);
    await pay(A.staff, { amountCentavos: 100, method: 'cheque' }).expect(400);
    await pay(A.staff, { amountCentavos: 100, paidAt: '2999-01-01' }).expect(400);
    await pay(A.staff, { amountCentavos: 100, paidAt: 'yesterday' }).expect(400);
    expect((await pay(A.staff, { amountCentavos: 100, paidAt: '2000-01-01' }).expect(400)).body.error).toMatch(/before the delivery was received/);
  });

  it('accepts an earlier date for a payment written down on paper', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * DAY);
    const date = `${tenDaysAgo.getFullYear()}-${String(tenDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(tenDaysAgo.getDate()).padStart(2, '0')}`;
    const res = await pay(A.staff, { amountCentavos: 100, paidAt: date }).expect(201);
    const saved = await sys(() => models.Transaction.findById(res.body.transaction.id).lean());
    expect(saved.paidAt.getDate()).toBe(tenDaysAgo.getDate());
  });

  it('refuses cooperative stock and cancelled deliveries', async () => {
    expect((await post(A.staff, '/api/transactions', { batchId: coopBatchId, type: 'payment', method: 'cash', amountCentavos: 100 }).expect(400)).body.error).toMatch(/Cooperative stock has no fees/);
    const empty = (await post(A.staff, '/api/batches', { memberId: String(A.records.Member._id), declaredSackCount: 1 }).expect(201)).body.batch.id;
    await post(A.staff, `/api/batches/${empty}/cancel`).expect(200);
    await post(A.staff, '/api/transactions', { batchId: empty, type: 'payment', method: 'cash', amountCentavos: 100 }).expect(400);
  });

  it('records a double-tapped payment only once', async () => {
    const before = await balance();
    const first = await pay(A.staff, { amountCentavos: 1000, clientRequestId: 'tap-1' }).expect(201);
    const again = await pay(A.staff, { amountCentavos: 1000, clientRequestId: 'tap-1' }).expect(200);
    expect(again.body).toMatchObject({ repeat: true, transaction: { id: first.body.transaction.id } });
    expect(await balance()).toBe(before - 1000);
  });

  it('cannot be overpaid by two people paying the full balance at the same moment', async () => {
    const left = await balance();
    const results = await Promise.all([pay(A.staff, { amountCentavos: left }), pay(A.admin, { amountCentavos: left })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await balance()).toBe(0);
    expect((await pay(A.staff, { amountCentavos: 1 }).expect(400)).body.error).toBe('This delivery has no balance to pay.');
  });

  it('shows a receipt with the farmer, delivery, method, staff, and balance', async () => {
    const res = await get(A.staff, `/api/transactions/${firstReceipt}`).expect(200);
    expect(res.body.transaction).toMatchObject({
      receiptNo: `ALP-R-${YEAR}-0001`, type: 'payment', amountCentavos: 100000, method: 'cash',
      ownerName: 'Juan Alpha', memberNo: 'ALP-M-0001', recordedByName: 'Alpha Staff', voided: false,
    });
    expect(res.body.transaction.batchNo).toMatch(/^ALP-B-/);
    expect(res.body.cooperative.name).toBe('Alpha');
    expect(res.body.delivery).toEqual({ totalCentavos: TOTAL, balanceCentavos: 0, plan: null });
  });
});

describe('waivers, refunds, and voids', () => {
  it('are for the Cooperative Admin only', async () => {
    await post(A.staff, '/api/transactions', { batchId: guestBatchId, type: 'adjustment', amountCentavos: 100, notes: 'x' }).expect(403);
    await post(A.staff, '/api/transactions', { batchId, type: 'refund', method: 'cash', amountCentavos: 100 }).expect(403);
    const any = (await post(A.staff, '/api/transactions/search', {}).expect(200)).body.transactions[0];
    await post(A.staff, `/api/transactions/${any.id}/void`, { reason: 'x' }).expect(403);
  });

  it('records a waiver with a reason, and lowers the balance', async () => {
    await post(A.admin, '/api/transactions', { batchId: guestBatchId, type: 'adjustment', amountCentavos: 5000 }).expect(400);
    await post(A.admin, '/api/transactions', { batchId: guestBatchId, type: 'adjustment', amountCentavos: 35001, notes: 'Too much' }).expect(400);
    await post(A.admin, '/api/transactions', { batchId: guestBatchId, type: 'adjustment', amountCentavos: 5000, notes: 'Late harvest, approved by the board' }).expect(201);
    expect(await balance(guestBatchId)).toBe(30000);
  });

  it('refunds no more than was paid, and a refund raises the balance', async () => {
    await post(A.admin, '/api/transactions', { batchId: guestBatchId, type: 'payment', method: 'cash', amountCentavos: 30000 }).expect(201);
    expect((await post(A.admin, '/api/transactions', { batchId: guestBatchId, type: 'refund', method: 'cash', amountCentavos: 30001 }).expect(400)).body.error)
      .toBe('Only ₱300.00 has been paid that can be refunded.');
    await post(A.admin, '/api/transactions', { batchId: guestBatchId, type: 'refund', method: 'gcash', amountCentavos: 2000 }).expect(400); // no reference
    const refund = await post(A.admin, '/api/transactions', { batchId: guestBatchId, type: 'refund', method: 'cash', amountCentavos: 2000 }).expect(201);
    expect(await balance(guestBatchId)).toBe(2000);
    return refund;
  });

  it('voids an entry with a reason, which puts the balance back, and keeps the record', async () => {
    const list = (await post(A.admin, '/api/transactions/search', { q: 'Gina', type: 'payment' }).expect(200)).body.transactions;
    expect(list).toHaveLength(1);
    const payment = list[0];
    expect((await post(A.admin, `/api/transactions/${payment.id}/void`, {}).expect(400)).body.error).toMatch(/reason/);
    // Part of this payment was refunded, so the refund must be voided first.
    expect((await post(A.admin, `/api/transactions/${payment.id}/void`, { reason: 'Wrong farmer' }).expect(400)).body.error).toMatch(/Void the refund first/);
    const refund = (await post(A.admin, '/api/transactions/search', { q: 'Gina', type: 'refund' })).body.transactions[0];
    await post(A.admin, `/api/transactions/${refund.id}/void`, { reason: 'Refund not given' }).expect(200);
    await post(A.admin, `/api/transactions/${payment.id}/void`, { reason: 'Wrong farmer' }).expect(200);
    await post(A.admin, `/api/transactions/${payment.id}/void`, { reason: 'Again' }).expect(400);
    expect(await balance(guestBatchId)).toBe(30000);

    const receipt = (await get(A.admin, `/api/transactions/${payment.id}`).expect(200)).body.transaction;
    expect(receipt).toMatchObject({ voided: true, voidReason: 'Wrong farmer', voidedByName: 'Alpha Admin' });
    const log = await sys(() => models.AuditLog.findOne({ action: 'void', entityId: payment.id }).lean());
    expect(log.changes).toEqual([{ field: 'voided', from: null, to: 'Wrong farmer' }]);
    expect(await sys(() => models.Transaction.countDocuments({ _id: payment.id }))).toBe(1);
  });

  it('filters the list by status, type, and search text', async () => {
    const search = async (body) => (await post(A.admin, '/api/transactions/search', body).expect(200)).body;
    expect((await search({ status: 'voided' })).transactions.map((t) => t.type).sort()).toEqual(['payment', 'refund']);
    expect((await search({ type: 'adjustment' })).transactions.map((t) => t.notes)).toEqual(['Late harvest, approved by the board']);
    expect((await search({ q: `ALP-R-${YEAR}-0001` })).transactions.map((t) => t.amountCentavos)).toEqual([100000]);
    expect((await search({ q: '.*' })).total).toBe(0);
    expect((await search({ method: 'gcash' })).transactions.every((t) => t.method === 'gcash')).toBe(true);
  });
});

describe('separation and access', () => {
  it('keeps each cooperative\'s money apart', async () => {
    const theirs = (await post(B.admin, '/api/transactions/search', {}).expect(200)).body.transactions;
    expect(theirs.map((t) => t.receiptNo)).toEqual(['BRV-R-0001']); // only Bravo's seeded entry
    const ours = (await post(A.admin, '/api/transactions/search', {})).body.transactions[0];
    await get(B.admin, `/api/transactions/${ours.id}`).expect(404);
    await post(B.admin, `/api/transactions/${ours.id}/void`, { reason: 'x' }).expect(404);
    await post(B.admin, '/api/transactions', { batchId, type: 'payment', method: 'cash', amountCentavos: 100 }).expect(404);
    const summary = (await get(B.admin, '/api/transactions/summary')).body;
    expect(summary.outstandingCentavos).toBe(0);
  });

  it('is closed to farmers', async () => {
    await get(A.farmer, '/api/transactions').expect(403);
    await post(A.farmer, '/api/transactions', { batchId, type: 'payment', method: 'cash', amountCentavos: 100 }).expect(403);
  });
});

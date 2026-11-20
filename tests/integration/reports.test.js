import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, seedCooperative, cookieFor, models } from './helpers.js';
import app from '../../server/app.js';
import { asSystem } from '../../server/context.js';
import { encodeTagQr } from '../../server/lib/qr.js';
import { makeTagCode } from '../../server/lib/tagCode.js';

const DAY = 86_400_000;
const YEAR = new Date().getFullYear();
let A; let B; let batchId; let guestId; let guestBatchId;
const sys = (fn) => asSystem(fn);
const qr = (n) => encodeTagQr(makeTagCode('ALP', n), 'test-qr-secret');
const post = (user, path, body) => request(app).post(path).set('Cookie', cookieFor(user)).send(body);
const get = (user, path) => request(app).get(path).set('Cookie', cookieFor(user));
const report = async (path, user = A.staff) => (await get(user, `/api/reports/${path}`).expect(200)).body;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

beforeAll(async () => {
  await startDb();
  A = await seedCooperative('Alpha', 'ALP');
  B = await seedCooperative('Bravo', 'BRV');
  await sys(() => models.Batch.updateMany({}, { status: 'stored' }));
  for (const key of ['tag', 'tagLot', `batch:${YEAR}`]) {
    await sys(() => models.Counter.updateOne({ cooperativeId: A.coop._id, key }, { value: 1 }, { upsert: true }));
  }
  await models.Cooperative.updateOne({ _id: A.coop._id }, {
    'settings.fees.storageFeeCentavos': 10000, 'settings.fees.overdueFeePerDayCentavos': 500, 'settings.fees.memberDiscountPercent': 10,
    'subscription.enabledFeatures': ['pdf_reports'],
  });
  await post(A.admin, '/api/tag-lots', { quantity: 30 }).expect(201); // tags 2..31
  const q = String(A.records.Quadrant._id);
  const member = String(A.records.Member._id);
  // Member delivery: 10 sacks, 4 released, contract ended 2.5 days ago -> overdue.
  batchId = (await post(A.staff, '/api/batches', { memberId: member, declaredSackCount: 10, variety: 'Red Creole' }).expect(201)).body.batch.id;
  await post(A.staff, '/api/custody/gate-in-range', { batchId, quadrantId: q, first: qr(2), last: qr(11), method: 'range_scan' }).expect(201);
  await post(A.staff, `/api/batches/${batchId}/finish-receiving`).expect(200);
  const rel = (await post(A.admin, '/api/custody/releases', { batchId }).expect(201)).body.releaseNo;
  for (const n of [2, 3, 4, 5]) await post(A.admin, '/api/custody/gate-out', { batchId, releaseNo: rel, text: qr(n) }).expect(201);
  await post(A.staff, '/api/custody/move', { text: qr(6), toQuadrantId: (await post(A.admin, '/api/quadrants', { code: '1-B', floor: 1, capacity: 100, fillOrder: 2 })).body.quadrant._id }).expect(201);
  await post(A.staff, '/api/transactions', { batchId, type: 'payment', method: 'gcash', referenceNo: 'G-1', amountCentavos: 30000 }).expect(201);
  // Guest delivery: 3 sacks, partly paid then a refund.
  guestId = (await post(A.staff, '/api/members', { tier: 'guest', firstName: 'Gina', lastName: 'Guest', phone: '09170000009' }).expect(201)).body.member.id;
  guestBatchId = (await post(A.staff, '/api/batches', { memberId: guestId, declaredSackCount: 3 }).expect(201)).body.batch.id;
  await post(A.staff, '/api/custody/gate-in-range', { batchId: guestBatchId, quadrantId: q, first: qr(20), last: qr(22), method: 'range_typed' }).expect(201);
  await post(A.staff, `/api/batches/${guestBatchId}/finish-receiving`).expect(200);
  await post(A.staff, '/api/transactions', { batchId: guestBatchId, type: 'payment', method: 'cash', amountCentavos: 20000 }).expect(201);
  await post(A.admin, '/api/transactions', { batchId: guestBatchId, type: 'refund', method: 'cash', amountCentavos: 5000 }).expect(201);
  const damaged = await sys(() => models.Tag.findOne({ code: makeTagCode('ALP', 31) }).lean());
  await post(A.staff, `/api/tags/${damaged._id}/status`, { status: 'damaged' }).expect(200);
  await sys(() => models.Batch.updateOne({ _id: batchId }, { contractEnd: new Date(Date.now() - 2.5 * DAY) }));
}, 120_000);
afterAll(stopDb);

describe('reports', () => {
  it('inventory: quadrants, farmers, and deliveries, matching the dashboard', async () => {
    const r = await report('inventory');
    const d = (await get(A.staff, '/api/dashboard')).body;
    expect(r.totals).toMatchObject({ capacity: d.storage.capacity, stored: d.storage.stored, available: d.storage.available });
    expect(r.totals.stored).toBe(1 + 6 + 3);
    expect(r.quadrants.map((q) => [q.code, q.stored])).toEqual([['1-A', 9], ['1-B', 1]]);
    expect(r.farmers).toEqual([
      { ownerName: 'Juan Alpha', memberNo: 'ALP-M-0001', deliveries: 2, sacksStored: 7 },
      { ownerName: 'Gina Guest', memberNo: 'ALP-M-0002', deliveries: 1, sacksStored: 3 },
    ]);
    const mine = r.deliveries.find((x) => x.variety === 'Red Creole');
    expect(mine).toMatchObject({ ownerName: 'Juan Alpha', sacksReceived: 10, sacksStored: 6, overdue: true });
  });

  it('movements: sacks in, moved, and out per day and per staff member', async () => {
    const r = await report(`movements?from=${ymd(new Date(Date.now() - 6 * DAY))}&to=${ymd(new Date())}`);
    expect(r.totals).toEqual({ entries: 1 + 10 + 3, moves: 1, releases: 4 });
    expect(r.days.at(-1)).toEqual({ date: ymd(new Date()), entries: 14, moves: 1, releases: 4 });
    expect(r.staff).toEqual([
      { name: 'Alpha Admin', entries: 0, moves: 0, releases: 4 },
      { name: 'Alpha Staff', entries: 14, moves: 1, releases: 0 },
    ]);
    await get(A.staff, '/api/reports/movements?from=2026-05-01&to=2026-01-01').expect(400);
    await get(A.staff, '/api/reports/movements?from=2020-01-01&to=2026-01-01').expect(400);
    expect((await report('movements?from=2001-01-01&to=2001-01-31')).totals).toEqual({ entries: 0, moves: 0, releases: 0 });
  });

  it('fees: collections in the period and balances that match the Transactions page', async () => {
    const r = await report('fees');
    const summary = (await get(A.staff, '/api/transactions/summary')).body;
    expect(r.asOfToday).toMatchObject({ outstandingCentavos: summary.outstandingCentavos, unpaidDeliveries: summary.unpaidDeliveries, overdueFeesCentavos: summary.overdueFeesCentavos });
    // Seed's ₱500.00 cash + ₱300.00 GCash + ₱200.00 cash, minus a ₱50.00 cash refund.
    expect(r.period).toMatchObject({ paymentsCentavos: 50000 + 30000 + 20000, refundsCentavos: 5000, waivedCentavos: 0, netCollectedCentavos: 95000 });
    expect(r.period.byMethod).toEqual([
      { method: 'cash', paymentsCentavos: 70000, refundsCentavos: 5000 },
      { method: 'gcash', paymentsCentavos: 30000, refundsCentavos: 0 },
      { method: 'bank', paymentsCentavos: 0, refundsCentavos: 0 },
    ]);
    const detail = (await get(A.staff, `/api/batches/${batchId}`)).body.account;
    const row = r.deliveries.find((x) => x.memberNo === 'ALP-M-0001' && x.totalCentavos > 0);
    expect(row).toMatchObject({ totalCentavos: detail.totalCentavos, balanceCentavos: detail.balanceCentavos, overdueCentavos: detail.overdueCentavos });
  });

  it('overdue: deliveries past their contract end with sacks still stored', async () => {
    const r = await report('overdue');
    expect(r.deliveries).toHaveLength(1);
    const detail = (await get(A.staff, `/api/batches/${batchId}`)).body.account;
    expect(r.deliveries[0]).toMatchObject({ ownerName: 'Juan Alpha', daysOverdue: 3, sacksStored: 6, overdueCentavos: detail.overdueCentavos, balanceCentavos: detail.balanceCentavos });
    expect(r.totals).toMatchObject({ deliveries: 1, sacks: 6 });
  });

  it('tags: counts by status and lot, reuse, and damaged or lost tags', async () => {
    const r = await report('tags');
    // 31 tags: 10 on sacks (the 4 released ones are available again), 1 damaged.
    expect(r.totals).toEqual({ available: 20, assigned: 10, damaged: 1, lost: 0, retired: 0, all: 31 });
    expect(r.reuse).toMatchObject({ usedAtLeastOnce: 13, mostUses: 1, averageUses: 1 }); // the seed's tag was never scanned in
    expect(r.lots.find((l) => l.lotNo === 2)).toMatchObject({ quantity: 30, available: 20, assigned: 9, damaged: 1 });
    expect(r.problems).toEqual([{ code: makeTagCode('ALP', 31), status: 'damaged', lotNo: 2, lastScannedAt: null }]);
  });

  it('farmer masterlist: every farmer with deliveries, sacks, and balance matching the farmer page', async () => {
    const r = await report('members');
    expect(r.totals).toEqual({ all: 2, members: 1, guests: 1, traders: 0, inactive: 0 });
    for (const row of r.members) {
      const id = row.memberNo === 'ALP-M-0001' ? A.records.Member._id : guestId;
      const page = (await get(A.staff, `/api/members/${id}`)).body;
      expect(row.balanceCentavos).toBe(page.account.balanceCentavos);
      expect(row.sacksStored).toBe(page.storage.sacksStored);
    }
    expect(r.members.find((m) => m.memberNo === 'ALP-M-0002')).toMatchObject({ name: 'Guest, Gina', tier: 'guest', phone: '09170000009', deliveries: 1 });
  });

  it('statement of account: each delivery\'s charges and payments, with totals matching the farmer page', async () => {
    const r = await report(`statement/${guestId}`);
    expect(r.member).toMatchObject({ memberNo: 'ALP-M-0002', name: 'Gina Guest', tier: 'guest' });
    expect(r.deliveries).toHaveLength(1);
    const d = r.deliveries[0];
    expect(d.account.lines[0]).toMatchObject({ label: 'Storage fee', quantity: 3, amountCentavos: 30000 });
    expect(d.transactions.map((t) => [t.type, t.amountCentavos])).toEqual([['payment', 20000], ['refund', 5000]]);
    expect(r.totals).toMatchObject({ chargesCentavos: 30000, paidCentavos: 20000, refundedCentavos: 5000, balanceCentavos: 15000, sacksStored: 3 });
    const page = (await get(A.staff, `/api/members/${guestId}`)).body;
    expect(r.totals.balanceCentavos).toBe(page.account.balanceCentavos);
    await get(A.staff, `/api/reports/statement/${B.records.Member._id}`).expect(404);
  });

  it('records printing in the audit log, only when the plan includes it', async () => {
    await post(A.staff, '/api/reports/printed', { report: 'members' }).expect(200);
    await post(A.staff, '/api/reports/printed', { report: 'statement', memberId: guestId }).expect(200);
    await post(A.staff, '/api/reports/printed', { report: 'fees', format: 'csv' }).expect(200);
    await post(A.staff, '/api/reports/printed', { report: 'bogus' }).expect(400);
    await post(A.staff, '/api/reports/printed', { report: 'statement', memberId: String(B.records.Member._id) }).expect(404);
    const logs = await sys(() => models.AuditLog.find({ action: 'export', entityType: 'Report' }).sort('occurredAt').lean());
    expect(logs.map((l) => l.entityLabel)).toEqual(['Farmer masterlist', 'Statement of account: Gina Guest', 'Fees and collections report (downloaded as CSV)']);
    expect(logs.every((l) => l.actorName === 'Alpha Staff' && String(l.cooperativeId) === String(A.coop._id))).toBe(true);
    expect((await post(B.staff, '/api/reports/printed', { report: 'members' }).expect(403)).body.error).toMatch(/not available on your plan/);
  });

  it('is open to cooperative staff and admins, closed to farmers, and separate per cooperative', async () => {
    await get(A.farmer, '/api/reports/inventory').expect(403);
    await get(A.admin, '/api/reports/inventory').expect(200);
    const theirs = await report('members', B.staff);
    expect(theirs.members.map((m) => m.memberNo)).toEqual(['BRV-M-0001']);
    expect((await report('fees', B.staff)).period.paymentsCentavos).toBe(50000);
  });
});

describe('audit logs', () => {
  it('are for the Cooperative Admin only', async () => {
    await post(A.staff, '/api/audit-logs/search', {}).expect(403);
    await get(A.staff, '/api/audit-logs/filters').expect(403);
    await post(A.farmer, '/api/audit-logs/search', {}).expect(403);
  });

  it('list changes newest first with names, never record IDs', async () => {
    const r = (await post(A.admin, '/api/audit-logs/search', {}).expect(200)).body;
    expect(r.total).toBeGreaterThan(5);
    expect(r.entries[0]).toMatchObject({ action: 'export', entityLabel: 'Fees and collections report (downloaded as CSV)', actorName: 'Alpha Staff', actorRole: 'Cooperative Staff' });
    expect(Object.keys(r.entries[0]).sort()).toEqual(['action', 'actorName', 'actorRole', 'changes', 'entityLabel', 'entityType', 'id', 'occurredAt']);
    const dates = r.entries.map((e) => new Date(e.occurredAt).getTime());
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it('filter by person, record type, action, date, and search text', async () => {
    const search = async (body) => (await post(A.admin, '/api/audit-logs/search', body).expect(200)).body.entries;
    const filters = (await get(A.admin, '/api/audit-logs/filters').expect(200)).body;
    expect(filters.people).toEqual(['Alpha Admin', 'Alpha Staff']);
    expect(filters.types).toEqual(expect.arrayContaining(['Batch', 'Member', 'Report', 'Transaction']));
    expect((await search({ actorName: 'Alpha Admin' })).every((e) => e.actorName === 'Alpha Admin')).toBe(true);
    expect((await search({ entityType: 'Member' })).map((e) => e.entityLabel)).toContain('Gina Guest');
    expect((await search({ action: 'export' })).length).toBe(3);
    expect((await search({ q: 'gina' })).length).toBeGreaterThan(0);
    expect(await search({ q: '.*' })).toEqual([]);
    expect(await search({ from: '2001-01-01', to: '2001-12-31' })).toEqual([]);
    expect((await search({ action: 'bogus' })).length).toBeGreaterThan(5); // unknown action is ignored
  });

  it('never show another cooperative\'s entries', async () => {
    const theirs = (await post(B.admin, '/api/audit-logs/search', {}).expect(200)).body.entries;
    expect(theirs.every((e) => !String(e.actorName).startsWith('Alpha'))).toBe(true);
    expect((await get(B.admin, '/api/audit-logs/filters')).body.people).toEqual(['Bravo Admin']);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, seedCooperative, cookieFor, models } from './helpers.js';
import app from '../../server/app.js';
import { asSystem } from '../../server/context.js';
import { encodeTagQr } from '../../server/lib/qr.js';
import { makeTagCode } from '../../server/lib/tagCode.js';

let A; let B; let batchId;
const SECRET = 'test-qr-secret';
const sys = (fn) => asSystem(fn);
const code = (n) => makeTagCode('ALP', n);
const qr = (n, prefix = 'ALP') => encodeTagQr(makeTagCode(prefix, n), SECRET);
const post = (user, path, body) => request(app).post(path).set('Cookie', cookieFor(user)).send(body);
const quadrantId = () => String(A.records.Quadrant._id);
const range = (user, body) => post(user, '/api/custody/gate-in-range', { batchId, quadrantId: quadrantId(), ...body });
const tagsIn = (from, to) => sys(() => models.Tag.find({ code: { $in: Array.from({ length: to - from + 1 }, (_, i) => code(from + i)) } }).sort('code').lean());
const snapshot = async () => ({
  sacks: await sys(() => models.Sack.countDocuments({})),
  events: await sys(() => models.CustodyEvent.countDocuments({})),
  assigned: await sys(() => models.Tag.countDocuments({ status: 'assigned' })),
});

beforeAll(async () => {
  await startDb();
  A = await seedCooperative('Alpha', 'ALP');
  B = await seedCooperative('Bravo', 'BRV');
  await sys(() => models.Batch.updateMany({}, { status: 'stored' }));
  for (const key of ['tag', 'tagLot']) {
    await sys(() => models.Counter.updateOne({ cooperativeId: A.coop._id, key }, { value: 1 }, { upsert: true }));
  }
  await sys(() => models.Counter.updateOne({ cooperativeId: A.coop._id, key: `batch:${new Date().getFullYear()}` }, { value: 1 }, { upsert: true }));
  await post(A.admin, '/api/tag-lots', { quantity: 400 }).expect(201); // tags 2..401
  batchId = (await post(A.staff, '/api/batches', { memberId: String(A.records.Member._id), declaredSackCount: 150 }).expect(201)).body.batch.id;
}, 120_000);
afterAll(stopDb);

describe('gate-in by range', () => {
  it('previews a range without changing anything', async () => {
    const before = await snapshot();
    const res = await range(A.staff, { first: qr(2), last: qr(101), method: 'range_scan', dryRun: true }).expect(200);
    expect(res.body).toMatchObject({ dryRun: true, assigned: 100, firstCode: code(2), lastCode: code(101), received: 0, declared: 150, quadrant: { code: '1-A' } });
    expect(await snapshot()).toEqual(before);
  });

  it('binds 100 tags to 100 new sacks from two scans, each with its own custody event', async () => {
    const res = await range(A.staff, { first: qr(2), last: qr(101), method: 'range_scan', clientEventId: 'range-1' }).expect(201);
    expect(res.body).toMatchObject({ assigned: 100, firstSackNo: 1, lastSackNo: 100, firstCode: code(2), lastCode: code(101), received: 100, declared: 150 });

    const tags = await tagsIn(2, 101);
    expect(tags).toHaveLength(100);
    expect(tags.every((t) => t.status === 'assigned' && t.useCount === 1 && t.lastScannedAt && t.currentSackId)).toBe(true);

    const sacks = await sys(() => models.Sack.find({ batchId }).sort('sackNo').lean());
    expect(sacks.map((s) => s.sackNo)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(sacks.every((s) => s.status === 'stored' && String(s.quadrantId) === quadrantId() && String(s.memberId) === String(A.records.Member._id))).toBe(true);
    // Tag and sack point at each other, one to one, in tag-number order.
    const tagById = new Map(tags.map((t) => [String(t._id), t]));
    sacks.forEach((sack, i) => {
      const tag = tagById.get(String(sack.currentTagId));
      expect(tag.code).toBe(code(2 + i));
      expect(String(tag.currentSackId)).toBe(String(sack._id));
    });
    expect(new Set(sacks.map((s) => String(s.currentTagId))).size).toBe(100);

    const events = await sys(() => models.CustodyEvent.find({ batchId, type: 'gate_in' }).lean());
    expect(events).toHaveLength(100);
    expect(events.every((e) => e.method === 'range_scan' && e.performedByName === 'Alpha Staff' && e.occurredAt)).toBe(true);
    expect(events[0].notes).toBe(`Range ${code(2)} to ${code(101)} (100 tags)`);
    expect(new Set(events.map((e) => String(e.sackId))).size).toBe(100);
  });

  it('marks the range in the tag history and the audit log', async () => {
    const [tag] = await tagsIn(50, 50);
    const res = await request(app).get(`/api/tags/${tag._id}`).set('Cookie', cookieFor(A.staff)).expect(200);
    expect(res.body.history[0]).toMatchObject({ type: 'gate_in', method: 'range_scan', performedByName: 'Alpha Staff' });
    expect(res.body.sack).toMatchObject({ sackNo: 49, quadrantCode: '1-A' });
    const log = await sys(() => models.AuditLog.findOne({ entityLabel: /tags assigned by range/ }).lean());
    expect(log.changes[0]).toEqual({ field: 'range (first and last scanned)', from: null, to: `Range ${code(2)} to ${code(101)} (100 tags)` });
  });

  it('records a retried request only once', async () => {
    const before = await snapshot();
    const retry = await range(A.staff, { first: qr(2), last: qr(101), method: 'range_scan', clientEventId: 'range-1' }).expect(200);
    expect(retry.body).toMatchObject({ repeat: true, assigned: 100, received: 100 });
    expect(await snapshot()).toEqual(before);
  });

  it('accepts typed tag numbers or codes in either order, and records them as typed', async () => {
    const res = await range(A.admin, { first: '111', last: code(102), method: 'range_typed' }).expect(201);
    expect(res.body).toMatchObject({ assigned: 10, firstSackNo: 101, lastSackNo: 110, firstCode: code(102), lastCode: code(111), received: 110 });
    const events = await sys(() => models.CustodyEvent.find({ batchId, method: 'range_typed' }).lean());
    expect(events).toHaveLength(10);
    const log = await sys(() => models.AuditLog.findOne({ 'changes.field': 'range (typed, not scanned)' }).lean());
    expect(log.actorName).toBe('Alpha Admin');
  });

  it('with the scan method, refuses typed codes, forged codes, and other cooperatives\' tags', async () => {
    const before = await snapshot();
    expect((await range(A.staff, { first: code(120), last: qr(125), method: 'range_scan' }).expect(400)).body.error).toMatch(/First tag: Scan the QR code/);
    expect((await range(A.staff, { first: qr(120), last: `${code(125)}.AAAAAAAAAA`, method: 'range_scan' }).expect(400)).body.error).toMatch(/Last tag: .*security check/);
    await range(A.staff, { first: qr(1, 'BRV'), last: qr(125), method: 'range_scan' }).expect(404);
    await range(A.staff, { first: qr(120), last: qr(125), method: 'scan' }).expect(400);
    await range(A.staff, { first: qr(120), method: 'range_scan' }).expect(400);
    expect(await snapshot()).toEqual(before);
  });

  it('rejects bad typed input', async () => {
    for (const [first, last] of [['abc', '5'], ['0', '5'], [makeTagCode('BRV', 3), '5'], ['ALP-000120-', '125'], ['', '5']]) {
      await range(A.staff, { first, last, method: 'range_typed' }).expect(400);
    }
  });

  it('is all-or-nothing: one unusable tag in the range stops the whole range', async () => {
    const [damaged] = await tagsIn(123, 123);
    await post(A.staff, `/api/tags/${damaged._id}/status`, { status: 'damaged' }).expect(200);
    const before = await snapshot();
    // 111 is already on a sack and 123 is damaged; the other 13 are fine.
    const res = await range(A.staff, { first: '111', last: '125', method: 'range_typed' }).expect(409);
    expect(res.body.error).toBe('2 of the 15 tags in this range cannot be used. Nothing was assigned.');
    expect(res.body.details).toEqual([{ code: code(111), problem: 'already on a sack' }, { code: code(123), problem: 'damaged' }]);
    const missing = await range(A.staff, { first: '400', last: '405', method: 'range_typed' }).expect(409);
    expect(missing.body.details.map((d) => d.problem)).toEqual(['not registered', 'not registered', 'not registered', 'not registered']);
    expect(await snapshot()).toEqual(before);
    expect((await tagsIn(120, 122)).every((t) => t.status === 'available')).toBe(true);
  });

  it('cannot exceed the sacks still expected, the quadrant\'s room, or 1,000 tags', async () => {
    // 110 of 150 are tagged, so 40 more are expected.
    expect((await range(A.staff, { first: '200', last: '240', method: 'range_typed' }).expect(400)).body.error)
      .toBe('This range has 41 tags, but only 40 more sacks are expected for this delivery.');
    expect((await range(A.staff, { first: '1', last: '1001', method: 'range_typed' }).expect(400)).body.error).toMatch(/up to 1,000 tags/);

    const small = (await post(A.admin, '/api/quadrants', { code: '9-Z', floor: 9, capacity: 5, fillOrder: 99 }).expect(201)).body.quadrant;
    expect((await range(A.staff, { first: '200', last: '205', method: 'range_typed', quadrantId: small._id }).expect(409)).body.error)
      .toBe('9-Z has room for 5 sacks, but this range has 6. Use a smaller range or another quadrant.');
    await range(A.staff, { first: '200', last: '204', method: 'range_typed', quadrantId: small._id }).expect(201);
  });

  it('works alongside single scans, and stops when the delivery is complete', async () => {
    const one = await post(A.staff, '/api/custody/gate-in', { batchId, text: qr(210), quadrantId: quadrantId() }).expect(201);
    expect(one.body.sack.sackNo).toBe(116);
    await range(A.staff, { first: '211', last: '244', method: 'range_typed' }).expect(201); // 34 more = 150
    expect((await range(A.staff, { first: '250', last: '250', method: 'range_typed' }).expect(400)).body.error).toBe('All 150 sacks of this delivery are already tagged.');
    const sacks = await sys(() => models.Sack.find({ batchId }).sort('sackNo').lean());
    expect(sacks.map((s) => s.sackNo)).toEqual(Array.from({ length: 150 }, (_, i) => i + 1));
    expect(new Set(sacks.map((s) => String(s.currentTagId))).size).toBe(150);
    const single = await sys(() => models.CustodyEvent.findOne({ sackId: one.body.sack.id }).lean());
    expect(single.method).toBe('scan');
  });

  it('lets only one of two overlapping ranges win', async () => {
    const other = (await post(A.staff, '/api/batches', { memberId: String(A.records.Member._id), declaredSackCount: 60 }).expect(201)).body.batch.id;
    const go = (first, last) => post(A.staff, '/api/custody/gate-in-range', { batchId: other, quadrantId: quadrantId(), first, last, method: 'range_typed' });
    const results = await Promise.all([go('300', '320'), go('310', '330')]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const assigned = (await tagsIn(300, 330)).filter((t) => t.status === 'assigned');
    expect(assigned).toHaveLength(21);
    expect(await sys(() => models.Sack.countDocuments({ batchId: other }))).toBe(21);
    expect(new Set(assigned.map((t) => String(t.currentSackId))).size).toBe(21);
  });

  it('is closed to farmers, other cooperatives, and deliveries that are not being received', async () => {
    await range(A.farmer, { first: '350', last: '351', method: 'range_typed' }).expect(403);
    await range(B.staff, { first: '350', last: '351', method: 'range_typed' }).expect(404);
    await post(A.staff, `/api/batches/${batchId}/finish-receiving`).expect(200);
    await range(A.staff, { first: '350', last: '351', method: 'range_typed' }).expect(400);
  });
});

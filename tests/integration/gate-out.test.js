import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, seedCooperative, cookieFor, models } from './helpers.js';
import app from '../../server/app.js';
import { asSystem } from '../../server/context.js';
import { encodeTagQr } from '../../server/lib/qr.js';
import { makeTagCode } from '../../server/lib/tagCode.js';

let A; let B; let batchId; let otherBatchId; let q1; let q2; let releaseNo;
const SECRET = 'test-qr-secret';
const sys = (fn) => asSystem(fn);
const code = (n) => makeTagCode('ALP', n);
const qr = (n, prefix = 'ALP') => encodeTagQr(makeTagCode(prefix, n), SECRET);
const post = (user, path, body) => request(app).post(path).set('Cookie', cookieFor(user)).send(body);
const get = (user, path) => request(app).get(path).set('Cookie', cookieFor(user));
const tagOf = (n) => sys(() => models.Tag.findOne({ code: code(n) }).lean());
const sackOfTag = async (n) => sys(async () => models.Sack.findOne({ currentTagId: (await models.Tag.findOne({ code: code(n) }))._id }).lean());
const out = (user, n, extra = {}) => post(user, '/api/custody/gate-out', { batchId, releaseNo, text: qr(n), ...extra });
const move = (user, n, toQuadrantId, extra = {}) => post(user, '/api/custody/move', { text: qr(n), toQuadrantId, ...extra });
const batch = async (id = batchId) => (await get(A.staff, `/api/batches/${id}`).expect(200)).body;

beforeAll(async () => {
  await startDb();
  A = await seedCooperative('Alpha', 'ALP');
  B = await seedCooperative('Bravo', 'BRV');
  await sys(() => models.Batch.updateMany({}, { status: 'stored' }));
  for (const key of ['tag', 'tagLot', `batch:${new Date().getFullYear()}`]) {
    await sys(() => models.Counter.updateOne({ cooperativeId: A.coop._id, key }, { value: 1 }, { upsert: true }));
  }
  q1 = String(A.records.Quadrant._id);
  q2 = (await post(A.admin, '/api/quadrants', { code: '1-B', floor: 1, capacity: 2, fillOrder: 2 }).expect(201)).body.quadrant._id;
  await post(A.admin, '/api/tag-lots', { quantity: 40 }).expect(201); // tags 2..41
  const member = String(A.records.Member._id);
  batchId = (await post(A.staff, '/api/batches', { memberId: member, declaredSackCount: 5 }).expect(201)).body.batch.id;
  await post(A.staff, '/api/custody/gate-in-range', { batchId, quadrantId: q1, first: qr(2), last: qr(6), method: 'range_scan' }).expect(201); // sacks 1..5
  otherBatchId = (await post(A.staff, '/api/batches', { memberId: member, declaredSackCount: 2 }).expect(201)).body.batch.id;
  await post(A.staff, '/api/custody/gate-in-range', { batchId: otherBatchId, quadrantId: q1, first: qr(10), last: qr(11), method: 'range_scan' }).expect(201);
}, 120_000);
afterAll(stopDb);

describe('moving sacks', () => {
  it('moves a scanned sack to another quadrant and records from, to, who, and when', async () => {
    const res = await move(A.staff, 2, q2).expect(201);
    expect(res.body).toMatchObject({ repeat: false, sack: { sackNo: 1 }, tag: { code: code(2) }, from: { code: '1-A' }, to: { code: '1-B', free: 1 } });
    expect(String((await sackOfTag(2)).quadrantId)).toBe(q2);
    const event = await sys(() => models.CustodyEvent.findOne({ type: 'move' }).lean());
    expect(event).toMatchObject({ performedByName: 'Alpha Staff', method: 'scan' });
    expect([String(event.fromQuadrantId), String(event.toQuadrantId)]).toEqual([q1, q2]);
    expect((await tagOf(2)).status).toBe('assigned');
  });

  it('refuses a move to the same place, to a full or turned-off quadrant, and typed or unknown tags', async () => {
    expect((await move(A.staff, 2, q2).expect(409)).body.error).toBe('This sack is already in 1-B.');
    await move(A.staff, 3, q2).expect(201);
    expect((await move(A.staff, 4, q2).expect(409)).body.error).toBe('1-B is full. Choose another quadrant.');
    expect(String((await sackOfTag(4)).quadrantId)).toBe(q1);
    await post(A.staff, '/api/custody/move', { text: code(4), toQuadrantId: q2 }).expect(400);     // typed
    await move(A.staff, 30, q1).expect(409);                                                         // a tag that is not on a sack
    await move(A.staff, 4, String(B.records.Quadrant._id)).expect(400);                               // another cooperative's quadrant
    await move(A.staff, 4, undefined).expect(400);
    await move(B.staff, 4, String(B.records.Quadrant._id)).expect(404);                               // another cooperative's sack
    expect(await sys(() => models.CustodyEvent.countDocuments({ type: 'move' }))).toBe(2);
  });

  it('records a retried move once', async () => {
    await move(A.staff, 3, q1, { clientEventId: 'mv-1' }).expect(201);
    expect((await move(A.staff, 3, q1, { clientEventId: 'mv-1' }).expect(200)).body).toMatchObject({ repeat: true, to: { code: '1-A' } });
    expect(await sys(() => models.CustodyEvent.countDocuments({ type: 'move' }))).toBe(3);
  });
});

describe('releasing sacks (gate-out)', () => {
  it('cannot start a release for a delivery that is still being received', async () => {
    expect((await post(A.staff, '/api/custody/releases', { batchId }).expect(400)).body.error).toMatch(/Finish receiving/);
    await post(A.staff, `/api/batches/${batchId}/finish-receiving`).expect(200);
    await post(A.staff, `/api/batches/${otherBatchId}/finish-receiving`).expect(200);
  });

  it('starts a release with its own number', async () => {
    releaseNo = (await post(A.staff, '/api/custody/releases', { batchId }).expect(201)).body.releaseNo;
    expect(releaseNo).toBe(`ALP-REL-${new Date().getFullYear()}-0001`);
    await post(B.staff, '/api/custody/releases', { batchId }).expect(404);
  });

  it('releases a scanned sack, frees its tag, and records the custody event', async () => {
    const before = await tagOf(4);
    const res = await out(A.staff, 4).expect(201);
    expect(res.body).toMatchObject({ repeat: false, sack: { sackNo: 3 }, tag: { code: code(4) }, released: 1, remaining: 4, batchStatus: 'partly_released' });

    const sack = await sys(() => models.Sack.findById(res.body.sack.id).lean());
    expect(sack).toMatchObject({ status: 'released', currentTagId: null });
    expect(Date.now() - new Date(sack.gateOutAt).getTime()).toBeLessThan(10_000);
    const tag = await tagOf(4);
    expect(tag).toMatchObject({ status: 'available', currentSackId: null, useCount: before.useCount });

    const event = await sys(() => models.CustodyEvent.findOne({ type: 'gate_out', sackId: sack._id }).lean());
    expect(event).toMatchObject({ performedByName: 'Alpha Staff', releaseNo });
    expect(String(event.performedBy)).toBe(String(A.staff._id));
    expect(String(event.fromQuadrantId)).toBe(q1);
    expect((await batch()).batch).toMatchObject({ status: 'partly_released', sacksStored: 4, sacksReceived: 5 });
  });

  it('keeps the full history per tag and per sack', async () => {
    const tag = await tagOf(4);
    const history = (await get(A.staff, `/api/tags/${tag._id}`).expect(200)).body;
    expect(history.history.map((h) => h.type)).toEqual(['gate_out', 'gate_in']);
    expect(history.sack).toBeNull();
    expect(history.tag.allowedChanges).toEqual(['damaged', 'lost', 'retired']);
    const sackEvents = await sys(async () => models.CustodyEvent.find({ sackId: (await models.Sack.findOne({ batchId, sackNo: 3 }))._id }).sort('occurredAt').lean());
    expect(sackEvents.map((e) => e.type)).toEqual(['gate_in', 'gate_out']);
  });

  it('lets a released tag be reused on a new sack, counting the reuse', async () => {
    const fresh = (await post(A.staff, '/api/batches', { memberId: String(A.records.Member._id), declaredSackCount: 1 }).expect(201)).body.batch.id;
    await post(A.staff, '/api/custody/gate-in', { batchId: fresh, text: qr(4), quadrantId: q1 }).expect(201);
    const tag = await tagOf(4);
    expect(tag).toMatchObject({ status: 'assigned', useCount: 2 });
    const history = (await get(A.staff, `/api/tags/${tag._id}`)).body.history.map((h) => h.type);
    expect(history).toEqual(['gate_in', 'gate_out', 'gate_in']);
    await post(A.staff, `/api/batches/${fresh}/finish-receiving`).expect(200);
  });

  it('refuses a sack from another delivery, a tag not on a sack, and anything not scanned', async () => {
    const stored = () => sys(() => models.Sack.countDocuments({ status: 'stored' }));
    const before = await stored();
    const wrong = await out(A.staff, 10).expect(409);
    expect(wrong.body.error).toMatch(/belongs to another delivery \(ALP-B-\d{4}-0003\)\. It was not released/);
    expect((await out(A.staff, 30).expect(409)).body.error).toBe('This tag is not on a sack.');
    await post(A.staff, '/api/custody/gate-out', { batchId, releaseNo, text: code(5) }).expect(400);                  // typed
    await post(A.staff, '/api/custody/gate-out', { batchId, releaseNo, text: `${code(5)}.AAAAAAAAAA` }).expect(400);  // forged
    await out(A.staff, 5, { releaseNo: undefined }).expect(400);
    await out(A.staff, 5, { releaseNo: 'nonsense' }).expect(400);
    await out(B.staff, 5).expect(404);
    await out(A.farmer, 5).expect(403);
    expect(await stored()).toBe(before);
    expect((await tagOf(10)).status).toBe('assigned');
  });

  it('cannot release the same sack twice, even from two phones at once', async () => {
    const results = await Promise.all([out(A.staff, 5), out(A.admin, 5)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await out(A.staff, 5).expect(409)).body.error).toBe('This tag is not on a sack.');
    expect(await sys(() => models.CustodyEvent.countDocuments({ type: 'gate_out', tagId: null }))).toBe(0);
    const five = await tagOf(5);
    expect(await sys(() => models.CustodyEvent.countDocuments({ type: 'gate_out', tagId: five._id }))).toBe(1);
  });

  it('records a retried scan once', async () => {
    const first = await out(A.staff, 6, { clientEventId: 'out-1' }).expect(201);
    const retry = await out(A.staff, 6, { clientEventId: 'out-1' }).expect(200);
    expect(retry.body).toMatchObject({ repeat: true, sack: { sackNo: first.body.sack.sackNo }, released: 3, remaining: 2 });
  });

  it('keeps a release number to one delivery', async () => {
    const res = await post(A.staff, '/api/custody/gate-out', { batchId: otherBatchId, releaseNo, text: qr(10) }).expect(400);
    expect(res.body.error).toMatch(/belongs to another delivery/);
    expect((await tagOf(10)).status).toBe('assigned');
  });

  it('gives the release slip: farmer, sacks released, sacks remaining, date, and staff', async () => {
    const { slip } = (await get(A.staff, `/api/custody/releases/${releaseNo}`).expect(200)).body;
    expect(slip).toMatchObject({
      releaseNo, ownerName: 'Juan Alpha', memberNo: 'ALP-M-0001', sacksReleased: 3, sacksRemaining: 2, sacksReceived: 5,
      cooperative: { name: 'Alpha', facilityName: 'Alpha Cold Storage' },
    });
    expect(slip.staff.sort()).toEqual(['Alpha Admin', 'Alpha Staff'].filter((n) => slip.staff.includes(n)));
    expect(slip.staff).toContain('Alpha Staff');
    expect(slip.sacks.map((s) => s.tagCode).sort()).toEqual([code(4), code(5), code(6)]);
    expect(slip.sacks.every((s) => s.sackNo && s.quadrantCode && s.releasedAt)).toBe(true);
    expect(slip.startedAt).toBeTruthy();
    await get(B.staff, `/api/custody/releases/${releaseNo}`).expect(404);
    await get(A.staff, '/api/custody/releases/ALP-REL-2026-9999').expect(404);
    expect((await batch()).releases).toEqual([expect.objectContaining({ releaseNo, sacks: 3 })]);
  });

  it('marks the delivery released when its last sack leaves, in a second release', async () => {
    releaseNo = (await post(A.staff, '/api/custody/releases', { batchId }).expect(201)).body.releaseNo;
    expect(releaseNo).toMatch(/-0002$/);
    await out(A.staff, 2).expect(201);
    const last = await out(A.staff, 3).expect(201);
    expect(last.body).toMatchObject({ released: 2, remaining: 0, batchStatus: 'released' });
    const done = await batch();
    expect(done.batch).toMatchObject({ status: 'released', sacksStored: 0, overdue: false });
    expect(done.releases.map((r) => r.sacks)).toEqual([2, 3]);
    expect((await post(A.staff, '/api/custody/releases', { batchId }).expect(400)).body.error).toMatch(/no sacks in storage/);
    // Space is free again, and the farmer's stored count went down.
    const summary = (await get(A.staff, '/api/batches/summary')).body;
    expect(summary.quadrants.find((q) => q.code === '1-B').used).toBe(0);
  });
});

describe('replacing a tag', () => {
  const replace = (user, oldTagId, n, reason, extra = {}) =>
    post(user, '/api/custody/replace-tag', { oldTagId, newText: qr(n), reason, ...extra });

  it('puts a new scanned tag on the sack and marks the old one damaged or lost', async () => {
    const old = await tagOf(10);
    const sackBefore = await sackOfTag(10);
    const res = await replace(A.staff, old._id, 20, 'damaged', { notes: 'Clip broke' }).expect(201);
    expect(res.body).toMatchObject({ oldTag: { code: code(10), status: 'damaged' }, newTag: { code: code(20) }, sack: { sackNo: sackBefore.sackNo } });

    expect(await tagOf(10)).toMatchObject({ status: 'damaged', currentSackId: null });
    const fresh = await tagOf(20);
    expect(fresh).toMatchObject({ status: 'assigned', useCount: 1 });
    const sack = await sys(() => models.Sack.findById(sackBefore._id).lean());
    expect(String(sack.currentTagId)).toBe(String(fresh._id));
    expect(sack.status).toBe('stored');
    expect(String(sack.quadrantId)).toBe(String(sackBefore.quadrantId));

    const oldHistory = (await get(A.staff, `/api/tags/${old._id}`)).body.history;
    expect(oldHistory[0]).toMatchObject({ type: 'tag_replaced', notes: `Marked damaged. Replaced by ${code(20)}. Clip broke` });
    const newHistory = (await get(A.staff, `/api/tags/${fresh._id}`)).body;
    expect(newHistory.history[0]).toMatchObject({ type: 'tag_replaced', notes: `Replaces ${code(10)} (damaged).` });
    expect(newHistory.sack.sackNo).toBe(sackBefore.sackNo);
    const log = await sys(() => models.AuditLog.findOne({ entityLabel: /tag replaced/ }).lean());
    expect(log.changes).toEqual([{ field: 'tag', from: code(10), to: code(20) }]);
  });

  it('the sack can then be released with its new tag, not the old one', async () => {
    const rel = (await post(A.staff, '/api/custody/releases', { batchId: otherBatchId }).expect(201)).body.releaseNo;
    await post(A.staff, '/api/custody/gate-out', { batchId: otherBatchId, releaseNo: rel, text: qr(10) }).expect(409);
    await post(A.staff, '/api/custody/gate-out', { batchId: otherBatchId, releaseNo: rel, text: qr(20) }).expect(201);
  });

  it('refuses a bad reason, a typed or used new tag, the same tag, and a tag that is not on a sack', async () => {
    const old = await tagOf(11);
    await replace(A.staff, old._id, 21, 'retired').expect(400);
    await post(A.staff, '/api/custody/replace-tag', { oldTagId: old._id, newText: code(21), reason: 'lost' }).expect(400); // typed
    await replace(A.staff, old._id, 11, 'lost').expect(400);                                                            // itself
    const inUse = await sys(() => models.Tag.findOne({ status: 'assigned', _id: { $ne: old._id } }).lean());
    const usedNo = Number(inUse.code.split('-')[1]);
    await replace(A.staff, old._id, usedNo, 'lost').expect(409);
    await replace(A.staff, (await tagOf(30))._id, 21, 'lost').expect(400);                                              // 30 is not on a sack
    await replace(B.staff, old._id, 21, 'lost').expect(404);
    expect((await tagOf(11)).status).toBe('assigned');
    expect((await tagOf(21)).status).toBe('available');
    await replace(A.staff, old._id, 21, 'lost').expect(201);
    expect((await tagOf(11)).status).toBe('lost');
  });
});

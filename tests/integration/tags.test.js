import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, seedCooperative, cookieFor, models } from './helpers.js';
import app from '../../server/app.js';
import { asSystem } from '../../server/context.js';
import { encodeTagQr, decodeTagQr } from '../../server/lib/qr.js';
import { makeTagCode, isValidTagCode } from '../../server/lib/tagCode.js';

let A; let B;
const SECRET = 'test-qr-secret';
const as = (user) => {
  const call = (method) => (path, body) => request(app)[method](path).set('Cookie', cookieFor(user)).send(body);
  return { get: call('get'), post: call('post') };
};
const sys = (fn) => asSystem(fn);
const tagByCode = (code) => sys(() => models.Tag.findOne({ code }).lean());

beforeAll(async () => {
  await startDb();
  A = await seedCooperative('Alpha', 'ALP'); // already has tag ALP-000001 (assigned to a sack)
  B = await seedCooperative('Bravo', 'BRV');
  await models.Cooperative.updateOne({ _id: A.coop._id }, { 'subscription.enabledFeatures': ['tag_import', 'tag_reconciliation'] });
  // The shared seed created tag 1, lot 1, and an open count 1 directly, without
  // the counters. Line the counters up and close that count.
  for (const coop of [A.coop, B.coop]) {
    for (const key of ['tag', 'tagLot', 'tagCount']) {
      await sys(() => models.Counter.updateOne({ cooperativeId: coop._id, key }, { value: 1 }, { upsert: true }));
    }
  }
  await sys(() => models.TagCount.updateMany({}, { status: 'finished', result: { missing: [] } }));
}, 120_000);
afterAll(stopDb);

describe('tag lots', () => {
  let lot;

  it('generates a lot of tags with the next serial numbers', async () => {
    const res = await as(A.admin).post('/api/tag-lots', { quantity: 5, notes: 'First order' }).expect(201);
    lot = res.body.lot;
    expect(lot).toMatchObject({
      lotNo: 2, source: 'generated', quantity: 5, createdByName: 'Alpha Admin', printedAt: null,
      firstCode: makeTagCode('ALP', 2), lastCode: makeTagCode('ALP', 6),
    });
    const tags = await sys(() => models.Tag.find({ tagLotId: lot.id }).sort('code').lean());
    expect(tags.map((t) => t.code)).toEqual([2, 3, 4, 5, 6].map((n) => makeTagCode('ALP', n)));
    expect(tags.every((t) => t.status === 'available' && t.qrSigned && String(t.cooperativeId) === String(A.coop._id))).toBe(true);
    expect(tags.every((t) => /^ALP-\d{6}-[A-Z]$/.test(t.code) && isValidTagCode(t.code))).toBe(true);
  });

  it('never repeats a number, even when two lots are made at the same time', async () => {
    const [x, y] = await Promise.all([
      as(A.admin).post('/api/tag-lots', { quantity: 20 }),
      as(A.admin).post('/api/tag-lots', { quantity: 20 }),
    ]);
    expect([x.status, y.status]).toEqual([201, 201]);
    const codes = (await sys(() => models.Tag.find({ cooperativeId: A.coop._id }).lean())).map((t) => t.code);
    expect(codes.length).toBe(46);
    expect(new Set(codes).size).toBe(46);
  });

  it('rejects bad quantities and leaves nothing behind', async () => {
    const before = await sys(() => models.Tag.countDocuments({}));
    for (const quantity of [0, -1, 1.5, 1001, 'ten', undefined]) {
      await as(A.admin).post('/api/tag-lots', { quantity }).expect(400);
    }
    expect(await sys(() => models.Tag.countDocuments({}))).toBe(before);
  });

  it('is for the Cooperative Admin; staff can only view', async () => {
    await as(A.staff).get('/api/tag-lots').expect(200);
    await as(A.staff).post('/api/tag-lots', { quantity: 1 }).expect(403);
    await as(A.staff).get(`/api/tag-lots/${lot.id}/print`).expect(403);
    await as(A.staff).post('/api/tag-lots/import', { entries: [makeTagCode('ALP', 900)] }).expect(403);
  });

  it('gives the print sheet QR text holding only the tag code and a signature', async () => {
    const res = await as(A.admin).get(`/api/tag-lots/${lot.id}/print`).expect(200);
    expect(res.body.tags).toHaveLength(5);
    for (const { code, qr } of res.body.tags) {
      expect(qr).toBe(encodeTagQr(code, SECRET));
      expect(qr).toMatch(/^ALP-\d{6}-[A-Z]\.[A-Za-z0-9_-]{10}$/);
      expect(decodeTagQr(qr, SECRET)).toBe(code);
    }
    expect(JSON.stringify(res.body)).not.toMatch(/Juan|memberId|batchId/);

    const printed = await as(A.admin).post(`/api/tag-lots/${lot.id}/printed`).expect(200);
    expect(printed.body.lot.printedAt).toBeTruthy();
    const log = await sys(() => models.AuditLog.findOne({ action: 'export', entityType: 'TagLot' }).lean());
    expect(log.entityLabel).toBe('Tag Lot 2 print sheet');
  });

  it('cannot print or see another cooperative\'s lot', async () => {
    await as(B.admin).get(`/api/tag-lots/${lot.id}/print`).expect(404);
    await as(B.admin).post(`/api/tag-lots/${lot.id}/printed`).expect(404);
    expect((await as(B.admin).get('/api/tag-lots')).body.lots.map((l) => l.lotNo)).toEqual([1]);
  });
});

describe('importing pre-printed tags', () => {
  const signed = encodeTagQr(makeTagCode('ALP', 500), SECRET);
  const bare = makeTagCode('ALP', 501);

  it('registers signed and unsigned tags and moves the serial counter past them', async () => {
    const res = await as(A.admin).post('/api/tag-lots/import', { entries: [signed, ` ${bare.toLowerCase()} `] }).expect(201);
    expect(res.body.lot).toMatchObject({ source: 'imported', quantity: 2, firstCode: makeTagCode('ALP', 500), lastCode: bare });
    expect(await tagByCode(makeTagCode('ALP', 500))).toMatchObject({ source: 'imported', qrSigned: true, status: 'available' });
    expect(await tagByCode(bare)).toMatchObject({ source: 'imported', qrSigned: false });

    const next = await as(A.admin).post('/api/tag-lots', { quantity: 1 }).expect(201);
    expect(next.body.lot.firstCode).toBe(makeTagCode('ALP', 502));
  });

  it('rejects the whole file when any line is wrong, and says which lines', async () => {
    const before = await sys(() => models.Tag.countDocuments({}));
    const good = makeTagCode('ALP', 600);
    const res = await as(A.admin).post('/api/tag-lots/import', {
      entries: [
        good,
        'ALP-000601-A'.replace(/A$/, makeTagCode('ALP', 601).endsWith('A') ? 'B' : 'A'), // wrong check character
        makeTagCode('BRV', 700),                                                          // another cooperative's prefix
        good,                                                                             // duplicate in the file
        bare,                                                                             // already registered
        `${makeTagCode('ALP', 602)}.AAAAAAAAAA`,                                          // forged signature
        'hello',
      ],
    }).expect(400);
    expect(res.body.error).toMatch(/6 of 7 lines have a problem. Nothing was imported/);
    expect(res.body.details.map((d) => d.line)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(res.body.details[1].problem).toMatch(/must start with ALP/);
    expect(await sys(() => models.Tag.countDocuments({}))).toBe(before);
  });

  it('is blocked when the plan does not include tag import', async () => {
    await as(B.admin).post('/api/tag-lots/import', { entries: [makeTagCode('BRV', 50)] }).expect(403);
  });

  it('will not reprint a lot that has unsigned pre-printed tags', async () => {
    const lots = (await as(A.admin).get('/api/tag-lots')).body.lots;
    const imported = lots.find((l) => l.source === 'imported');
    await as(A.admin).get(`/api/tag-lots/${imported.id}/print`).expect(400);
  });
});

describe('tag list and lookup', () => {
  it('lists tags with totals by status, a status filter, and a code search', async () => {
    const all = await as(A.staff).get('/api/tags').expect(200);
    expect(all.body.total).toBe(49);
    expect(all.body.totals).toEqual({ available: 48, assigned: 1, damaged: 0, lost: 0, retired: 0, all: 49 });
    expect(all.body.tags).toHaveLength(49);
    expect(all.body.tags[1]).toMatchObject({ code: makeTagCode('ALP', 2), status: 'available', lotNo: 2, useCount: 0 });

    expect((await as(A.staff).get('/api/tags?status=assigned')).body.tags.map((t) => t.code)).toEqual([makeTagCode('ALP', 1)]);
    expect((await as(A.staff).get('/api/tags?q=000501')).body.tags.map((t) => t.code)).toEqual([makeTagCode('ALP', 501)]);
    expect((await as(A.staff).get('/api/tags?q=.*')).body.total).toBe(0);
  });

  it('finds a tag from its QR or a typed code, and explains what is wrong otherwise', async () => {
    const code = makeTagCode('ALP', 2);
    const lookup = (text) => as(A.staff).post('/api/tags/lookup', { text });
    expect((await lookup(encodeTagQr(code, SECRET)).expect(200)).body.tag.code).toBe(code);
    expect((await lookup(code.toLowerCase()).expect(200)).body.tag.code).toBe(code);
    expect((await lookup(`${code}.AAAAAAAAAA`).expect(400)).body.error).toMatch(/security check/);
    expect((await lookup(encodeTagQr(code, 'another-secret')).expect(400)).body.error).toMatch(/security check/);
    expect((await lookup('ALP-000002-').expect(400)).body.error).toMatch(/not an OnioNet tag/);
    expect((await lookup(makeTagCode('ALP', 9999)).expect(404)).body.error).toMatch(/not registered/);
    // Another cooperative's real tag is simply unknown here.
    expect((await lookup(encodeTagQr(makeTagCode('BRV', 1), SECRET)).expect(404)).body.error).toMatch(/not registered/);
  });
});

describe('tag status', () => {
  const change = (user, id, status, notes) => as(user).post(`/api/tags/${id}/status`, { status, notes });
  let tag;

  it('moves an available tag to damaged and back, recording a custody event and an audit entry each time', async () => {
    tag = await tagByCode(makeTagCode('ALP', 3));
    await change(A.staff, tag._id, 'damaged', 'Cracked clip').expect(200);
    await change(A.staff, tag._id, 'available').expect(200);

    const detail = await as(A.staff).get(`/api/tags/${tag._id}`).expect(200);
    expect(detail.body.tag).toMatchObject({ status: 'available', allowedChanges: ['damaged', 'lost', 'retired'] });
    expect(detail.body.history.map((h) => h.type)).toEqual(['tag_restored', 'tag_damaged']);
    expect(detail.body.history[1]).toMatchObject({ performedByName: 'Alpha Staff', notes: 'Cracked clip' });
    expect(detail.body.history[1].occurredAt).toBeTruthy();

    const logs = await sys(() => models.AuditLog.find({ entityType: 'Tag', entityId: tag._id }).sort('occurredAt').lean());
    expect(logs.map((l) => l.changes[0])).toEqual([
      { field: 'status', from: 'available', to: 'damaged' },
      { field: 'status', from: 'damaged', to: 'available' },
    ]);
  });

  it('allows only sensible changes', async () => {
    await change(A.staff, tag._id, 'assigned').expect(400);   // only gate-in assigns a tag
    await change(A.staff, tag._id, 'available').expect(400);  // already available
    await change(A.staff, tag._id, 'bogus').expect(400);
    await change(A.staff, tag._id, 'lost').expect(200);
    await change(A.staff, tag._id, 'damaged').expect(400);    // lost -> damaged is not a thing
    await change(A.staff, tag._id, 'retired').expect(200);
    for (const status of ['available', 'damaged', 'lost']) await change(A.staff, tag._id, status).expect(400); // retired is final
  });

  it('will not change a tag that is on a sack', async () => {
    const onSack = await tagByCode(makeTagCode('ALP', 1));
    const res = await change(A.staff, onSack._id, 'lost').expect(400);
    expect(res.body.error).toMatch(/on a sack/);
    expect((await tagByCode(makeTagCode('ALP', 1))).status).toBe('assigned');
  });

  it('writes nothing when a change is refused', async () => {
    const events = () => sys(() => models.CustodyEvent.countDocuments({ tagId: tag._id }));
    const before = await events();
    await change(A.staff, tag._id, 'available').expect(400);
    expect(await events()).toBe(before);
  });

  it('cannot touch another cooperative\'s tag', async () => {
    await change(B.staff, tag._id, 'available').expect(404);
    await as(B.staff).get(`/api/tags/${tag._id}`).expect(404);
  });
});

describe('tag count', () => {
  const scan = (id, text) => as(A.staff).post(`/api/tags/reconciliation/${id}/scans`, { text });
  let count;

  it('starts a count, and resumes the open one instead of starting a second', async () => {
    const res = await as(A.staff).post('/api/tags/reconciliation').expect(201);
    count = res.body.count;
    expect(count).toMatchObject({ countNo: 2, status: 'open', startedByName: 'Alpha Staff', scanned: 0 });
    const again = await as(A.admin).post('/api/tags/reconciliation').expect(200);
    expect(again.body).toMatchObject({ resumed: true, count: { id: count.id } });
  });

  it('records each scan once and says what kind of tag it was', async () => {
    const ok = makeTagCode('ALP', 2);
    expect((await scan(count.id, encodeTagQr(ok, SECRET)).expect(200)).body).toMatchObject({ outcome: 'ok', code: ok, repeat: false });
    expect((await scan(count.id, ok).expect(200)).body).toMatchObject({ outcome: 'ok', repeat: true });
    // On hand, but the system says it is on a sack, or retired.
    expect((await scan(count.id, makeTagCode('ALP', 1)).expect(200)).body).toMatchObject({ outcome: 'wrong_state', status: 'assigned' });
    expect((await scan(count.id, makeTagCode('ALP', 3)).expect(200)).body).toMatchObject({ outcome: 'wrong_state', status: 'retired' });
    // A tag this cooperative never registered.
    expect((await scan(count.id, makeTagCode('ALP', 8888)).expect(200)).body).toMatchObject({ outcome: 'unexpected', repeat: false });
    await scan(count.id, 'garbage').expect(400);
    await scan(count.id, `${ok}.AAAAAAAAAA`).expect(400);
  });

  it('reports missing, unexpected, and wrong-state tags', async () => {
    const res = await as(A.staff).get(`/api/tags/reconciliation/${count.id}`).expect(200);
    const { result } = res.body;
    expect(result).toMatchObject({ scanned: 3, expected: 47, matched: 1, unexpected: [makeTagCode('ALP', 8888)] });
    expect(result.wrongState).toEqual([
      { code: makeTagCode('ALP', 1), status: 'assigned' },
      { code: makeTagCode('ALP', 3), status: 'retired' },
    ]);
    expect(result.missing).toHaveLength(46);
    expect(result.missing).not.toContain(makeTagCode('ALP', 2));
    expect(result.missing).toContain(makeTagCode('ALP', 4));
  });

  it('keeps the finished result even if tags change afterwards', async () => {
    const done = await as(A.staff).post(`/api/tags/reconciliation/${count.id}/finish`).expect(200);
    expect(done.body.count.status).toBe('finished');
    await scan(count.id, makeTagCode('ALP', 4)).expect(400);

    const four = await tagByCode(makeTagCode('ALP', 4));
    await as(A.staff).post(`/api/tags/${four._id}/status`, { status: 'lost' }).expect(200);
    const later = await as(A.staff).get(`/api/tags/reconciliation/${count.id}`).expect(200);
    expect(later.body.result.missing).toContain(makeTagCode('ALP', 4));
    expect(later.body.result.expected).toBe(47);

    const next = await as(A.staff).post('/api/tags/reconciliation').expect(201);
    expect(next.body.count.countNo).toBe(3);
  });

  it('is separate per cooperative and blocked when the plan does not include it', async () => {
    await as(B.staff).get('/api/tags/reconciliation').expect(403);
    await models.Cooperative.updateOne({ _id: B.coop._id }, { 'subscription.enabledFeatures': ['tag_reconciliation'] });
    await as(B.staff).get(`/api/tags/reconciliation/${count.id}`).expect(404);
    await as(B.staff).post(`/api/tags/reconciliation/${count.id}/scans`, { text: makeTagCode('BRV', 1) }).expect(404);
    expect((await as(B.staff).get('/api/tags/reconciliation')).body.counts.map((c) => c.countNo)).toEqual([1]);
  });
});

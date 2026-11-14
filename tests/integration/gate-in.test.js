import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, seedCooperative, cookieFor, models } from './helpers.js';
import app from '../../server/app.js';
import { asSystem } from '../../server/context.js';
import { encodeTagQr } from '../../server/lib/qr.js';
import { makeTagCode } from '../../server/lib/tagCode.js';
import { addMonths, feeTermsFor } from '../../server/services/batches.js';

let A; let B; let guest; let inactive;
const SECRET = 'test-qr-secret';
const as = (user) => {
  const call = (method) => (path, body) => request(app)[method](path).set('Cookie', cookieFor(user)).send(body);
  return { get: call('get'), post: call('post'), patch: call('patch') };
};
const sys = (fn) => asSystem(fn);
const qr = (n, prefix = 'ALP') => encodeTagQr(makeTagCode(prefix, n), SECRET);
const tagOf = (n) => sys(() => models.Tag.findOne({ code: makeTagCode('ALP', n) }).lean());
const quadrantId = () => String(A.records.Quadrant._id); // 1-A, capacity 1,250, already holds 1 sack
let scanSeq = 0;
const gateIn = (user, batchId, text, extra = {}) =>
  as(user).post('/api/custody/gate-in', { batchId, text, quadrantId: quadrantId(), clientEventId: `scan-${scanSeq += 1}`, ...extra });
const intake = (body) => as(A.staff).post('/api/batches', body);

beforeAll(async () => {
  await startDb();
  A = await seedCooperative('Alpha', 'ALP');
  B = await seedCooperative('Bravo', 'BRV');
  for (const key of ['tag', 'tagLot']) {
    await sys(() => models.Counter.updateOne({ cooperativeId: A.coop._id, key }, { value: 1 }, { upsert: true }));
  }
  await sys(() => models.Counter.updateOne({ cooperativeId: A.coop._id, key: 'batch:' + new Date().getFullYear() }, { value: 1 }, { upsert: true }));
  // The shared seed leaves its sample delivery open; these tests start from a settled state.
  await sys(() => models.Batch.updateMany({}, { status: 'stored' }));
  await models.Cooperative.updateOne({ _id: A.coop._id }, {
    'settings.contractMonths': 3,
    'settings.fees': {
      storageFeeCentavos: 15000, overdueFeePerDayCentavos: 200, memberDiscountPercent: 10,
      added: [
        { name: 'Handling', amountCentavos: 500, chargedPer: 'sack', appliesTo: 'every_batch', active: true },
        { name: 'Sorting Table', amountCentavos: 20000, chargedPer: 'batch', appliesTo: 'optional', active: true },
        { name: 'Old Fee', amountCentavos: 999, chargedPer: 'sack', appliesTo: 'every_batch', active: false },
      ],
    },
  });
  await as(A.admin).post('/api/tag-lots', { quantity: 60 }).expect(201); // tags 2..61
  guest = (await as(A.staff).post('/api/members', { tier: 'guest', firstName: 'Gina', lastName: 'Guest' }).expect(201)).body.member;
  inactive = (await as(A.staff).post('/api/members', { tier: 'member', firstName: 'Ian', lastName: 'Inactive' }).expect(201)).body.member;
  await as(A.staff).patch(`/api/members/${inactive.id}`, { status: 'inactive' }).expect(200);
}, 120_000);
afterAll(stopDb);

describe('helpers', () => {
  it('adds contract months, falling back to the last day of a short month', () => {
    expect(addMonths(new Date(2026, 10, 14), 3).toDateString()).toBe(new Date(2027, 1, 14).toDateString());
    expect(addMonths(new Date(2026, 10, 30), 3).toDateString()).toBe(new Date(2027, 1, 28).toDateString());
    expect(addMonths(new Date(2026, 0, 31), 1).toDateString()).toBe(new Date(2026, 1, 28).toDateString());
  });
  it('copies fees by owner type', () => {
    const fees = { storageFeeCentavos: 100, overdueFeePerDayCentavos: 5, memberDiscountPercent: 10, added: [] };
    expect(feeTermsFor(fees, 'member').memberDiscountPercent).toBe(10);
    expect(feeTermsFor(fees, 'guest').memberDiscountPercent).toBe(0);
    expect(feeTermsFor(fees, 'coop_owned')).toEqual({ storageFeeCentavos: 0, overdueFeePerDayCentavos: 0, memberDiscountPercent: 0, added: [] });
  });
});

describe('receiving a delivery (intake)', () => {
  let memberBatch;

  it('starts a delivery for a member with the fees in force, including the member discount', async () => {
    const optional = (await as(A.staff).get('/api/batches/summary')).body.intake.optionalFees;
    expect(optional.map((f) => f.name)).toEqual(['Sorting Table']);
    const res = await intake({
      memberId: String(A.records.Member._id), declaredSackCount: 12, variety: 'Red Creole', sizeClass: 'Large', grade: 'A',
      optionalFeeIds: [optional[0].id], totalWeightKg: '300',
      ownerType: 'coop_owned', feeTerms: { storageFeeCentavos: 1 }, batchNo: 'HACK', status: 'stored', // ignored
    }).expect(201);
    expect(res.body.batch.batchNo).toBe(`ALP-B-${new Date().getFullYear()}-0002`);
    memberBatch = (await as(A.staff).get(`/api/batches/${res.body.batch.id}`).expect(200)).body.batch;
    expect(memberBatch).toMatchObject({
      ownerType: 'member', ownerName: 'Juan Alpha', status: 'receiving', declaredSackCount: 12, sacksReceived: 0,
      variety: 'Red Creole', sizeClass: 'Large', grade: 'A', totalWeightKg: 300, receivedByName: 'Alpha Staff', overdue: false,
    });
    expect(memberBatch.feeTerms).toEqual({
      storageFeeCentavos: 15000, overdueFeePerDayCentavos: 200, memberDiscountPercent: 10,
      added: [
        { name: 'Handling', amountCentavos: 500, chargedPer: 'sack' },
        { name: 'Sorting Table', amountCentavos: 20000, chargedPer: 'batch' },
      ],
    });
    const months = (new Date(memberBatch.contractEnd) - new Date(memberBatch.contractStart)) / 864e5;
    expect(months).toBeGreaterThan(88);
    expect(months).toBeLessThan(93);
  });

  it('gives guests no member discount, and only the fees that apply', async () => {
    const res = await intake({ memberId: guest.id, declaredSackCount: 3 }).expect(201);
    const batch = (await as(A.staff).get(`/api/batches/${res.body.batch.id}`)).body.batch;
    expect(batch.ownerType).toBe('guest');
    expect(batch.feeTerms.memberDiscountPercent).toBe(0);
    expect(batch.feeTerms.added.map((f) => f.name)).toEqual(['Handling']);
    await as(A.staff).post(`/api/batches/${res.body.batch.id}/cancel`).expect(200);
  });

  it('receives cooperative-owned stock with no farmer and no fees', async () => {
    const res = await intake({ coopOwned: true, declaredSackCount: 2, memberId: String(A.records.Member._id) }).expect(201);
    const batch = (await as(A.staff).get(`/api/batches/${res.body.batch.id}`)).body.batch;
    expect(batch).toMatchObject({ ownerType: 'coop_owned', ownerName: 'Cooperative stock', memberId: null });
    expect(batch.feeTerms).toEqual({ storageFeeCentavos: 0, overdueFeePerDayCentavos: 0, memberDiscountPercent: 0, added: [] });
    await as(A.staff).post(`/api/batches/${res.body.batch.id}/cancel`).expect(200);
  });

  it('keeps a delivery\'s fees when Settings change later', async () => {
    await as(A.admin).patch('/api/cooperative/fees', { storageFeeCentavos: 99999, memberDiscountPercent: 50 }).expect(200);
    const again = (await as(A.staff).get(`/api/batches/${memberBatch.id}`)).body.batch;
    expect(again.feeTerms).toEqual(memberBatch.feeTerms);
    await as(A.admin).patch('/api/cooperative/fees', { storageFeeCentavos: 15000, memberDiscountPercent: 10 }).expect(200);
  });

  it('rejects a missing or inactive farmer, another cooperative\'s farmer, and a bad sack count', async () => {
    await intake({ declaredSackCount: 5 }).expect(400);
    expect((await intake({ memberId: inactive.id, declaredSackCount: 5 }).expect(400)).body.error).toMatch(/inactive/);
    await intake({ memberId: String(B.records.Member._id), declaredSackCount: 5 }).expect(400);
    for (const declaredSackCount of [0, -3, 2.5, 'many', undefined]) {
      await intake({ memberId: String(A.records.Member._id), declaredSackCount }).expect(400);
    }
  });

  it('blocks a delivery bigger than the space left, counting sacks still expected', async () => {
    // 1-A holds 1,250: 1 sack stored + 12 expected from the open delivery = 1,237 free.
    const summary = (await as(A.staff).get('/api/batches/summary')).body;
    expect(summary).toMatchObject({ capacity: 1250, stored: 1, pending: 12, available: 1237, receiving: 1 });
    const res = await intake({ memberId: String(A.records.Member._id), declaredSackCount: 1238 }).expect(400);
    expect(res.body.error).toBe('There is room for 1,237 more sacks, but this delivery has 1,238.');
    const ok = await intake({ memberId: String(A.records.Member._id), declaredSackCount: 1237 }).expect(201);
    await intake({ memberId: String(A.records.Member._id), declaredSackCount: 1 }).expect(400);
    await as(A.staff).post(`/api/batches/${ok.body.batch.id}/cancel`).expect(200); // cancelling frees the space
    expect((await as(A.staff).get('/api/batches/summary')).body.available).toBe(1237);
  });

  describe('gate-in', () => {
    it('binds a tag to a new sack and records who did it and when', async () => {
      const res = await gateIn(A.staff, memberBatch.id, qr(2)).expect(201);
      expect(res.body).toMatchObject({
        repeat: false, received: 1, declared: 12,
        sack: { sackNo: 1 }, tag: { code: makeTagCode('ALP', 2) }, quadrant: { code: '1-A', free: 1248 },
      });
      const tag = await tagOf(2);
      expect(tag).toMatchObject({ status: 'assigned', useCount: 1 });
      expect(tag.lastScannedAt).toBeTruthy();
      const sack = await sys(() => models.Sack.findById(res.body.sack.id).lean());
      expect(sack).toMatchObject({ sackNo: 1, status: 'stored' });
      expect(String(sack.currentTagId)).toBe(String(tag._id));
      expect(String(tag.currentSackId)).toBe(String(sack._id));
      expect(String(sack.batchId)).toBe(memberBatch.id);
      expect(String(sack.memberId)).toBe(String(A.records.Member._id));
      expect(String(sack.cooperativeId)).toBe(String(A.coop._id));

      const events = await sys(() => models.CustodyEvent.find({ sackId: sack._id }).lean());
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'gate_in', performedByName: 'Alpha Staff' });
      expect(String(events[0].performedBy)).toBe(String(A.staff._id));
      expect(String(events[0].tagId)).toBe(String(tag._id));
      expect(String(events[0].toQuadrantId)).toBe(quadrantId());
      expect(Date.now() - new Date(events[0].occurredAt).getTime()).toBeLessThan(10_000);
    });

    it('shows the sack on the tag page and in the tag history', async () => {
      const tag = await tagOf(2);
      const res = await as(A.staff).get(`/api/tags/${tag._id}`).expect(200);
      expect(res.body.sack).toMatchObject({ sackNo: 1, batchNo: memberBatch.batchNo, quadrantCode: '1-A', ownerName: 'Juan Alpha' });
      expect(res.body.history.map((h) => h.type)).toEqual(['gate_in']);
      expect(res.body.tag.allowedChanges).toEqual([]);
    });

    it('refuses a tag that is already on a sack, and changes nothing', async () => {
      const before = await sys(() => models.Sack.countDocuments({}));
      const res = await gateIn(A.staff, memberBatch.id, qr(2)).expect(409);
      expect(res.body.error).toMatch(/already on another sack/);
      expect(await sys(() => models.Sack.countDocuments({}))).toBe(before);
      expect((await tagOf(2)).useCount).toBe(1);
    });

    it('never accepts a typed code, a forged or foreign QR, or an unknown tag', async () => {
      const cases = [
        [makeTagCode('ALP', 3), 400, /Scan the QR code/],                       // typed, not scanned
        [`${makeTagCode('ALP', 3)}.AAAAAAAAAA`, 400, /security check/],         // forged signature
        [encodeTagQr(makeTagCode('ALP', 3), 'wrong-secret'), 400, /security check/],
        [qr(9999), 404, /not registered/],
        [qr(1, 'BRV'), 404, /not registered/],                                  // another cooperative's tag
        ['https://example.com/x', 400, /not an OnioNet tag/],
      ];
      for (const [text, status, message] of cases) {
        const res = await gateIn(A.staff, memberBatch.id, text).expect(status);
        expect(res.body.error).toMatch(message);
      }
      expect((await tagOf(3)).status).toBe('available');
      expect((await as(A.staff).get(`/api/batches/${memberBatch.id}`)).body.batch.sacksReceived).toBe(1);
    });

    it('refuses damaged, lost, and retired tags', async () => {
      for (const [n, status, message] of [[50, 'damaged', /damaged/], [51, 'lost', /lost/], [52, 'retired', /retired/]]) {
        const tag = await tagOf(n);
        await as(A.staff).post(`/api/tags/${tag._id}/status`, { status }).expect(200);
        expect((await gateIn(A.staff, memberBatch.id, qr(n)).expect(409)).body.error).toMatch(message);
      }
    });

    it('needs a quadrant that is in use and has room', async () => {
      await gateIn(A.staff, memberBatch.id, qr(3), { quadrantId: undefined }).expect(400);
      await gateIn(A.staff, memberBatch.id, qr(3), { quadrantId: String(B.records.Quadrant._id) }).expect(400);

      const small = (await as(A.admin).post('/api/quadrants', { code: '9-Z', floor: 9, capacity: 1, fillOrder: 99 }).expect(201)).body.quadrant;
      await gateIn(A.staff, memberBatch.id, qr(3), { quadrantId: small._id }).expect(201);
      expect((await gateIn(A.staff, memberBatch.id, qr(4), { quadrantId: small._id }).expect(409)).body.error).toBe('9-Z is full. Choose another quadrant.');
      expect((await tagOf(4)).status).toBe('available');
    });

    it('records a retried scan only once', async () => {
      const first = await gateIn(A.staff, memberBatch.id, qr(4), { clientEventId: 'retry-me' }).expect(201);
      const retry = await gateIn(A.staff, memberBatch.id, qr(4), { clientEventId: 'retry-me' }).expect(200);
      expect(retry.body).toMatchObject({ repeat: true, sack: { sackNo: first.body.sack.sackNo }, tag: { code: makeTagCode('ALP', 4) } });
      expect(await sys(() => models.Sack.countDocuments({ batchId: memberBatch.id }))).toBe(3);
      expect((await tagOf(4)).useCount).toBe(1);
    });

    it('lets only one of two phones win the same tag', async () => {
      const results = await Promise.all([gateIn(A.staff, memberBatch.id, qr(5)), gateIn(A.admin, memberBatch.id, qr(5))]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const five = await tagOf(5);
      expect(await sys(() => models.Sack.countDocuments({ currentTagId: five._id }))).toBe(1);
      expect((await tagOf(5)).useCount).toBe(1);
    });

    it('numbers sacks without gaps or repeats when several phones scan at once', async () => {
      const results = await Promise.all([6, 7, 8, 9, 10].map((n) => gateIn(n % 2 ? A.staff : A.admin, memberBatch.id, qr(n))));
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      const sacks = await sys(() => models.Sack.find({ batchId: memberBatch.id }).sort('sackNo').lean());
      expect(sacks.map((s) => s.sackNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(new Set(sacks.map((s) => String(s.currentTagId))).size).toBe(9);
      expect(await sys(() => models.CustodyEvent.countDocuments({ batchId: memberBatch.id, type: 'gate_in' }))).toBe(9);
    });

    it('stops at the declared sack count until the count is corrected', async () => {
      for (const n of [11, 12, 13]) await gateIn(A.staff, memberBatch.id, qr(n)).expect(201);
      const full = await gateIn(A.staff, memberBatch.id, qr(14)).expect(400);
      expect(full.body.error).toMatch(/All 12 sacks of this delivery are scanned in/);
      expect((await tagOf(14)).status).toBe('available');

      await as(A.staff).patch(`/api/batches/${memberBatch.id}`, { declaredSackCount: 11 }).expect(400); // below what is scanned in
      await as(A.staff).patch(`/api/batches/${memberBatch.id}`, { declaredSackCount: 13 }).expect(200);
      expect((await gateIn(A.staff, memberBatch.id, qr(14)).expect(201)).body).toMatchObject({ received: 13, declared: 13 });
    });

    it('cannot add sacks to another cooperative\'s delivery, or with another cooperative\'s session', async () => {
      await gateIn(B.staff, memberBatch.id, qr(1, 'BRV')).expect(404);
      await as(B.staff).get(`/api/batches/${memberBatch.id}`).expect(404);
      await as(B.staff).post(`/api/batches/${memberBatch.id}/finish-receiving`).expect(404);
      await as(A.farmer).post('/api/custody/gate-in', { batchId: memberBatch.id, text: qr(15), quadrantId: quadrantId() }).expect(403);
    });
  });

  describe('finishing', () => {
    it('cannot cancel a delivery that has sacks, or finish one that has none', async () => {
      expect((await as(A.staff).post(`/api/batches/${memberBatch.id}/cancel`).expect(400)).body.error).toMatch(/already scanned in/);
      const empty = (await intake({ memberId: guest.id, declaredSackCount: 4 }).expect(201)).body.batch;
      await as(A.staff).post(`/api/batches/${empty.id}/finish-receiving`).expect(400);

      await gateIn(A.staff, empty.id, qr(20)).expect(201);
      const short = await as(A.staff).post(`/api/batches/${empty.id}/finish-receiving`).expect(409);
      expect(short.body).toMatchObject({ error: 'Only 1 of 4 sacks were scanned in.', details: { shortfall: true, received: 1, declared: 4 } });
      const done = await as(A.staff).post(`/api/batches/${empty.id}/finish-receiving`, { acceptShortfall: true }).expect(200);
      expect(done.body.batch).toMatchObject({ status: 'stored', sacksReceived: 1, sacksStored: 1 });
    });

    it('marks the delivery stored, after which no more sacks can be added', async () => {
      const done = await as(A.staff).post(`/api/batches/${memberBatch.id}/finish-receiving`).expect(200);
      expect(done.body.batch).toMatchObject({ status: 'stored', sacksReceived: 13, sacksStored: 13 });
      expect(done.body.sacks).toHaveLength(13);
      expect(done.body.sacks[0]).toMatchObject({ sackNo: 13, status: 'stored', tagCode: makeTagCode('ALP', 14), quadrantCode: '1-A' });
      await gateIn(A.staff, memberBatch.id, qr(21)).expect(400);
      await as(A.staff).post(`/api/batches/${memberBatch.id}/finish-receiving`).expect(400);
      await as(A.staff).patch(`/api/batches/${memberBatch.id}`, { declaredSackCount: 20 }).expect(400);
      await as(A.staff).patch(`/api/batches/${memberBatch.id}`, { grade: 'B' }).expect(200);
    });
  });

  describe('lists', () => {
    it('lists deliveries with counts, hides cancelled ones, and searches by farmer or number', async () => {
      const all = (await as(A.staff).get('/api/batches').expect(200)).body;
      expect(all.batches.every((b) => b.status !== 'cancelled')).toBe(true);
      expect(all.batches.map((b) => b.status).sort()).toEqual(['stored', 'stored', 'stored']);
      const search = async (body) => (await as(A.staff).post('/api/batches/search', body).expect(200)).body.batches;
      expect((await search({ q: 'gina' })).map((b) => b.ownerName)).toEqual(['Gina Guest']);
      expect((await search({ q: memberBatch.batchNo })).map((b) => b.id)).toEqual([memberBatch.id]);
      expect(await search({ q: 'nobody' })).toEqual([]);
      expect((await search({ status: 'cancelled' })).length).toBe(3);
    });

    it('flags a delivery as overdue once its contract has ended and sacks are still stored', async () => {
      await sys(() => models.Batch.updateOne({ _id: memberBatch.id }, { contractEnd: new Date(Date.now() - 864e5) }));
      const batch = (await as(A.staff).get(`/api/batches/${memberBatch.id}`)).body.batch;
      expect(batch.overdue).toBe(true);
      expect((await as(A.staff).get('/api/batches/summary')).body.overdue).toBe(1);
      expect((await as(A.staff).post('/api/batches/search', { overdue: true })).body.batches.map((b) => b.id)).toEqual([memberBatch.id]);
    });

    it('updates the farmer\'s storage counts and the quadrant usage', async () => {
      const member = (await as(A.staff).get(`/api/members/${A.records.Member._id}`)).body;
      expect(member.storage).toEqual({ batches: 2, sacksStored: 14 }); // the seeded delivery and this one; cancelled ones are not counted
      const summary = (await as(A.staff).get('/api/batches/summary')).body;
      expect(summary.stored).toBe(15);
      expect(summary.quadrants.find((q) => q.code === '1-A').used).toBe(14);
      expect(summary.quadrants.find((q) => q.code === '9-Z')).toMatchObject({ used: 1, free: 0 });
    });
  });
});

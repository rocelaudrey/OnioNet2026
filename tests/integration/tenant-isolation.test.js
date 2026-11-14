import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, seedCooperative, cookieFor, models } from './helpers.js';
import app from '../../server/app.js';
import { runWithContext, asSystem, crossTenant } from '../../server/context.js';

// Proves a user from one cooperative cannot read or change another
// cooperative's data, at both the database layer and the HTTP API.

let A; let B;
const IMMUTABLE = new Set(['CustodyEvent', 'AuditLog']);
const TENANT_MODELS = ['Quadrant', 'Member', 'Batch', 'Sack', 'Tag', 'TagLot', 'CustodyEvent', 'Transaction', 'AuditLog', 'TagCount', 'Counter', 'User'];

const asUser = (user, fn) =>
  runWithContext({ userId: String(user._id), role: user.role, cooperativeId: String(user.cooperativeId) }, fn);
const raw = (name, id) => asSystem(() => models[name].findById(id).lean());

beforeAll(async () => {
  await startDb();
  A = await seedCooperative('Alpha', 'ALP');
  B = await seedCooperative('Bravo', 'BRV');
}, 120_000);
afterAll(stopDb);

describe.each(TENANT_MODELS)('database layer: %s', (name) => {
  const Model = () => models[name];
  const ownId = () => String(A.coop._id);

  it('lists only its own cooperative, even when asked for another', async () => {
    const all = await asUser(A.staff, () => Model().find().lean());
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((d) => String(d.cooperativeId) === ownId())).toBe(true);

    await expect(asUser(A.staff, () => Model().find({ cooperativeId: B.coop._id }))).rejects.toThrow(/another cooperative/);

    const sneaky = await asUser(A.staff, () => Model().find({ $or: [{ cooperativeId: B.coop._id }, {}] }).lean());
    expect(sneaky.every((d) => String(d.cooperativeId) === ownId())).toBe(true);
  });

  it('cannot read another cooperative record by ID', async () => {
    const theirs = B.records[name]._id;
    expect(await asUser(A.staff, () => Model().findById(theirs))).toBeNull();
    expect(await asUser(A.staff, () => Model().findOne({ _id: theirs }))).toBeNull();
    expect(await asUser(A.staff, () => Model().countDocuments({ _id: theirs }))).toBe(0);
    expect(await asUser(A.staff, () => Model().distinct('_id', { _id: theirs }))).toEqual([]);
  });

  it('counts and aggregates only its own cooperative', async () => {
    const total = await asSystem(() => Model().countDocuments({ cooperativeId: A.coop._id }));
    expect(await asUser(A.staff, () => Model().countDocuments())).toBe(total);
    const rows = await asUser(A.staff, () => Model().aggregate([{ $project: { cooperativeId: 1 } }]));
    expect(rows.length).toBe(total);
    expect(rows.every((d) => String(d.cooperativeId) === ownId())).toBe(true);
  });

  it('cannot change or delete another cooperative record', async () => {
    const theirs = B.records[name]._id;
    const before = await raw(name, theirs);
    if (IMMUTABLE.has(name)) {
      await expect(asUser(A.staff, () => Model().updateOne({ _id: theirs }, { $set: { notes: 'x' } }))).rejects.toThrow();
      await expect(asUser(A.staff, () => Model().deleteOne({ _id: theirs }))).rejects.toThrow();
    } else {
      const loose = { strict: false }; // so the write is attempted even on models with no such field
      const upd = await asUser(A.staff, () => Model().updateOne({ _id: theirs }, { $set: { notes: 'hacked' } }, loose));
      expect(upd.matchedCount).toBe(0);
      const all = await asUser(A.staff, () => Model().updateMany({ _id: { $in: [theirs] } }, { $set: { notes: 'hacked' } }, loose));
      expect(all.matchedCount).toBe(0);
      await expect(asUser(A.staff, () => Model().updateMany({ cooperativeId: B.coop._id }, { $set: { notes: 'hacked' } }, loose))).rejects.toThrow(/another cooperative/);
      expect(await asUser(A.staff, () => Model().findOneAndUpdate({ _id: theirs }, { $set: { notes: 'hacked' } }, loose))).toBeNull();
      expect((await asUser(A.staff, () => Model().deleteOne({ _id: theirs }))).deletedCount).toBe(0);
      await expect(asUser(A.staff, () => Model().deleteMany({ cooperativeId: B.coop._id }))).rejects.toThrow(/another cooperative/);
      expect(await asUser(A.staff, () => Model().findOneAndDelete({ _id: theirs }))).toBeNull();
    }
    expect(await raw(name, theirs)).toEqual(before);
  });

  it('cannot create a record in another cooperative', async () => {
    const copy = { ...B.records[name].toObject() };
    delete copy._id;
    await expect(asUser(A.staff, () => Model().create(copy))).rejects.toThrow(/another cooperative/);
    await expect(asUser(A.staff, () => Model().insertMany([copy]))).rejects.toThrow(/another cooperative/);
  });

  it('cannot move its own record into another cooperative', async () => {
    if (IMMUTABLE.has(name)) return;
    const mine = A.records[name]._id;
    await asUser(A.staff, () => Model().updateOne({ _id: mine }, { $set: { cooperativeId: B.coop._id } }));
    expect(String((await raw(name, mine)).cooperativeId)).toBe(ownId());
  });

  it('refuses to run with no cooperative context (fails closed)', async () => {
    await expect(Model().find()).rejects.toThrow(/no cooperative context/);
    await expect(Model().countDocuments()).rejects.toThrow(/no cooperative context/);
    await expect(Model().aggregate([])).rejects.toThrow(/no cooperative context/);
    await expect(Model().updateMany({}, { $set: { notes: 'x' } })).rejects.toThrow();
    await expect(Model().deleteMany({})).rejects.toThrow();
  });

  it('blocks unscoped shortcuts', async () => {
    await expect(asUser(A.staff, () => Model().estimatedDocumentCount())).rejects.toThrow();
    await expect(asUser(A.staff, () => Model().bulkWrite([{ deleteMany: { filter: {} } }]))).rejects.toThrow();
  });
});

describe('cross-cooperative access', () => {
  it('is refused for cooperative users', async () => {
    await expect(asUser(A.admin, () => crossTenant(() => models.Member.find()))).rejects.toThrow(/not allowed/);
  });
});

describe('HTTP API', () => {
  const get = (path, user) => request(app).get(path).set('Cookie', cookieFor(user));
  const LISTS = [
    ['/api/members', 'members', 'Member'],
    ['/api/quadrants', 'quadrants', 'Quadrant'],
    ['/api/batches', 'batches', 'Batch'],
    ['/api/sacks', 'sacks', 'Sack'],
    ['/api/tags', 'tags', 'Tag'],
    ['/api/transactions', 'transactions', 'Transaction'],
  ];

  it.each(LISTS)('%s returns only the caller\'s cooperative', async (path, key, name) => {
    const res = await get(path, A.staff).expect(200);
    const ids = res.body[key].map((d) => d._id ?? d.id);
    expect(ids).toContain(String(A.records[name]._id));
    expect(ids).not.toContain(String(B.records[name]._id));
    const own = await asSystem(() => models[name].countDocuments({ cooperativeId: A.coop._id }));
    expect(ids.length).toBe(own);
  });

  it('cannot read another cooperative\'s farmer by ID', async () => {
    await get(`/api/members/${B.records.Member._id}`, A.admin).expect(404);
    await get(`/api/members/${A.records.Member._id}`, A.admin).expect(200);
  });

  it('cannot change another cooperative\'s farmer or quadrant', async () => {
    const memberBefore = await raw('Member', B.records.Member._id);
    const quadrantBefore = await raw('Quadrant', B.records.Quadrant._id);
    await request(app).patch(`/api/members/${B.records.Member._id}`).set('Cookie', cookieFor(A.admin))
      .send({ firstName: 'Hacked' }).expect(404);
    await request(app).patch(`/api/quadrants/${B.records.Quadrant._id}`).set('Cookie', cookieFor(A.admin))
      .send({ capacity: 1 }).expect(404);
    expect(await raw('Member', B.records.Member._id)).toEqual(memberBefore);
    expect(await raw('Quadrant', B.records.Quadrant._id)).toEqual(quadrantBefore);
  });

  it('ignores a cooperativeId sent in the request body', async () => {
    const countB = () => asSystem(() => models.Member.countDocuments({ cooperativeId: B.coop._id }));
    const before = await countB();
    const res = await request(app).post('/api/members').set('Cookie', cookieFor(A.staff))
      .send({ cooperativeId: String(B.coop._id), tier: 'guest', firstName: 'Maria', lastName: 'Santos' })
      .expect(201);
    const id = res.body.member.id;
    expect(String((await raw('Member', id)).cooperativeId)).toBe(String(A.coop._id));
    expect(res.body.member.memberNo).toBe('ALP-M-0002');
    expect(await countB()).toBe(before);

    await request(app).patch(`/api/members/${id}`).set('Cookie', cookieFor(A.staff))
      .send({ cooperativeId: String(B.coop._id), firstName: 'Mary' }).expect(200);
    const saved = await raw('Member', id);
    expect(String(saved.cooperativeId)).toBe(String(A.coop._id));
    expect(saved.firstName).toBe('Mary');
  });

  it('writes audit entries only into the caller\'s cooperative', async () => {
    const logs = await asSystem(() => models.AuditLog.find({ entityType: 'Member', action: 'update' }).lean());
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => String(l.cooperativeId) === String(A.coop._id))).toBe(true);
    expect(logs.at(-1).changes).toEqual([{ field: 'firstName', from: 'Maria', to: 'Mary' }]);
  });
});

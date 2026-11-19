import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.QR_HMAC_SECRET = 'test-qr-secret';

const { connectDb } = await import('../../server/db.js');
const models = await import('../../server/models/index.js');
const { asSystem, asCooperative } = await import('../../server/context.js');
const { signSession, AUTH_COOKIE } = await import('../../server/middleware/auth.js');
const { makeTagCode } = await import('../../server/lib/tagCode.js');
const { ROLES } = await import('../../server/lib/roles.js');

export { models, ROLES };
export const TEST_PASSWORD = 'correct-horse-battery';

let replSet;

// An in-memory replica set, so tests can also use transactions.
export async function startDb() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = replSet.getUri('onionet_test');
  await connectDb();
  await Promise.all(Object.values(models).map((m) => m.init())); // build unique indexes
}

export async function stopDb() {
  await mongoose.disconnect();
  await replSet?.stop();
}

export const cookieFor = (user) => `${AUTH_COOKIE}=${signSession(user)}`;

// Creates one cooperative with a user of each role and one record of every
// tenant model. Returns the records so tests can try to reach them.
export async function seedCooperative(name, prefix, { capacityLimit = 10000 } = {}) {
  const { Cooperative, Quadrant, User, Member, Batch, Sack, Tag, TagLot, CustodyEvent, Transaction, AuditLog, TagCount, Counter } = models;
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);
  const coop = await Cooperative.create({
    name, facilityName: `${name} Cold Storage`,
    settings: { tagPrefix: prefix },
    subscription: { capacityLimit },
  });
  const slug = prefix.toLowerCase();

  return asCooperative(coop._id, async () => {
    const admin = await User.create({ name: `${name} Admin`, email: `admin@${slug}.test`, passwordHash, role: ROLES.COOP_ADMIN });
    const staff = await User.create({ name: `${name} Staff`, email: `staff@${slug}.test`, passwordHash, role: ROLES.COOP_STAFF });
    const quadrant = await Quadrant.create({ code: '1-A', floor: 1, capacity: 1250, fillOrder: 1 });
    const member = await Member.create({ memberNo: `${prefix}-M-0001`, tier: 'member', firstName: 'Juan', lastName: name });
    const farmer = await User.create({ name: `Juan ${name}`, phone: `0917${prefix.charCodeAt(0)}00001`, passwordHash, role: ROLES.MEMBER, memberId: member._id });
    const now = new Date();
    const batch = await Batch.create({
      batchNo: `${prefix}-B-2026-0001`, ownerType: 'member', memberId: member._id, receivedBy: staff._id,
      declaredSackCount: 10, contractStart: now, contractEnd: new Date(now.getTime() + 90 * 864e5),
    });
    const tagLot = await TagLot.create({ lotNo: 1, quantity: 1, createdBy: admin._id });
    const tag = await Tag.create({ code: makeTagCode(prefix, 1), tagLotId: tagLot._id, status: 'assigned' });
    const sack = await Sack.create({ batchId: batch._id, memberId: member._id, sackNo: 1, currentTagId: tag._id, quadrantId: quadrant._id });
    const custodyEvent = await CustodyEvent.create({
      type: 'gate_in', tagId: tag._id, sackId: sack._id, batchId: batch._id, memberId: member._id,
      toQuadrantId: quadrant._id, performedBy: staff._id, performedByName: staff.name,
    });
    const transaction = await Transaction.create({
      receiptNo: `${prefix}-R-0001`, type: 'payment', batchId: batch._id, memberId: member._id,
      amountCentavos: 50000, method: 'cash', recordedBy: staff._id,
    });
    const auditLog = await AuditLog.create({ actorId: admin._id, actorName: admin.name, action: 'create', entityType: 'Member', entityId: member._id });
    const tagCount = await TagCount.create({ countNo: 1, startedBy: staff._id });
    const counter = await Counter.create({ key: 'member', value: 1 });
    return {
      coop, admin, staff, farmer,
      records: { Quadrant: quadrant, Member: member, Batch: batch, TagLot: tagLot, Tag: tag, Sack: sack, CustodyEvent: custodyEvent, Transaction: transaction, AuditLog: auditLog, TagCount: tagCount, Counter: counter, User: staff },
    };
  });
}

export async function seedSuperAdmin() {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);
  return asSystem(() => models.User.create({ name: 'Platform Owner', email: 'owner@onionet.test', passwordHash, role: ROLES.SUPER_ADMIN }));
}

// Removes everything scripts/sample-data.js loaded into one cooperative, and
// puts the numbering (farmers, deliveries, tags, receipts, releases) back to
// the highest number still in use. Real records are never touched: only those
// recorded by the "Sample Data" account, or belonging to its sample farmers,
// deliveries, and tag lots.
//
// Preview:  node --env-file=<settings file> scripts/remove-sample-data.js --prefix FAF
// Remove:   add --confirm
import '../server/timezone.js';
import mongoose from 'mongoose';
import { connectDb } from '../server/db.js';
import { Cooperative } from '../server/models/index.js';
import { parseTagCode } from '../server/lib/tagCode.js';

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const PREFIX = String(arg('--prefix') ?? '').toUpperCase();
if (!PREFIX) throw new Error('Give the cooperative tag prefix, e.g. --prefix FAF');
const CONFIRM = args.includes('--confirm');
const SAMPLE_NOTE = 'Sample data';
const email = `sample-data+${PREFIX.toLowerCase()}@onionet.invalid`;

await connectDb();
const db = mongoose.connection.db;
const col = (name) => db.collection(name);
const coop = await Cooperative.findOne({ 'settings.tagPrefix': PREFIX }).lean();
if (!coop) throw new Error(`No cooperative with tag prefix ${PREFIX}.`);
const cid = coop._id;
// Every filter below is limited to this cooperative.
const own = (filter) => ({ cooperativeId: cid, ...filter });

const user = await col('users').findOne(own({ email }));
if (!user) {
  console.log(`No sample data found in ${coop.name} (${PREFIX}).`);
  await mongoose.disconnect();
  process.exit(0);
}
const uid = user._id;
const ids = async (name, filter) => (await col(name).find(own(filter)).project({ _id: 1 }).toArray()).map((d) => d._id);

const batchIds = await ids('batches', { receivedBy: uid });
const memberIds = await ids('members', { notes: SAMPLE_NOTE });
// A sample farmer is removed only if every one of their deliveries is sample data.
const realBatchOwners = new Set((await col('batches').find(own({ memberId: { $in: memberIds }, receivedBy: { $ne: uid } })).project({ memberId: 1 }).toArray()).map((b) => String(b.memberId)));
const removableMembers = memberIds.filter((id) => !realBatchOwners.has(String(id)));
const lotIds = await ids('taglots', { createdBy: uid });

const plan = {
  members: own({ _id: { $in: removableMembers } }),
  batches: own({ _id: { $in: batchIds } }),
  sacks: own({ batchId: { $in: batchIds } }),
  tags: own({ tagLotId: { $in: lotIds } }),
  taglots: own({ _id: { $in: lotIds } }),
  custodyevents: own({ $or: [{ performedBy: uid }, { batchId: { $in: batchIds } }] }),
  transactions: own({ $or: [{ recordedBy: uid }, { batchId: { $in: batchIds } }] }),
  auditlogs: own({ $or: [{ actorId: uid }, { entityId: { $in: [...batchIds, ...removableMembers, ...lotIds] } }] }),
  counters: own({ key: { $in: batchIds.map((id) => `sack:${id}`) } }),
};

// Real records that point at sample tags (a real delivery scanned a sample tag) would be left dangling.
const sampleTagIds = await ids('tags', { tagLotId: { $in: lotIds } });
const realUses = await col('sacks').countDocuments(own({ currentTagId: { $in: sampleTagIds }, batchId: { $nin: batchIds } }));

console.log(`${coop.name} (${PREFIX}) on database "${mongoose.connection.name}"`);
for (const [name, filter] of Object.entries(plan)) console.log(`  ${name.padEnd(15)} ${await col(name).countDocuments(filter)} to remove`);
console.log('  users           1 to remove (the Sample Data account)');
if (realUses) {
  console.log(`\nStopped: ${realUses} real sacks are on sample tags. Release or re-tag them first.`);
  await mongoose.disconnect();
  process.exit(1);
}
if (!CONFIRM) {
  console.log('\nPreview only. Nothing was removed. Add --confirm to remove it.');
  await mongoose.disconnect();
  process.exit(0);
}

for (const [name, filter] of Object.entries(plan)) await col(name).deleteMany(filter);
await col('users').deleteOne(own({ _id: uid }));

// Put each number back to the highest one still in use.
const highest = async (name, field, pattern) => {
  const rows = await col(name).find(own({ [field]: { $regex: pattern } })).project({ [field]: 1 }).toArray();
  return rows.reduce((max, r) => Math.max(max, Number(String(r[field]).match(pattern)[1])), 0);
};
const year = '2026';
const counters = {
  member: await highest('members', 'memberNo', new RegExp(`^${PREFIX}-M-(\\d+)$`)),
  [`batch:${year}`]: await highest('batches', 'batchNo', new RegExp(`^${PREFIX}-B-${year}-(\\d+)$`)),
  [`receipt:${year}`]: await highest('transactions', 'receiptNo', new RegExp(`^${PREFIX}-R-${year}-(\\d+)$`)),
  [`release:${year}`]: await highest('custodyevents', 'releaseNo', new RegExp(`^${PREFIX}-REL-${year}-(\\d+)$`)),
  tagLot: (await col('taglots').find(own({})).project({ lotNo: 1 }).toArray()).reduce((m, l) => Math.max(m, l.lotNo), 0),
  tag: (await col('tags').find(own({})).project({ code: 1 }).toArray()).reduce((m, t) => Math.max(m, parseTagCode(t.code)?.serial ?? 0), 0),
};
for (const [key, value] of Object.entries(counters)) await col('counters').updateOne(own({ key }), { $set: { value } });
console.log('\nRemoved. Numbering now continues from:', Object.entries(counters).map(([k, v]) => `${k} ${v}`).join(', '));
await mongoose.disconnect();

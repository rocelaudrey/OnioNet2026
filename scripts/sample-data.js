// Loads realistic SAMPLE data into one cooperative: farmers, tags, deliveries
// received March to May 2026, hauling and overdue charges, releases, payments,
// and installment plans, with past dates, as if staff had used OnioNet all season.
//
// Everything is recorded by a "Sample Data" staff account (login turned off)
// and every farmer's note says "Sample data", so scripts/remove-sample-data.js
// can take it all out again.
//
// Preview:  node --env-file=<settings file> scripts/sample-data.js --prefix FAF
// Load:     add --confirm
// Options:  --farmers 50  --max-share 0.6  --seed 2026  --overdue-per-month 30
import '../server/timezone.js';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { getBarangaysByMunicipality } from '@aivangogh/ph-address';
import { connectDb } from '../server/db.js';
import { runWithContext } from '../server/context.js';
import {
  AuditLog, Batch, Cooperative, Counter, CustodyEvent, Member, Quadrant, Sack, Tag, TagLot, Transaction, User,
} from '../server/models/index.js';
import { ROLES } from '../server/lib/roles.js';
import { hashPassword } from '../server/lib/password.js';
import { makeTagCode } from '../server/lib/tagCode.js';
import { addMonths, DAY_MS } from '../server/lib/dates.js';
import { resolveAddress } from '../server/lib/address.js';
import { computeCharges } from '../server/services/fees.js';
import { feeTermsFor } from '../server/services/batches.js';
import { splitEvenly } from '../server/services/plans.js';
import { storedByQuadrant } from '../server/services/capacity.js';
import { formatPHP } from '../shared/money.js';

export const SAMPLE_NOTE = 'Sample data';
export const sampleEmail = (prefix) => `sample-data+${prefix.toLowerCase()}@onionet.invalid`;

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const PREFIX = String(arg('--prefix', '')).toUpperCase();
const FARMERS = Number(arg('--farmers', 50));
const MAX_SHARE = Number(arg('--max-share', 0.6));
const SEED = Number(arg('--seed', 2026));
const OVERDUE_PER_MONTH = Math.round(Number(arg('--overdue-per-month', 30)) * 100); // centavos per sack
const CONFIRM = args.includes('--confirm');
if (!PREFIX) throw new Error('Give the cooperative tag prefix, e.g. --prefix FAF');

// ----- Deterministic randomness: the same seed gives the same data -----
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;
const shuffle = (list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const at = (y, m, d, h = 9, min = 0) => new Date(y, m - 1, d, h, min);
const between = (start, end) => new Date(start.getTime() + Math.floor(rand() * Math.max(1, end - start)));
const workHours = (d) => { const x = new Date(d); x.setHours(int(7, 16), int(0, 59), 0, 0); return x; };

// ----- Names and places (made up) -----
const FIRST = ['Juan', 'Pedro', 'Jose', 'Maria', 'Rosario', 'Elena', 'Ricardo', 'Danilo', 'Rogelio', 'Leonora', 'Teresita', 'Ernesto',
  'Florante', 'Marites', 'Rodel', 'Lito', 'Aurora', 'Corazon', 'Virgilio', 'Romeo', 'Josefina', 'Edgardo', 'Rowena', 'Arnel', 'Gloria',
  'Nestor', 'Alma', 'Benjamin', 'Carmelita', 'Dionisio', 'Estrella', 'Felipe', 'Herminio', 'Lourdes', 'Manuel', 'Norma', 'Orlando',
  'Perla', 'Reynaldo', 'Salvacion', 'Tomas', 'Venancio', 'Zenaida', 'Mario', 'Liza', 'Arturo', 'Remedios', 'Fernando', 'Cecilia', 'Jaime'];
const LAST = ['Agbayani', 'Bautista', 'Castillo', 'Dela Cruz', 'Domingo', 'Espiritu', 'Galang', 'Ignacio', 'Lagasca', 'Pascua', 'Ramos',
  'Reyes', 'Sagun', 'Tabangcura', 'Valdez', 'Andres', 'Balagot', 'Cacayorin', 'Dulay', 'Gacusan', 'Lopez', 'Mamaril', 'Pagaduan',
  'Ramirez', 'Sibayan', 'Tolentino', 'Corpuz', 'Esteban', 'Fernandez', 'Gaspar', 'Baguinon', 'Calimlim', 'Dacanay', 'Fabro', 'Guiang'];
const VARIETIES = ['Red Creole', 'Red Creole', 'Red Pinoy', 'Yellow Granex'];
const SIZES = ['Large', 'Medium', 'Medium', 'Small'];
const GRADES = ['A', 'A', 'B'];
// Mostly Aritao, then neighboring Nueva Vizcaya towns.
const TOWNS = [['0205002000', 7], ['0205004000', 1], ['0205008000', 1], ['0205012000', 1], ['0205010000', 1]];
const NV = { regionCode: '0200000000', provinceCode: '0205000000' };
const pickTown = () => { const r = int(1, TOWNS.reduce((s, [, w]) => s + w, 0)); let acc = 0; for (const [code, w] of TOWNS) { acc += w; if (r <= acc) return code; } return TOWNS[0][0]; };

const n = (v) => v.toLocaleString('en-US');

await connectDb();
const coop = await Cooperative.findOne({ 'settings.tagPrefix': PREFIX }).lean();
if (!coop) throw new Error(`No cooperative with tag prefix ${PREFIX}.`);
const cid = coop._id;
const ctxBase = { cooperativeId: String(cid), role: ROLES.COOP_STAFF };
const inCoop = (fn) => runWithContext({ ...ctxBase, system: true }, fn);

const now = new Date();
const fees = coop.settings.fees;
const contractMonths = coop.settings.contractMonths;
if (!fees.storageFeeCentavos) throw new Error('Set the storage fee first (scripts/set-fees.js). Sample deliveries copy the fees at intake.');

const existing = await inCoop(async () => ({
  sampleUser: await User.findOne({ email: sampleEmail(PREFIX) }).lean(),
  members: await Member.countDocuments(),
  batches: await Batch.countDocuments(),
  tags: await Tag.countDocuments(),
  quadrants: await Quadrant.find({ active: true }).sort('fillOrder').lean(),
  stored: await storedByQuadrant(),
}));
if (existing.sampleUser) throw new Error('Sample data is already loaded here. Run scripts/remove-sample-data.js first.');

const capacity = existing.quadrants.reduce((s, q) => s + q.capacity, 0);
const storedNow = [...existing.stored.values()].reduce((s, c) => s + c, 0);
const budget = Math.floor(capacity * MAX_SHARE) - storedNow;
if (budget < FARMERS * 20) throw new Error(`Not enough room: ${n(budget)} sacks allowed under ${MAX_SHARE * 100}%.`);

// ===== 1. Plan the season in memory =====
const usedNames = new Set();
function newName() {
  for (;;) {
    const name = [pick(FIRST), pick(LAST)];
    if (!usedNames.has(name.join(' '))) { usedNames.add(name.join(' ')); return name; }
  }
}

// Sack totals per farmer: small, medium, and large growers, within the budget.
let sizes = shuffle(Array.from({ length: FARMERS }, (_, i) => {
  const p = i / FARMERS;
  if (p < 0.3) return int(20, 60);
  if (p < 0.8) return int(80, 150);
  return int(150, 250);
}));
while (sizes.reduce((s, x) => s + x, 0) > budget) {
  const i = sizes.indexOf(Math.max(...sizes));
  sizes[i] -= 10;
}

const farmers = sizes.map((total) => {
  const [firstName, lastName] = newName();
  const tier = chance(0.8) ? 'member' : 'guest';
  const town = pickTown();
  const barangay = pick(getBarangaysByMunicipality(town));
  const deliveries = total < 70 ? 1 : total < 160 ? int(1, 2) : int(2, 3);
  // Split the farmer's sacks across their deliveries (at least 10 each).
  const parts = [];
  let left = total;
  for (let i = deliveries; i > 1; i -= 1) {
    const part = Math.max(10, Math.min(left - 10 * (i - 1), Math.round((left / i) * (0.7 + rand() * 0.6))));
    parts.push(part);
    left -= part;
  }
  parts.push(left);
  let when = workHours(between(at(2026, 3, 2), at(2026, 5, 12)));
  const batches = parts.map((sacks, i) => {
    if (i > 0) when = workHours(new Date(Math.min(when.getTime() + int(7, 30) * DAY_MS, at(2026, 5, 30).getTime())));
    return { sacks, receivedAt: when };
  });
  return {
    _id: new mongoose.Types.ObjectId(), firstName, lastName, tier,
    address: resolveAddress({ ...NV, municipalityCode: town, barangayCode: barangay.psgcCode, street: chance(0.5) ? `Purok ${int(1, 7)}` : '' }),
    farmAreaHa: Math.round((0.25 + rand() * 3.25) * 100) / 100,
    joinedAt: tier === 'member' ? at(int(2012, 2025), int(1, 12), int(1, 28)) : null,
    batches,
  };
});

// Deliveries in the order they arrived, filling the quadrants in their set order.
const deliveries = farmers.flatMap((f) => f.batches.map((b) => ({ ...b, farmer: f })))
  .sort((a, b) => a.receivedAt - b.receivedAt);
const room = existing.quadrants.map((q) => ({ q, free: q.capacity - (existing.stored.get(String(q._id)) ?? 0) }));
for (const d of deliveries) {
  d._id = new mongoose.Types.ObjectId();
  d.variety = pick(VARIETIES); d.sizeClass = pick(SIZES); d.grade = pick(GRADES);
  d.contractEnd = addMonths(d.receivedAt, contractMonths);
  d.feeTerms = feeTermsFor(fees, d.farmer.tier, []);
  d.sackList = Array.from({ length: d.sacks }, (_, i) => {
    const slot = room.find((r) => r.free > 0);
    slot.free -= 1;
    return { _id: new mongoose.Types.ObjectId(), sackNo: i + 1, quadrantId: slot.q._id, gateInAt: new Date(d.receivedAt.getTime() + i * 15_000), gateOutAt: null };
  });
  d.entries = []; // money entries: { type, chargeKind, amountCentavos, method, referenceNo, paidAt, notes }
  d.releases = []; // { at, sacks: [sack] }
  d.plan = null;
}

// What the delivery owes at a moment: the fee service's charges for the sacks
// as they were then, plus manual charges, minus money in, up to that moment.
function balanceAt(d, t) {
  const sacks = d.sackList.map((s) => ({ gateInAt: s.gateInAt, gateOutAt: s.gateOutAt && s.gateOutAt <= t ? s.gateOutAt : null }));
  const base = computeCharges({ status: 'stored', contractEnd: d.contractEnd, feeTerms: d.feeTerms }, sacks, t).totalCentavos;
  let bal = base;
  for (const e of d.entries) {
    if (e.paidAt > t) continue;
    if (e.type === 'charge' || e.type === 'refund') bal += e.amountCentavos;
    else bal -= e.amountCentavos;
  }
  return bal;
}
const methodFor = () => { const r = rand(); return r < 0.6 ? ['cash', ''] : r < 0.9 ? ['gcash', `G${int(1000000000, 9999999999)}`] : ['bank', `BNK-${int(100000, 999999)}`]; };
const pay = (d, t, amount, note = '') => {
  if (amount <= 0) return;
  const [method, referenceNo] = methodFor();
  d.entries.push({ type: 'payment', amountCentavos: amount, method, referenceNo, paidAt: t, notes: note });
};
const roundPeso = (c) => Math.round(c / 10000) * 10000; // to the nearest ₱100

const lastMoment = new Date(now.getTime() - 2 * 60 * 60 * 1000);
for (const d of deliveries) {
  // Hauling, charged when the sacks arrive.
  if (chance(0.6)) {
    const rate = pick([1500, 2000, 2500, 3000]);
    d.entries.push({ type: 'charge', chargeKind: 'hauling', amountCentavos: rate * d.sacks, paidAt: new Date(d.receivedAt.getTime() + 30 * 60_000 + d.sacks * 15_000), notes: `${formatPHP(rate)} × ${n(d.sacks)} sacks` });
  }
  // Releases: some farmers took everything out, some part, some nothing yet.
  const r = rand();
  const kind = r < 0.35 ? 'full' : r < 0.65 ? 'partial' : 'none';
  if (kind !== 'none') {
    const windowStart = new Date(Math.max(at(2026, 6, 1).getTime(), d.receivedAt.getTime() + 30 * DAY_MS, d.contractEnd.getTime() - 40 * DAY_MS));
    const windowEnd = new Date(Math.min(lastMoment.getTime(), d.contractEnd.getTime() + 75 * DAY_MS));
    const visits = kind === 'full' ? int(1, 3) : int(1, 2);
    const toRelease = kind === 'full' ? d.sacks : Math.max(1, Math.round(d.sacks * (0.3 + rand() * 0.4)));
    const dates = Array.from({ length: visits }, () => workHours(between(windowStart, windowEnd))).sort((a, b) => a - b)
      .filter((x) => x <= lastMoment);
    let released = 0;
    dates.forEach((date, i) => {
      const count = i === dates.length - 1 ? toRelease - released : Math.max(1, Math.round((toRelease - released) / (dates.length - i)));
      const sacks = d.sackList.slice(released, released + count);
      sacks.forEach((s, k) => { s.gateOutAt = new Date(date.getTime() + k * 20_000); });
      released += count;
      d.releases.push({ at: date, sacks });
    });
  }
  // Overdue: on the 1st of each month after the contract ends, staff add a
  // charge for the sacks still in storage.
  for (let m = new Date(d.contractEnd.getFullYear(), d.contractEnd.getMonth() + 1, 1, 9, 0); m <= lastMoment; m = new Date(m.getFullYear(), m.getMonth() + 1, 1, 9, 0)) {
    const still = d.sackList.filter((s) => !s.gateOutAt || s.gateOutAt > m).length;
    if (still > 0) {
      const month = new Date(m.getFullYear(), m.getMonth() - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      d.entries.push({ type: 'charge', chargeKind: 'overdue', amountCentavos: OVERDUE_PER_MONTH * still, paidAt: m, notes: `${formatPHP(OVERDUE_PER_MONTH)} × ${n(still)} sacks, past the contract in ${month}` });
    }
  }
  // Payments: most farmers settle when they take sacks out; a few pay part at intake.
  d.entries.sort((a, b) => a.paidAt - b.paidAt);
  for (const rel of d.releases) {
    const t = new Date(rel.at.getTime() + 15 * 60_000);
    const bal = balanceAt(d, t);
    const r2 = rand();
    if (r2 < 0.65) pay(d, t, bal);
    else if (r2 < 0.85) pay(d, t, Math.min(bal, roundPeso(bal * (0.4 + rand() * 0.4))));
    d.entries.sort((a, b) => a.paidAt - b.paidAt);
  }
  if (!d.releases.length && chance(0.3)) {
    const t = workHours(new Date(d.receivedAt.getTime() + int(0, 20) * DAY_MS));
    pay(d, t, Math.min(balanceAt(d, t), roundPeso(balanceAt(d, t) * (0.3 + rand() * 0.3))), 'Partial payment');
    d.entries.sort((a, b) => a.paidAt - b.paidAt);
  }
}

// Installment plans for six deliveries still fully in storage: four on track, two late.
const candidates = shuffle(deliveries.filter((d) => !d.releases.length && d.sacks >= 40));
candidates.slice(0, 6).forEach((d, i) => {
  const createdAt = workHours(between(at(2026, 8, 20), at(2026, 9, 30)));
  if (createdAt < d.receivedAt || createdAt > lastMoment) return;
  const balance = balanceAt(d, createdAt);
  if (balance < 300000) return;
  const firstDue = new Date(createdAt.getTime() + 14 * DAY_MS); firstDue.setHours(12, 0, 0, 0);
  const amounts = splitEvenly(balance, 3);
  const installments = amounts.map((amountCentavos, k) => ({ dueDate: addMonths(firstDue, k), amountCentavos }));
  d.plan = { createdAt, createdByName: 'Sample Data', frequency: 'monthly', installments, notes: SAMPLE_NOTE, cancelledAt: null };
  const late = i >= 4;
  installments.forEach((inst, k) => {
    if (late && k > 0) return; // late farmers paid only the first installment
    const t = workHours(new Date(inst.dueDate.getTime() - int(0, 3) * DAY_MS));
    if (t > lastMoment) return;
    pay(d, t, Math.min(inst.amountCentavos, balanceAt(d, t)), `Installment ${k + 1} of 3`);
    d.entries.sort((a, b) => a.paidAt - b.paidAt);
  });
});

// ===== 2. Summary =====
const allSacks = deliveries.flatMap((d) => d.sackList);
const storedAfter = allSacks.filter((s) => !s.gateOutAt).length;
const entries = deliveries.flatMap((d) => d.entries);
const sum = (type, kind) => entries.filter((e) => e.type === type && (!kind || e.chargeKind === kind)).reduce((s, e) => s + e.amountCentavos, 0);
const owed = deliveries.reduce((s, d) => s + Math.max(0, balanceAt(d, now)), 0);
console.log(`${coop.name} (${PREFIX}) on database "${mongoose.connection.name}"`);
console.log(`Already there: ${n(existing.members)} farmers, ${n(existing.batches)} deliveries, ${n(existing.tags)} tags, ${n(storedNow)} sacks stored`);
console.log(`Fees used: storage ${formatPHP(fees.storageFeeCentavos)} per sack, ${contractMonths}-month contract, overdue entered by hand at ${formatPHP(OVERDUE_PER_MONTH)} per sack per month (sample rate)`);
console.log(`Sample: ${FARMERS} farmers (${farmers.filter((f) => f.tier === 'member').length} members), ${deliveries.length} deliveries ${deliveries[0].receivedAt.toDateString()} to ${deliveries.at(-1).receivedAt.toDateString()}`);
console.log(`Sacks: ${n(allSacks.length)} received (${((allSacks.length + storedNow) / capacity * 100).toFixed(1)}% of ${n(capacity)} at the peak), ${n(storedAfter)} still stored today (${((storedAfter + storedNow) / capacity * 100).toFixed(1)}%)`);
console.log(`Releases: ${deliveries.reduce((s, d) => s + d.releases.length, 0)} visits, ${n(allSacks.length - storedAfter)} sacks out`);
console.log(`Charges: hauling ${formatPHP(sum('charge', 'hauling'))}, overdue ${formatPHP(sum('charge', 'overdue'))} | Payments: ${formatPHP(sum('payment'))} in ${entries.filter((e) => e.type === 'payment').length} payments | Still owed today: ${formatPHP(owed)}`);
console.log(`Installment plans: ${deliveries.filter((d) => d.plan).length}`);
if (!CONFIRM) {
  console.log('\nPreview only. Nothing was written. Add --confirm to load it.');
  await mongoose.disconnect();
  process.exit(0);
}

// ===== 3. Write it =====
const user = await inCoop(async () => User.create({
  name: 'Sample Data', email: sampleEmail(PREFIX), role: ROLES.COOP_STAFF, active: false,
  passwordHash: await hashPassword(randomBytes(32).toString('hex')),
}));
const ctx = { ...ctxBase, userId: String(user._id), userName: 'Sample Data' };
const write = (fn) => runWithContext(ctx, fn);
const counter = (key, by) => write(async () => (await Counter.findOneAndUpdate({ key }, { $inc: { value: by } }, { upsert: true, returnDocument: 'after' })).value);
const insert = async (Model, docs) => { for (let i = 0; i < docs.length; i += 1000) await write(() => Model.insertMany(docs.slice(i, i + 1000), { timestamps: false })); };
const stamp = (d, date) => ({ ...d, createdAt: date, updatedAt: date });
const audits = [];
const audit = (occurredAt, action, entityType, entityId, entityLabel, changes = []) => audits.push({
  actorId: user._id, actorName: 'Sample Data', actorRole: ROLES.COOP_STAFF, action, entityType, entityId, entityLabel, changes, occurredAt,
});

// Farmers, numbered in the order they first delivered.
const memberStart = (await counter('member', farmers.length)) - farmers.length + 1;
const firstSeen = (f) => Math.min(...deliveries.filter((d) => d.farmer === f).map((d) => d.receivedAt));
const byFirst = [...farmers].sort((a, b) => firstSeen(a) - firstSeen(b));
await insert(Member, byFirst.map((f, i) => {
  const created = new Date(firstSeen(f) - int(1, 20) * DAY_MS);
  audit(created, 'create', 'Member', f._id, `${f.firstName} ${f.lastName}`);
  return stamp({
    _id: f._id, memberNo: `${PREFIX}-M-${String(memberStart + i).padStart(4, '0')}`, tier: f.tier, firstName: f.firstName, lastName: f.lastName,
    address: f.address, farmAreaHa: f.farmAreaHa, joinedAt: f.joinedAt, status: 'active', notes: SAMPLE_NOTE,
  }, created);
}));

// Tags, made in February in lots of up to 1,000, numbered in delivery order.
const tagStart = (await counter('tag', allSacks.length)) - allSacks.length + 1;
const lotsMade = at(2026, 2, 20);
const lots = [];
for (let i = 0; i < allSacks.length; i += 1000) {
  const qty = Math.min(1000, allSacks.length - i);
  lots.push({ _id: new mongoose.Types.ObjectId(), first: tagStart + i, qty });
}
const lotStart = (await counter('tagLot', lots.length)) - lots.length + 1;
await insert(TagLot, lots.map((l, i) => {
  audit(lotsMade, 'create', 'TagLot', l._id, `Tag Lot ${lotStart + i}`, [{ field: 'quantity', from: null, to: l.qty }]);
  return stamp({ _id: l._id, lotNo: lotStart + i, source: 'generated', quantity: l.qty, firstCode: makeTagCode(PREFIX, l.first), lastCode: makeTagCode(PREFIX, l.first + l.qty - 1), createdBy: user._id, printedAt: lotsMade, notes: SAMPLE_NOTE }, lotsMade);
}));
let serial = tagStart;
for (const d of deliveries) for (const s of d.sackList) { s.tagId = new mongoose.Types.ObjectId(); s.tagCode = makeTagCode(PREFIX, serial); s.lot = lots[Math.floor((serial - tagStart) / 1000)]._id; serial += 1; }

// Deliveries, sacks, tags, and custody events.
const batchStart = (await counter('batch:2026', deliveries.length)) - deliveries.length + 1;
const releaseVisits = deliveries.flatMap((d) => d.releases.map((r) => ({ d, r }))).sort((a, b) => a.r.at - b.r.at);
const releaseStart = (await counter('release:2026', releaseVisits.length)) - releaseVisits.length + 1;
releaseVisits.forEach(({ r }, i) => { r.releaseNo = `${PREFIX}-REL-2026-${String(releaseStart + i).padStart(4, '0')}`; });
const batches = []; const sacks = []; const tags = []; const events = [];
deliveries.forEach((d, i) => {
  d.batchNo = `${PREFIX}-B-2026-${String(batchStart + i).padStart(4, '0')}`;
  const out = d.sackList.filter((s) => s.gateOutAt).length;
  batches.push(stamp({
    _id: d._id, batchNo: d.batchNo, ownerType: d.farmer.tier, memberId: d.farmer._id, receivedAt: d.receivedAt, receivedBy: user._id,
    variety: d.variety, sizeClass: d.sizeClass, grade: d.grade, declaredSackCount: d.sacks, totalWeightKg: d.sacks * int(20, 25),
    contractStart: d.receivedAt, contractEnd: d.contractEnd, feeTerms: d.feeTerms,
    status: out === 0 ? 'stored' : out === d.sacks ? 'released' : 'partly_released', notes: SAMPLE_NOTE,
    paymentPlan: d.plan ? { ...d.plan, createdBy: user._id } : null, ledgerVersion: 0,
  }, d.receivedAt));
  const rangeNote = `Range ${d.sackList[0].tagCode} to ${d.sackList.at(-1).tagCode} (${n(d.sacks)} tags)`;
  audit(d.receivedAt, 'create', 'Batch', d._id, d.batchNo);
  audit(d.receivedAt, 'create', 'Batch', d._id, `${d.batchNo}: tags assigned by range`, [{ field: 'range (first and last scanned)', from: null, to: rangeNote }]);
  for (const s of d.sackList) {
    const releasedIn = d.releases.find((r) => r.sacks.includes(s));
    sacks.push(stamp({
      _id: s._id, batchId: d._id, memberId: d.farmer._id, sackNo: s.sackNo, currentTagId: s.gateOutAt ? null : s.tagId,
      quadrantId: s.quadrantId, status: s.gateOutAt ? 'released' : 'stored', gateInAt: s.gateInAt, gateOutAt: s.gateOutAt,
    }, s.gateInAt));
    tags.push(stamp({
      _id: s.tagId, code: s.tagCode, tagLotId: s.lot, source: 'generated', qrSigned: true,
      status: s.gateOutAt ? 'available' : 'assigned', currentSackId: s.gateOutAt ? null : s._id, useCount: 1,
      lastScannedAt: s.gateOutAt ?? s.gateInAt,
    }, lotsMade));
    events.push(stamp({ type: 'gate_in', method: 'range_scan', tagId: s.tagId, sackId: s._id, batchId: d._id, memberId: d.farmer._id, toQuadrantId: s.quadrantId, performedBy: user._id, performedByName: 'Sample Data', occurredAt: s.gateInAt, notes: rangeNote }, s.gateInAt));
    if (s.gateOutAt) {
      events.push(stamp({ type: 'gate_out', method: 'scan', tagId: s.tagId, sackId: s._id, batchId: d._id, memberId: d.farmer._id, fromQuadrantId: s.quadrantId, performedBy: user._id, performedByName: 'Sample Data', occurredAt: s.gateOutAt, releaseNo: releasedIn.releaseNo }, s.gateOutAt));
    }
  }
  if (d.plan) audit(d.plan.createdAt, 'create', 'PaymentPlan', d._id, `${d.batchNo} installment plan`, [{ field: 'installments', from: null, to: `3 × monthly, ${formatPHP(d.plan.installments.reduce((s2, x) => s2 + x.amountCentavos, 0))} in total` }]);
});
await insert(Batch, batches);
await insert(Tag, tags);
await insert(Sack, sacks);
await insert(CustodyEvent, events);
await write(() => Counter.insertMany(deliveries.map((d) => ({ key: `sack:${d._id}`, value: d.sacks }))));

// Money entries, with receipt numbers in date order.
const money = deliveries.flatMap((d) => d.entries.map((e) => ({ ...e, d }))).sort((a, b) => a.paidAt - b.paidAt);
const receiptStart = (await counter('receipt:2026', money.length)) - money.length + 1;
const LABEL = { payment: 'Payment', charge: 'Charge' };
await insert(Transaction, money.map((e, i) => {
  const _id = new mongoose.Types.ObjectId();
  const receiptNo = `${PREFIX}-R-2026-${String(receiptStart + i).padStart(4, '0')}`;
  audit(e.paidAt, 'create', 'Transaction', _id, `${receiptNo} (${LABEL[e.type]}, ${e.d.batchNo})`, [{ field: 'amountCentavos', from: null, to: e.amountCentavos }]);
  return stamp({
    _id, receiptNo, type: e.type, chargeKind: e.chargeKind ?? null, batchId: e.d._id, memberId: e.d.farmer._id,
    amountCentavos: e.amountCentavos, method: e.method ?? null, referenceNo: e.referenceNo || undefined,
    paidAt: e.paidAt, recordedBy: user._id, notes: e.notes || undefined,
  }, e.paidAt);
}));
await insert(AuditLog, audits.sort((a, b) => a.occurredAt - b.occurredAt));

console.log(`\nLoaded: ${farmers.length} farmers, ${deliveries.length} deliveries, ${n(sacks.length)} sacks, ${n(tags.length)} tags, ${n(events.length)} custody events, ${money.length} payments and charges, ${audits.length} audit entries.`);
console.log(`Recorded by the "Sample Data" account (login turned off). Remove it all with scripts/remove-sample-data.js.`);
await mongoose.disconnect();

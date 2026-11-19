import { addressLine } from '../lib/address.js';
import { Router } from 'express';
import { Batch } from '../models/Batch.js';
import { Cooperative } from '../models/Cooperative.js';
import { CustodyEvent } from '../models/CustodyEvent.js';
import { Member } from '../models/Member.js';
import { Tag } from '../models/Tag.js';
import { TagLot } from '../models/TagLot.js';
import { Transaction } from '../models/Transaction.js';
import { TAG_STATUSES } from '../../shared/statuses.js';
import { DAY_MS } from '../lib/dates.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { recordAudit } from '../services/audit.js';
import { capacityOverview } from '../services/capacity.js';
import { loadAccounts, overdueDays } from '../services/fees.js';
import { moneySummary } from '../services/summaries.js';
import { farmerAccounts, statementFor, storedByBatch } from '../services/statements.js';

// Reports return data only. They are laid out and printed (or saved as PDF)
// in the browser. Every peso amount comes from the fee service.
const router = Router();
const OPEN = ['receiving', 'stored', 'partly_released'];
const fullName = (m) => (m ? `${m.firstName} ${m.lastName}`.trim() : 'Cooperative stock');
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Date range from ?from=YYYY-MM-DD&to=YYYY-MM-DD; default the last 30 days.
function range(query) {
  const now = new Date();
  const valid = (t) => /^\d{4}-\d{2}-\d{2}$/.test(String(t ?? ''));
  const to = valid(query.to) ? query.to : localDay(now);
  const from = valid(query.from) ? query.from : localDay(new Date(now.getTime() - 29 * DAY_MS));
  if (from > to) throw new HttpError(400, 'The start date must be on or before the end date.');
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T23:59:59.999`);
  if (end - start > 367 * DAY_MS) throw new HttpError(400, 'Choose a range of one year or less.');
  return { from, to, start, end };
}

// ----- Inventory -----
router.get('/inventory', async (req, res) => {
  const now = new Date();
  const [overview, batches] = await Promise.all([
    capacityOverview(),
    Batch.find({ status: { $in: OPEN } }).sort({ receivedAt: 1 }).populate('memberId', 'firstName lastName memberNo').lean(),
  ]);
  const counts = await storedByBatch(batches.map((b) => b._id));
  const deliveries = batches.map((b) => {
    const c = counts.get(String(b._id)) ?? { received: 0, stored: 0 };
    return {
      batchNo: b.batchNo, ownerName: fullName(b.memberId), memberNo: b.memberId?.memberNo ?? null, status: b.status,
      receivedAt: b.receivedAt, contractEnd: b.contractEnd, variety: b.variety ?? '', sizeClass: b.sizeClass ?? '', grade: b.grade ?? '',
      sacksReceived: c.received, sacksStored: c.stored, overdue: c.stored > 0 && b.contractEnd < now,
    };
  }).filter((d) => d.sacksStored > 0 || d.status === 'receiving');

  const farmers = new Map();
  for (const d of deliveries) {
    const key = d.memberNo ?? 'coop';
    const f = farmers.get(key) ?? { ownerName: d.ownerName, memberNo: d.memberNo, deliveries: 0, sacksStored: 0 };
    f.deliveries += 1;
    f.sacksStored += d.sacksStored;
    farmers.set(key, f);
  }
  res.json({
    generatedAt: now,
    totals: { capacity: overview.capacity, stored: overview.stored, pending: overview.pending, available: overview.available, deliveries: deliveries.length },
    quadrants: overview.quadrants.map((q) => ({ code: q.code, floor: q.floor, active: q.active, capacity: q.capacity, stored: q.used, free: q.free })),
    farmers: [...farmers.values()].sort((a, b) => b.sacksStored - a.sacksStored),
    deliveries,
  });
});

// ----- Movements -----
router.get('/movements', async (req, res) => {
  const r = range(req.query);
  const match = { type: { $in: ['gate_in', 'move', 'gate_out'] }, occurredAt: { $gte: r.start, $lte: r.end } };
  const [daily, staff] = await Promise.all([
    CustodyEvent.aggregate([
      { $match: match },
      { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt', timezone: timeZone() } }, type: '$type' }, count: { $sum: 1 } } },
    ]),
    CustodyEvent.aggregate([
      { $match: match },
      { $group: { _id: { name: '$performedByName', type: '$type' }, count: { $sum: 1 } } },
    ]),
  ]);
  const KEY = { gate_in: 'entries', move: 'moves', gate_out: 'releases' };
  const empty = () => ({ entries: 0, moves: 0, releases: 0 });
  const days = new Map();
  for (const { _id, count } of daily) {
    const row = days.get(_id.day) ?? empty();
    row[KEY[_id.type]] = count;
    days.set(_id.day, row);
  }
  const people = new Map();
  for (const { _id, count } of staff) {
    const row = people.get(_id.name) ?? { name: _id.name, ...empty() };
    row[KEY[_id.type]] = count;
    people.set(_id.name, row);
  }
  const rows = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v }));
  const totals = rows.reduce((t, d) => ({ entries: t.entries + d.entries, moves: t.moves + d.moves, releases: t.releases + d.releases }), empty());
  res.json({ generatedAt: new Date(), from: r.from, to: r.to, totals, days: rows, staff: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)) });
});

// ----- Fees and collections -----
router.get('/fees', async (req, res) => {
  const r = range(req.query);
  const now = new Date();
  const [collected, voided, batches, summary] = await Promise.all([
    Transaction.aggregate([
      { $match: { 'voided.at': null, paidAt: { $gte: r.start, $lte: r.end } } },
      { $group: { _id: { type: '$type', method: '$method' }, count: { $sum: 1 }, total: { $sum: '$amountCentavos' } } },
    ]),
    Transaction.countDocuments({ 'voided.at': { $ne: null }, paidAt: { $gte: r.start, $lte: r.end } }),
    Batch.find({ status: { $ne: 'cancelled' }, ownerType: { $ne: 'coop_owned' } }).sort({ receivedAt: 1 })
      .populate('memberId', 'firstName lastName memberNo').lean(),
    moneySummary(now),
  ]);
  const accounts = await loadAccounts(batches, { asOf: now });
  const deliveries = batches.map((b) => {
    const a = accounts.get(String(b._id));
    return {
      batchNo: b.batchNo, ownerName: fullName(b.memberId), memberNo: b.memberId?.memberNo ?? null, receivedAt: b.receivedAt,
      totalCentavos: a.totalCentavos, overdueCentavos: a.overdueCentavos,
      creditedCentavos: a.paidCentavos + a.adjustedCentavos - a.refundedCentavos,
      balanceCentavos: a.balanceCentavos, planStatus: a.plan?.status ?? null,
    };
  }).filter((d) => d.totalCentavos > 0 || d.creditedCentavos !== 0);

  const sum = (type) => collected.filter((c) => c._id.type === type).reduce((s, c) => s + c.total, 0);
  const byMethod = ['cash', 'gcash', 'bank'].map((method) => ({
    method,
    paymentsCentavos: collected.filter((c) => c._id.type === 'payment' && c._id.method === method).reduce((s, c) => s + c.total, 0),
    refundsCentavos: collected.filter((c) => c._id.type === 'refund' && c._id.method === method).reduce((s, c) => s + c.total, 0),
  }));
  res.json({
    generatedAt: now, from: r.from, to: r.to,
    period: {
      paymentsCentavos: sum('payment'), refundsCentavos: sum('refund'), waivedCentavos: sum('adjustment'),
      netCollectedCentavos: sum('payment') - sum('refund'), voidedEntries: voided, byMethod,
    },
    asOfToday: {
      chargesCentavos: deliveries.reduce((s, d) => s + d.totalCentavos, 0),
      outstandingCentavos: summary.outstandingCentavos,
      unpaidDeliveries: summary.unpaidDeliveries,
      overdueFeesCentavos: summary.overdueFeesCentavos,
      latePlans: summary.latePlans,
    },
    deliveries,
  });
});

// ----- Overdue deliveries -----
router.get('/overdue', async (req, res) => {
  const now = new Date();
  const batches = await Batch.find({ contractEnd: { $lt: now }, status: { $in: ['stored', 'partly_released'] } })
    .sort({ contractEnd: 1 }).populate('memberId', 'firstName lastName memberNo phone').lean();
  const [counts, accounts] = await Promise.all([storedByBatch(batches.map((b) => b._id)), loadAccounts(batches, { asOf: now })]);
  const rows = batches.map((b) => {
    const a = accounts.get(String(b._id));
    return {
      batchNo: b.batchNo, ownerName: fullName(b.memberId), memberNo: b.memberId?.memberNo ?? null, phone: b.memberId?.phone ?? '',
      contractEnd: b.contractEnd, daysOverdue: overdueDays(new Date(b.contractEnd), now),
      sacksStored: counts.get(String(b._id))?.stored ?? 0,
      overdueCentavos: a.overdueCentavos, balanceCentavos: a.balanceCentavos, planStatus: a.plan?.status ?? null,
    };
  }).filter((r) => r.sacksStored > 0);
  res.json({
    generatedAt: now,
    totals: {
      deliveries: rows.length,
      sacks: rows.reduce((s, r) => s + r.sacksStored, 0),
      overdueCentavos: rows.reduce((s, r) => s + r.overdueCentavos, 0),
      balanceCentavos: rows.reduce((s, r) => s + Math.max(0, r.balanceCentavos), 0),
    },
    deliveries: rows,
  });
});

// ----- Tags -----
router.get('/tags', async (req, res) => {
  const [byStatus, byLot, reuse, problems, lots] = await Promise.all([
    Tag.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Tag.aggregate([{ $group: { _id: { lot: '$tagLotId', status: '$status' }, count: { $sum: 1 } } }]),
    Tag.aggregate([{ $group: { _id: null, tags: { $sum: 1 }, used: { $sum: { $cond: [{ $gt: ['$useCount', 0] }, 1, 0] } }, uses: { $sum: '$useCount' }, most: { $max: '$useCount' } } }]),
    Tag.find({ status: { $in: ['damaged', 'lost'] } }).sort('code').populate('tagLotId', 'lotNo').lean(),
    TagLot.find().sort('lotNo').lean(),
  ]);
  const totals = Object.fromEntries(TAG_STATUSES.map((s) => [s, 0]));
  for (const { _id, count } of byStatus) totals[_id] = count;
  const lotRows = lots.map((lot) => {
    const row = { lotNo: lot.lotNo, source: lot.source, quantity: lot.quantity, firstCode: lot.firstCode, lastCode: lot.lastCode, ...Object.fromEntries(TAG_STATUSES.map((s) => [s, 0])) };
    for (const { _id, count } of byLot) if (String(_id.lot) === String(lot._id)) row[_id.status] = count;
    return row;
  });
  const u = reuse[0] ?? { tags: 0, used: 0, uses: 0, most: 0 };
  res.json({
    generatedAt: new Date(),
    totals: { ...totals, all: u.tags },
    reuse: { usedAtLeastOnce: u.used, totalUses: u.uses, mostUses: u.most ?? 0, averageUses: u.used ? Math.round((u.uses / u.used) * 10) / 10 : 0 },
    lots: lotRows,
    problems: problems.map((t) => ({ code: t.code, status: t.status, lotNo: t.tagLotId?.lotNo ?? null, lastScannedAt: t.lastScannedAt })),
  });
});

// ----- Farmer masterlist -----
router.get('/members', async (req, res) => {
  const { members, batches, accounts, counts } = await farmerAccounts();
  const rows = members.map((m) => {
    const own = batches.filter((b) => String(b.memberId) === String(m._id));
    return {
      memberNo: m.memberNo, name: `${m.lastName}, ${m.firstName}`, tier: m.tier, status: m.status, phone: m.phone ?? '',
      address: addressLine(m.address),
      farmAreaHa: m.farmAreaHa ?? null, rsbsaNo: m.rsbsaNo ?? '', joinedAt: m.joinedAt ?? null,
      deliveries: own.length,
      sacksStored: own.reduce((s, b) => s + (counts.get(String(b._id))?.stored ?? 0), 0),
      balanceCentavos: own.reduce((s, b) => s + accounts.get(String(b._id)).balanceCentavos, 0),
    };
  });
  const by = (key, value) => rows.filter((r) => r[key] === value).length;
  res.json({
    generatedAt: new Date(),
    totals: { all: rows.length, members: by('tier', 'member'), guests: by('tier', 'guest'), inactive: by('status', 'inactive') },
    members: rows,
  });
});

// ----- Statement of account (one farmer) -----
router.get('/statement/:memberId', async (req, res) => {
  const statement = await statementFor(req.params.memberId);
  if (!statement) throw notFound('Farmer');
  res.json(statement);
});

// Printing or saving a report as PDF is recorded in the audit log, since
// reports can hold farmers' personal data (RA 10173).
const REPORT_NAMES = {
  inventory: 'Inventory report', movements: 'Movements report', fees: 'Fees and collections report',
  overdue: 'Overdue deliveries report', tags: 'Tags report', members: 'Farmer masterlist', statement: 'Statement of account',
};
router.post('/printed', async (req, res) => {
  const report = req.body?.report;
  if (!REPORT_NAMES[report]) throw new HttpError(400, 'Unknown report.');
  const coop = await Cooperative.findById(req.user.cooperativeId).select('subscription.enabledFeatures').lean();
  if (!coop?.subscription?.enabledFeatures?.includes('pdf_reports')) {
    throw new HttpError(403, 'Printing reports is not available on your plan. Contact OnioNet to turn it on.');
  }
  let label = REPORT_NAMES[report];
  let entityId = null;
  if (report === 'statement') {
    const member = await Member.findOne({ _id: req.body?.memberId }).lean();
    if (!member) throw notFound('Farmer');
    label = `${label}: ${member.firstName} ${member.lastName}`;
    entityId = member._id;
  }
  await recordAudit({ action: 'export', entityType: 'Report', entityId, entityLabel: label });
  res.json({ ok: true });
});

export default router;

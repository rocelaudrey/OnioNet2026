import { Router } from 'express';
import { Batch } from '../models/Batch.js';
import { CustodyEvent } from '../models/CustodyEvent.js';
import { Sack } from '../models/Sack.js';
import { Tag } from '../models/Tag.js';
import { Transaction } from '../models/Transaction.js';
import { TAG_STATUSES } from '../../shared/statuses.js';
import { DAY_MS } from '../lib/dates.js';
import { capacityOverview } from '../services/capacity.js';
import { moneySummary } from '../services/summaries.js';

// The cooperative dashboard. Every number comes from the same services as
// the Inventory, QR Tags, and Transactions pages, so they always agree.
const router = Router();
const CHART_DAYS = [7, 14, 30];
const GROUP_GAP_MS = 5 * 60 * 1000; // scans by one person within 5 minutes form one activity line
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fullName = (m) => (m ? `${m.firstName} ${m.lastName}`.trim() : 'Cooperative stock');

// Sacks scanned in (entries) and out (releases) per day, oldest day first.
async function entriesAndReleases(days, now) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const rows = await CustodyEvent.aggregate([
    { $match: { type: { $in: ['gate_in', 'gate_out'] }, occurredAt: { $gte: start } } },
    { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt', timezone: timeZone() } }, type: '$type' }, count: { $sum: 1 } } },
  ]);
  const byDay = new Map();
  for (const { _id, count } of rows) {
    const entry = byDay.get(_id.day) ?? { entries: 0, releases: 0 };
    entry[_id.type === 'gate_in' ? 'entries' : 'releases'] = count;
    byDay.set(_id.day, entry);
  }
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(start.getTime() + i * DAY_MS + 12 * 60 * 60 * 1000);
    const key = localDay(day);
    return { date: key, ...(byDay.get(key) ?? { entries: 0, releases: 0 }) };
  });
}

// Latest activity: custody events grouped (a range of 100 sacks is one line,
// not 100) and payments, newest first.
async function recentActivity(limit = 10) {
  const [events, transactions] = await Promise.all([
    CustodyEvent.find().sort({ occurredAt: -1, _id: -1 }).limit(400)
      .populate('batchId', 'batchNo').populate('memberId', 'firstName lastName')
      .populate('tagId', 'code').populate('toQuadrantId', 'code').lean(),
    Transaction.find().sort({ createdAt: -1 }).limit(limit)
      .populate('memberId', 'firstName lastName').populate('recordedBy', 'name').lean(),
  ]);

  const groups = [];
  for (const e of events) {
    const key = [e.type, e.batchId?._id, e.performedByName, e.releaseNo, e.toQuadrantId?._id].map(String).join('|');
    const last = groups.at(-1);
    if (last && last.key === key && last.oldest - new Date(e.occurredAt) <= GROUP_GAP_MS) {
      last.count += 1;
      last.oldest = new Date(e.occurredAt);
      last.methods.add(e.method ?? 'scan');
    } else {
      if (groups.length >= limit) break;
      groups.push({ key, event: e, count: 1, oldest: new Date(e.occurredAt), methods: new Set([e.method ?? 'scan']) });
    }
  }

  const sacks = (n) => `${n.toLocaleString('en-US')} ${n === 1 ? 'sack' : 'sacks'}`;
  const items = groups.map(({ event: e, count, methods }) => {
    const who = `by ${e.performedByName}`;
    const owner = e.batchId ? `${fullName(e.memberId)} · ${e.batchId.batchNo}` : '';
    const base = { kind: e.type, at: e.occurredAt, batchId: e.batchId?._id ?? null, tagId: e.tagId?._id ?? null };
    switch (e.type) {
      case 'gate_in': return { ...base, title: `${sacks(count)} received${methods.has('range_scan') || methods.has('range_typed') ? ' by range' : ''}`, detail: `${owner} · ${who}` };
      case 'gate_out': return { ...base, title: `${sacks(count)} released`, detail: `${owner} · ${who}` };
      case 'move': return { ...base, title: `${sacks(count)} moved to ${e.toQuadrantId?.code ?? 'another quadrant'}`, detail: `${owner} · ${who}` };
      case 'tag_replaced': return { ...base, title: count > 1 ? 'Tags replaced' : `Tag ${e.tagId?.code ?? ''} replaced`, detail: `${owner} · ${who}` };
      default: return { ...base, title: `Tag ${e.tagId?.code ?? ''} ${{ tag_damaged: 'marked damaged', tag_lost: 'marked lost', tag_retired: 'retired', tag_restored: 'back in service' }[e.type] ?? 'changed'}`, detail: who };
    }
  });

  for (const t of transactions) {
    items.push({
      kind: t.voided?.at ? 'void' : t.type,
      at: t.createdAt,
      transactionId: t._id,
      amountCentavos: t.amountCentavos,
      title: { payment: 'Payment received', adjustment: 'Waiver or discount', refund: 'Refund given' }[t.type] + (t.voided?.at ? ' (voided)' : ''),
      detail: `${fullName(t.memberId)} · ${t.receiptNo} · by ${t.recordedBy?.name ?? ''}`,
    });
  }
  return items.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit);
}

router.get('/', async (req, res) => {
  const now = new Date();
  const days = CHART_DAYS.includes(Number(req.query.days)) ? Number(req.query.days) : 14;
  const [storage, money, tagRows, overdue, receiving, chart, activity] = await Promise.all([
    capacityOverview(),
    moneySummary(now),
    Tag.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    // Overdue: contract ended and sacks still stored. Worked out now, not stored.
    Batch.find({ contractEnd: { $lt: now }, status: { $in: ['stored', 'partly_released'] } }).select('_id').lean()
      .then(async (rows) => ({
        deliveries: rows.length,
        sacks: rows.length ? await Sack.countDocuments({ batchId: { $in: rows.map((r) => r._id) }, status: 'stored' }) : 0,
      })),
    Batch.countDocuments({ status: 'receiving' }),
    entriesAndReleases(days, now),
    recentActivity(),
  ]);
  const tags = Object.fromEntries(TAG_STATUSES.map((s) => [s, 0]));
  for (const { _id, count } of tagRows) tags[_id] = count;
  const percentUsed = storage.capacity ? Math.round(((storage.stored + storage.pending) / storage.capacity) * 1000) / 10 : 0;

  res.json({
    storage: {
      capacity: storage.capacity, stored: storage.stored, pending: storage.pending, available: storage.available,
      percentUsed,
      level: percentUsed > 90 ? 'critical' : percentUsed >= 70 ? 'high' : 'optimal',
    },
    tags,
    money,
    attention: {
      overdueDeliveries: overdue.deliveries,
      overdueSacks: overdue.sacks,
      receiving,
      latePlans: money.latePlans,
      lateInstallmentsCentavos: money.lateInstallmentsCentavos,
      damagedOrLostTags: tags.damaged + tags.lost,
    },
    chart: { days, points: chart },
    activity,
  });
});

export default router;

import { Router } from 'express';
import { Transaction } from '../models/Transaction.js';
import { Batch } from '../models/Batch.js';
import { Member } from '../models/Member.js';
import { Cooperative } from '../models/Cooperative.js';
import { ROLES } from '../lib/roles.js';
import { PAYMENT_METHODS, TRANSACTION_TYPES } from '../../shared/statuses.js';
import { requireRole } from '../middleware/auth.js';
import { notFound } from '../middleware/errors.js';
import { accountFor, loadAccounts } from '../services/fees.js';
import { recordTransaction, voidTransaction } from '../services/transactions.js';

const router = Router();
const PAGE_SIZE = 50;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ownerName = (t) => (t.memberId ? `${t.memberId.firstName} ${t.memberId.lastName}`.trim() : 'Cooperative stock');

export const transactionView = (t) => ({
  id: t._id,
  receiptNo: t.receiptNo,
  type: t.type,
  amountCentavos: t.amountCentavos,
  method: t.method ?? null,
  referenceNo: t.referenceNo ?? '',
  paidAt: t.paidAt,
  notes: t.notes ?? '',
  ownerName: ownerName(t),
  memberId: t.memberId?._id ?? null,
  batchId: t.batchId?._id ?? t.batchId,
  batchNo: t.batchId?.batchNo ?? '',
  recordedByName: t.recordedBy?.name ?? '',
  voided: Boolean(t.voided?.at),
  voidedAt: t.voided?.at ?? null,
  voidReason: t.voided?.reason ?? '',
});

const populated = (query) => query
  .populate('memberId', 'firstName lastName memberNo')
  .populate('batchId', 'batchNo')
  .populate('recordedBy', 'name');

function day(text, endOfDay) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(text ?? ''))) return null;
  return new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00'}`);
}

// Farmer names are searched in the request body, never in the address.
async function listTransactions(body = {}) {
  const filter = {};
  if (TRANSACTION_TYPES.includes(body.type)) filter.type = body.type;
  if (PAYMENT_METHODS.includes(body.method)) filter.method = body.method;
  if (body.status === 'voided') filter['voided.at'] = { $ne: null };
  if (body.status === 'valid') filter['voided.at'] = null;
  const from = day(body.from, false);
  const to = day(body.to, true);
  if (from || to) filter.paidAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const q = String(body.q ?? '').trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const words = q.split(/\s+/).slice(0, 5).map((w) => new RegExp(escapeRegex(w), 'i'));
    const [members, batches] = await Promise.all([
      Member.find({ $and: words.map((w) => ({ $or: [{ firstName: w }, { lastName: w }, { memberNo: w }] })) }).select('_id').limit(200).lean(),
      Batch.find({ batchNo: rx }).select('_id').limit(200).lean(),
    ]);
    filter.$or = [{ receiptNo: rx }, { memberId: { $in: members.map((m) => m._id) } }, { batchId: { $in: batches.map((b) => b._id) } }];
  }
  const page = Math.max(1, Number.parseInt(body.page, 10) || 1);
  const [rows, total] = await Promise.all([
    populated(Transaction.find(filter).sort({ paidAt: -1, _id: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE)).lean(),
    Transaction.countDocuments(filter),
  ]);
  return { transactions: rows.map(transactionView), total, page, pageSize: PAGE_SIZE };
}

router.get('/', async (req, res) => {
  res.json(await listTransactions({ page: req.query.page }));
});

router.post('/search', async (req, res) => {
  res.json(await listTransactions(req.body));
});

// Numbers for the Transactions page. Collections count payments minus refunds.
router.get('/summary', async (req, res) => {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const collected = async (since) => {
    const rows = await Transaction.aggregate([
      { $match: { 'voided.at': null, paidAt: { $gte: since }, type: { $in: ['payment', 'refund'] } } },
      { $group: { _id: '$type', total: { $sum: '$amountCentavos' } } },
    ]);
    const by = Object.fromEntries(rows.map((r) => [r._id, r.total]));
    return (by.payment ?? 0) - (by.refund ?? 0);
  };
  const batches = await Batch.find({ status: { $ne: 'cancelled' }, ownerType: { $ne: 'coop_owned' } }).lean();
  const accounts = await loadAccounts(batches, { asOf: now });
  let outstanding = 0;
  let unpaid = 0;
  let overdueFees = 0;
  let latePlans = 0;
  let lateInstallments = 0;
  for (const account of accounts.values()) {
    if (account.plan?.status === 'late') {
      latePlans += 1;
      lateInstallments += account.plan.lateCentavos;
    }
    if (account.balanceCentavos > 0) {
      outstanding += account.balanceCentavos;
      unpaid += 1;
    }
    overdueFees += account.overdueCentavos;
  }
  res.json({
    collectedTodayCentavos: await collected(startOfDay),
    collectedThisMonthCentavos: await collected(startOfMonth),
    outstandingCentavos: outstanding,
    unpaidDeliveries: unpaid,
    overdueFeesCentavos: overdueFees,
    latePlans,
    lateInstallmentsCentavos: lateInstallments,
  });
});

router.post('/', async (req, res) => {
  const { transaction, repeat } = await recordTransaction(req.body);
  res.status(repeat ? 200 : 201).json({ repeat, transaction: { id: transaction._id, receiptNo: transaction.receiptNo } });
});

// One receipt, with the delivery's balance as of now.
router.get('/:id', async (req, res) => {
  const t = await populated(Transaction.findOne({ _id: req.params.id })).populate('voided.by', 'name').lean();
  if (!t) throw notFound('Receipt');
  const [batch, coop] = await Promise.all([
    Batch.findOne({ _id: t.batchId._id }).lean(),
    Cooperative.findById(req.user.cooperativeId).select('name facilityName address').lean(),
  ]);
  const account = await accountFor(batch);
  res.json({
    transaction: { ...transactionView(t), memberNo: t.memberId?.memberNo ?? null, voidedByName: t.voided?.by?.name ?? '' },
    cooperative: { name: coop.name, facilityName: coop.facilityName ?? '', address: coop.address ?? '' },
    delivery: { totalCentavos: account.totalCentavos, balanceCentavos: account.balanceCentavos, plan: account.plan },
  });
});

router.post('/:id/void', requireRole(ROLES.COOP_ADMIN), async (req, res) => {
  const t = await voidTransaction(req.params.id, req.body?.reason);
  res.json({ transaction: { id: t._id, voided: true } });
});

export default router;

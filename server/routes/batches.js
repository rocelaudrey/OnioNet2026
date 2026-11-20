import { Router } from 'express';
import { Batch } from '../models/Batch.js';
import { Member } from '../models/Member.js';
import { Sack } from '../models/Sack.js';
import { CustodyEvent } from '../models/CustodyEvent.js';
import { Cooperative } from '../models/Cooperative.js';
import { BATCH_STATUSES } from '../../shared/statuses.js';
import { notFound } from '../middleware/errors.js';
import { capacityOverview, suggestQuadrant } from '../services/capacity.js';
import { loadAccounts } from '../services/fees.js';
import { Transaction } from '../models/Transaction.js';
import { transactionView } from './transactions.js';
import { cancelIntake, finishReceiving, startIntake, updateBatch } from '../services/batches.js';
import { cancelPlan, createPlan } from '../services/plans.js';
import { requireRole } from '../middleware/auth.js';
import { ROLES } from '../lib/roles.js';

const router = Router();
const PAGE_SIZE = 50;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ownerName = (batch) => (batch.ownerType === 'coop_owned'
  ? 'Cooperative stock'
  : `${batch.memberId?.firstName ?? ''} ${batch.memberId?.lastName ?? ''}`.trim());

// Sack counts per delivery: { received, stored }.
async function sackCounts(batchIds) {
  const rows = await Sack.aggregate([
    { $match: { batchId: { $in: batchIds } } },
    { $group: { _id: { batchId: '$batchId', status: '$status' }, count: { $sum: 1 } } },
  ]);
  const out = new Map(batchIds.map((id) => [String(id), { received: 0, stored: 0 }]));
  for (const { _id, count } of rows) {
    const entry = out.get(String(_id.batchId));
    entry.received += count;
    if (_id.status === 'stored') entry.stored += count;
  }
  return out;
}

function view(batch, counts, now = new Date()) {
  const c = counts.get(String(batch._id)) ?? { received: 0, stored: 0 };
  return {
    id: batch._id,
    batchNo: batch.batchNo,
    ownerType: batch.ownerType,
    ownerName: ownerName(batch),
    memberId: batch.memberId?._id ?? null,
    memberNo: batch.memberId?.memberNo ?? null,
    receivedAt: batch.receivedAt,
    variety: batch.variety ?? '',
    sizeClass: batch.sizeClass ?? '',
    grade: batch.grade ?? '',
    declaredSackCount: batch.declaredSackCount,
    totalWeightKg: batch.totalWeightKg ?? null,
    farm: batch.farm ? { id: batch.farm.farmId, name: batch.farm.name, location: batch.farm.location ?? '' } : null,
    condition: batch.condition ?? null,
    contractStart: batch.contractStart,
    contractEnd: batch.contractEnd,
    status: batch.status,
    notes: batch.notes ?? '',
    sacksReceived: c.received,
    sacksStored: c.stored,
    // Worked out when read, never stored.
    overdue: c.stored > 0 && batch.contractEnd < now,
  };
}

async function listBatches(body = {}) {
  const filter = {};
  if (BATCH_STATUSES.includes(body.status)) filter.status = body.status;
  else filter.status = { $ne: 'cancelled' };
  if (body.overdue) Object.assign(filter, { contractEnd: { $lt: new Date() }, status: { $in: ['stored', 'partly_released'] } });
  const q = String(body.q ?? '').trim();
  if (q) {
    const words = q.split(/\s+/).slice(0, 5).map((w) => new RegExp(escapeRegex(w), 'i'));
    const members = await Member.find({ $and: words.map((rx) => ({ $or: [{ firstName: rx }, { lastName: rx }, { memberNo: rx }] })) }).select('_id').limit(200).lean();
    filter.$or = [{ batchNo: new RegExp(escapeRegex(q), 'i') }, { memberId: { $in: members.map((m) => m._id) } }];
  }
  const page = Math.max(1, Number.parseInt(body.page, 10) || 1);
  const [batches, total] = await Promise.all([
    Batch.find(filter).sort({ receivedAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE)
      .populate('memberId', 'firstName lastName memberNo').lean(),
    Batch.countDocuments(filter),
  ]);
  const [counts, accounts] = await Promise.all([sackCounts(batches.map((b) => b._id)), loadAccounts(batches)]);
  return {
    batches: batches.map((b) => {
      const a = accounts.get(String(b._id));
      return { ...view(b, counts), balanceCentavos: a.balanceCentavos, planStatus: a.plan?.status ?? null };
    }),
    total, page, pageSize: PAGE_SIZE,
  };
}

router.get('/', async (req, res) => {
  res.json(await listBatches({ status: req.query.status, page: req.query.page }));
});

// Farmer names are searched in the request body, never in the address.
router.post('/search', async (req, res) => {
  res.json(await listBatches(req.body));
});

// Numbers for the Inventory page and the intake form.
router.get('/summary', async (req, res) => {
  const [overview, receiving, overdue, coop] = await Promise.all([
    capacityOverview(),
    Batch.countDocuments({ status: 'receiving' }),
    Batch.countDocuments({ contractEnd: { $lt: new Date() }, status: { $in: ['stored', 'partly_released'] } }),
    Cooperative.findById(req.user.cooperativeId).select('settings').lean(),
  ]);
  res.json({
    ...overview,
    suggestedQuadrantId: suggestQuadrant(overview)?.id ?? null,
    receiving,
    overdue,
    intake: {
      contractMonths: coop.settings.contractMonths,
      sizeClasses: coop.settings.sizeClasses,
      grades: coop.settings.grades,
      storageFeeCentavos: coop.settings.fees.storageFeeCentavos,
      optionalFees: coop.settings.fees.added
        .filter((f) => f.active && f.appliesTo === 'optional')
        .map((f) => ({ id: f._id, name: f.name, amountCentavos: f.amountCentavos, chargedPer: f.chargedPer })),
    },
  });
});

router.post('/', async (req, res) => {
  const batch = await startIntake(req.body);
  res.status(201).json({ batch: { id: batch._id, batchNo: batch.batchNo } });
});

async function detail(id) {
  const batch = await Batch.findOne({ _id: id }).populate('memberId', 'firstName lastName memberNo farms').populate('receivedBy', 'name').lean();
  if (!batch) throw notFound('Delivery');
  const [counts, sacks, releases, gateOuts, accounts, transactions] = await Promise.all([
    sackCounts([batch._id]),
    Sack.find({ batchId: batch._id }).sort({ sackNo: -1 }).limit(2000)
      .populate('currentTagId', 'code').populate('quadrantId', 'code').lean(),
    CustodyEvent.aggregate([
      { $match: { batchId: batch._id, type: 'gate_out' } },
      { $group: { _id: '$releaseNo', sacks: { $sum: 1 }, at: { $max: '$occurredAt' }, staff: { $addToSet: '$performedByName' } } },
      { $sort: { at: -1 } },
    ]),
    // A released sack no longer has a tag; show the one it left with.
    CustodyEvent.find({ batchId: batch._id, type: 'gate_out' }).select('sackId tagId').populate('tagId', 'code').lean(),
    loadAccounts([batch]),
    Transaction.find({ batchId: batch._id }).sort({ paidAt: -1, _id: -1 })
      .populate('recordedBy', 'name').populate('batchId', 'batchNo').populate('memberId', 'firstName lastName').lean(),
  ]);
  const tagAtRelease = new Map(gateOuts.map((e) => [String(e.sackId), e.tagId]));
  return {
    batch: {
      ...view(batch, counts),
      receivedByName: batch.receivedBy?.name ?? '',
      feeTerms: batch.feeTerms,
      // The owner's farms in use, to choose where this delivery came from.
      ownerFarms: (batch.memberId?.farms ?? []).filter((f) => f.active !== false).map((f) => ({ id: f._id, name: f.name })),
    },
    account: accounts.get(String(batch._id)),
    transactions: transactions.map(transactionView),
    releases: releases.map((r) => ({ releaseNo: r._id, sacks: r.sacks, at: r.at, staff: r.staff })),
    sacks: sacks.map((s) => {
      const tag = s.currentTagId ?? tagAtRelease.get(String(s._id)) ?? null;
      return {
        id: s._id, sackNo: s.sackNo, status: s.status, gateInAt: s.gateInAt, gateOutAt: s.gateOutAt,
        tagId: tag?._id ?? null, tagCode: tag?.code ?? '', quadrantCode: s.quadrantId?.code ?? '',
      };
    }),
  };
}

router.get('/:id', async (req, res) => {
  res.json(await detail(req.params.id));
});

router.patch('/:id', async (req, res) => {
  await updateBatch(req.params.id, req.body);
  res.json(await detail(req.params.id));
});

router.post('/:id/finish-receiving', async (req, res) => {
  await finishReceiving(req.params.id, { acceptShortfall: req.body?.acceptShortfall === true });
  res.json(await detail(req.params.id));
});

// Installment plans are set up and cancelled by the Cooperative Admin.
router.post('/:id/payment-plan', requireRole(ROLES.COOP_ADMIN), async (req, res) => {
  const result = await createPlan(req.params.id, req.body);
  if (result.dryRun) return res.json(result);
  res.status(201).json(await detail(req.params.id));
});

router.post('/:id/payment-plan/cancel', requireRole(ROLES.COOP_ADMIN), async (req, res) => {
  await cancelPlan(req.params.id, req.body?.reason);
  res.json(await detail(req.params.id));
});

router.post('/:id/cancel', async (req, res) => {
  await cancelIntake(req.params.id);
  res.json(await detail(req.params.id));
});

export default router;

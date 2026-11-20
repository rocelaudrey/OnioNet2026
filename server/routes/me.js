import { Router } from 'express';
import { Sack } from '../models/Sack.js';
import { CustodyEvent } from '../models/CustodyEvent.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { assertFeature } from '../middleware/features.js';
import { statementFor } from '../services/statements.js';

// The farmer portal: read-only, and only the signed-in farmer's own records.
// The farmer comes from the session (memberId in the JWT), never from the
// request, and every query is also scoped to the cooperative.
const router = Router();

router.use(async (req, res, next) => {
  if (!req.user.memberId) throw new HttpError(403, 'This account is not linked to a farmer.');
  await assertFeature(req, 'farmer_portal');
  next();
});

const own = async (req) => {
  const statement = await statementFor(req.user.memberId, { forFarmer: true });
  if (!statement) throw notFound('Farmer');
  return statement;
};

const deliveryRow = (d) => ({
  id: d.id, batchNo: d.batchNo, status: d.status, receivedAt: d.receivedAt, contractEnd: d.contractEnd, variety: d.variety,
  farmName: d.farmName, condition: d.condition,
  sacksReceived: d.sacksReceived, sacksStored: d.sacksStored, overdue: d.overdue,
  totalCentavos: d.account.totalCentavos, balanceCentavos: d.account.balanceCentavos, planStatus: d.account.plan?.status ?? null,
});

router.get('/summary', async (req, res) => {
  const s = await own(req);
  const inStorage = s.deliveries.filter((d) => d.sacksStored > 0);
  const nextContractEnd = inStorage.map((d) => d.contractEnd).sort((a, b) => new Date(a) - new Date(b))[0] ?? null;
  const nextDue = s.deliveries
    .map((d) => d.account.plan?.next && { ...d.account.plan.next, batchNo: d.batchNo })
    .filter(Boolean)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0] ?? null;
  res.json({
    member: s.member,
    sacksStored: s.totals.sacksStored,
    deliveriesInStorage: inStorage.length,
    deliveries: s.deliveries.length,
    balanceCentavos: s.totals.balanceCentavos,
    overdueDeliveries: inStorage.filter((d) => d.overdue).length,
    nextContractEnd,
    nextInstallment: nextDue && { batchNo: nextDue.batchNo, dueDate: nextDue.dueDate, amountCentavos: nextDue.amountCentavos - nextDue.paidCentavos },
    lateInstallments: s.deliveries.filter((d) => d.account.plan?.status === 'late').length,
    recent: s.deliveries.slice(-5).reverse().map(deliveryRow),
  });
});

router.get('/batches', async (req, res) => {
  const s = await own(req);
  res.json({ deliveries: [...s.deliveries].reverse().map(deliveryRow) });
});

router.get('/batches/:id', async (req, res) => {
  const s = await own(req);
  const d = s.deliveries.find((x) => String(x.id) === req.params.id);
  if (!d) throw notFound('Delivery');
  const [sacks, releases] = await Promise.all([
    Sack.find({ batchId: d.id, memberId: req.user.memberId }).sort({ sackNo: 1 }).populate('quadrantId', 'code').lean(),
    CustodyEvent.aggregate([
      { $match: { batchId: d.id, type: 'gate_out' } },
      { $group: { _id: '$releaseNo', sacks: { $sum: 1 }, at: { $max: '$occurredAt' } } },
      { $sort: { at: -1 } },
    ]),
  ]);
  res.json({
    delivery: { ...deliveryRow(d), account: d.account, transactions: d.transactions },
    sacks: sacks.map((x) => ({
      sackNo: x.sackNo, status: x.status, quadrantCode: x.status === 'stored' ? x.quadrantId?.code ?? '' : '',
      gateInAt: x.gateInAt, gateOutAt: x.gateOutAt,
    })),
    releases: releases.map((r) => ({ releaseNo: r._id, sacks: r.sacks, at: r.at })),
  });
});

// Sacks in storage now, and where they are.
router.get('/sacks', async (req, res) => {
  const s = await own(req);
  const ids = s.deliveries.filter((d) => d.sacksStored > 0).map((d) => d.id);
  const byQuadrant = await Sack.find({ batchId: { $in: ids }, memberId: req.user.memberId, status: 'stored' })
    .select('quadrantId batchId').populate('quadrantId', 'code').lean();
  const map = new Map();
  for (const x of byQuadrant) {
    const code = x.quadrantId?.code ?? '';
    map.set(code, (map.get(code) ?? 0) + 1);
  }
  res.json({ total: byQuadrant.length, byQuadrant: [...map.entries()].sort().map(([code, count]) => ({ code, count })) });
});

// Charges and payments for every delivery: the farmer's own statement.
router.get('/ledger', async (req, res) => {
  res.json(await own(req));
});

export default router;

import { Router } from 'express';
import { Quadrant } from '../models/Quadrant.js';
import { Cooperative } from '../models/Cooperative.js';
import { Sack } from '../models/Sack.js';
import { ROLES } from '../lib/roles.js';
import { pick, diff } from '../lib/pick.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { recordAudit } from '../services/audit.js';

const router = Router();
const FIELDS = ['code', 'floor', 'capacity', 'fillOrder', 'active'];
const adminOnly = requireRole(ROLES.COOP_ADMIN);

// A layout may not hold more sacks than the cooperative's plan allows.
async function assertWithinPlan(cooperativeId, { exceptId, adding }) {
  const coop = await Cooperative.findById(cooperativeId).select('subscription.capacityLimit').lean();
  const limit = coop?.subscription?.capacityLimit ?? 0;
  const others = await Quadrant.find({ active: true, _id: { $ne: exceptId } }).select('capacity').lean();
  const total = others.reduce((sum, q) => sum + q.capacity, 0) + adding;
  if (total > limit) {
    throw new HttpError(400, `This layout holds ${total.toLocaleString('en-US')} sacks, but your plan allows ${limit.toLocaleString('en-US')}.`);
  }
}

// Sacks currently stored in each quadrant. Counted on read, never stored.
async function storedCounts() {
  const rows = await Sack.aggregate([
    { $match: { status: 'stored' } },
    { $group: { _id: '$quadrantId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
}

router.get('/', async (req, res) => {
  const [quadrants, counts, coop] = await Promise.all([
    Quadrant.find().sort('fillOrder').lean(),
    storedCounts(),
    Cooperative.findById(req.user.cooperativeId).select('subscription.capacityLimit').lean(),
  ]);
  res.json({
    capacityLimit: coop?.subscription?.capacityLimit ?? 0,
    quadrants: quadrants.map((q) => ({
      id: q._id, code: q.code, floor: q.floor, capacity: q.capacity,
      fillOrder: q.fillOrder, active: q.active, used: counts.get(String(q._id)) ?? 0,
    })),
  });
});

router.post('/', adminOnly, async (req, res) => {
  const data = pick(req.body, FIELDS);
  if (data.active !== false) {
    await assertWithinPlan(req.user.cooperativeId, { exceptId: null, adding: Number(data.capacity) || 0 });
  }
  const quadrant = await Quadrant.create(data);
  await recordAudit({ action: 'create', entityType: 'Quadrant', entityId: quadrant._id, entityLabel: quadrant.code });
  res.status(201).json({ quadrant });
});

router.patch('/:id', adminOnly, async (req, res) => {
  const before = await Quadrant.findOne({ _id: req.params.id }).lean();
  if (!before) throw notFound('Quadrant');
  const data = pick(req.body, FIELDS);
  const after = { ...before, ...data };
  const used = (await storedCounts()).get(String(before._id)) ?? 0;
  if (Number(after.capacity) < used) {
    throw new HttpError(400, `${before.code} holds ${used.toLocaleString('en-US')} sacks right now. Capacity cannot be lower than that.`);
  }
  if (!after.active && used > 0) {
    throw new HttpError(400, `${before.code} still holds ${used.toLocaleString('en-US')} sacks. Move or release them before turning it off.`);
  }
  if (after.active) {
    await assertWithinPlan(req.user.cooperativeId, { exceptId: before._id, adding: Number(after.capacity) || 0 });
  }
  const quadrant = await Quadrant.findOneAndUpdate(
    { _id: req.params.id }, { $set: data }, { returnDocument: 'after', runValidators: true },
  ).lean();
  await recordAudit({
    action: 'update', entityType: 'Quadrant', entityId: quadrant._id, entityLabel: quadrant.code,
    changes: diff(before, quadrant, FIELDS),
  });
  res.json({ quadrant });
});

export default router;

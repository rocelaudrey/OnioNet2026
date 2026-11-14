import { Router } from 'express';
import { Cooperative } from '../models/Cooperative.js';
import { ROLES } from '../lib/roles.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { pick } from '../lib/pick.js';
import { recordAudit } from '../services/audit.js';

// The signed-in user's own cooperative. The ID always comes from the session.
const router = Router();
const adminOnly = requireRole(ROLES.COOP_ADMIN);

async function loadOwn(req) {
  const coop = await Cooperative.findById(req.user.cooperativeId);
  if (!coop) throw notFound('Cooperative');
  return coop;
}

function feesView(coop) {
  const fees = coop.settings.fees;
  return {
    storageFeeCentavos: fees.storageFeeCentavos,
    overdueFeePerDayCentavos: fees.overdueFeePerDayCentavos,
    memberDiscountPercent: fees.memberDiscountPercent,
    added: fees.added.map((f) => ({
      id: f._id, name: f.name, amountCentavos: f.amountCentavos,
      chargedPer: f.chargedPer, appliesTo: f.appliesTo, active: f.active,
    })),
  };
}

function view(coop) {
  return {
    name: coop.name,
    facilityName: coop.facilityName ?? '',
    address: coop.address ?? '',
    contact: {
      personName: coop.contact?.personName ?? '',
      phone: coop.contact?.phone ?? '',
      email: coop.contact?.email ?? '',
    },
    displayName: coop.branding?.displayName ?? '',
    tagPrefix: coop.settings.tagPrefix,
    contractMonths: coop.settings.contractMonths,
    sizeClasses: coop.settings.sizeClasses,
    grades: coop.settings.grades,
    fees: feesView(coop),
    subscription: {
      plan: coop.subscription.plan,
      status: coop.subscription.status,
      endsAt: coop.subscription.endsAt,
      capacityLimit: coop.subscription.capacityLimit,
      enabledFeatures: coop.subscription.enabledFeatures,
    },
  };
}

// Applies { path: value } pairs and returns [{ field, from, to }] for the audit log.
function applyChanges(coop, updates) {
  const changes = [];
  for (const [path, to] of Object.entries(updates)) {
    const current = coop.get(path);
    const from = current?.toObject ? current.toObject() : current ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes.push({ field: path.replace(/^settings\.(fees\.)?/, ''), from, to });
      coop.set(path, to);
    }
  }
  return changes;
}

const cleanList = (value) => {
  if (!Array.isArray(value)) throw new HttpError(400, 'Please enter a list.');
  return [...new Set(value.map((v) => String(v).trim()).filter(Boolean))].slice(0, 30);
};

router.get('/', async (req, res) => {
  res.json({ cooperative: view(await loadOwn(req)) });
});

// Profile and intake options. The cooperative name, tag prefix, and plan are
// managed by OnioNet, not here.
router.patch('/', adminOnly, async (req, res) => {
  const coop = await loadOwn(req);
  const body = req.body ?? {};
  const updates = {};
  for (const field of ['facilityName', 'address']) {
    if (typeof body[field] === 'string') updates[field] = body[field].trim();
  }
  for (const field of ['personName', 'phone', 'email']) {
    if (typeof body.contact?.[field] === 'string') updates[`contact.${field}`] = body.contact[field].trim();
  }
  if (typeof body.displayName === 'string') updates['branding.displayName'] = body.displayName.trim();
  if (body.contractMonths !== undefined) {
    const months = Number(body.contractMonths);
    if (!Number.isInteger(months) || months < 1 || months > 24) {
      throw new HttpError(400, 'Contract length must be a whole number of months from 1 to 24.');
    }
    updates['settings.contractMonths'] = months;
  }
  if (body.sizeClasses !== undefined) updates['settings.sizeClasses'] = cleanList(body.sizeClasses);
  if (body.grades !== undefined) updates['settings.grades'] = cleanList(body.grades);

  const changes = applyChanges(coop, updates);
  if (changes.length) {
    await coop.save();
    await recordAudit({ action: 'update', entityType: 'Cooperative', entityId: coop._id, entityLabel: 'Cooperative profile', changes });
  }
  res.json({ cooperative: view(coop) });
});

// ----- Fees (Settings > Fees) -----

function centavos(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 100_000_000) {
    throw new HttpError(400, `${label} must be an amount of ₱0.00 or more.`);
  }
  return value;
}

router.get('/fees', async (req, res) => {
  res.json({ fees: feesView(await loadOwn(req)) });
});

// The two built-in fees and the member discount. They can be edited, never removed.
router.patch('/fees', adminOnly, async (req, res) => {
  const coop = await loadOwn(req);
  const body = req.body ?? {};
  const updates = {};
  if (body.storageFeeCentavos !== undefined) {
    updates['settings.fees.storageFeeCentavos'] = centavos(body.storageFeeCentavos, 'Storage fee');
  }
  if (body.overdueFeePerDayCentavos !== undefined) {
    updates['settings.fees.overdueFeePerDayCentavos'] = centavos(body.overdueFeePerDayCentavos, 'Overdue fee');
  }
  if (body.memberDiscountPercent !== undefined) {
    const percent = Number(body.memberDiscountPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new HttpError(400, 'Member discount must be from 0 to 100 percent.');
    }
    updates['settings.fees.memberDiscountPercent'] = Math.round(percent * 100) / 100;
  }
  const changes = applyChanges(coop, updates);
  if (changes.length) {
    await coop.save();
    await recordAudit({ action: 'update', entityType: 'Fees', entityId: coop._id, entityLabel: 'Built-in fees', changes });
  }
  res.json({ fees: feesView(coop) });
});

const ADDED_FIELDS = ['name', 'amountCentavos', 'chargedPer', 'appliesTo', 'active'];

router.post('/fees/added', adminOnly, async (req, res) => {
  const coop = await loadOwn(req);
  const data = pick(req.body, ['name', 'amountCentavos', 'chargedPer', 'appliesTo']);
  centavos(data.amountCentavos, 'Amount');
  coop.settings.fees.added.push(data);
  const fee = coop.settings.fees.added.at(-1);
  await coop.save();
  await recordAudit({
    action: 'create', entityType: 'Fee', entityId: fee._id, entityLabel: fee.name,
    changes: [{ field: 'amountCentavos', from: null, to: fee.amountCentavos }],
  });
  res.status(201).json({ fees: feesView(coop) });
});

// Added fees are turned off, not deleted, so history stays readable.
router.patch('/fees/added/:feeId', adminOnly, async (req, res) => {
  const coop = await loadOwn(req);
  const fee = coop.settings.fees.added.id(req.params.feeId);
  if (!fee) throw notFound('Fee');
  const data = pick(req.body, ADDED_FIELDS);
  if (data.amountCentavos !== undefined) centavos(data.amountCentavos, 'Amount');
  const changes = [];
  for (const [field, to] of Object.entries(data)) {
    if (fee[field] !== to) {
      changes.push({ field, from: fee[field], to });
      fee[field] = to;
    }
  }
  if (changes.length) {
    await coop.save();
    await recordAudit({ action: 'update', entityType: 'Fee', entityId: fee._id, entityLabel: fee.name, changes });
  }
  res.json({ fees: feesView(coop) });
});

export default router;

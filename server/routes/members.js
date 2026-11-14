import { Router } from 'express';
import { Member } from '../models/Member.js';
import { Cooperative } from '../models/Cooperative.js';
import { pick, diff } from '../lib/pick.js';
import { notFound } from '../middleware/errors.js';
import { recordAudit } from '../services/audit.js';
import { nextNumber } from '../services/sequences.js';

const router = Router();
const FIELDS = [
  'tier', 'firstName', 'lastName', 'phone', 'address', 'birthDate',
  'farmAreaHa', 'rsbsaNo', 'status', 'joinedAt', 'notes',
];
const label = (m) => `${m.firstName} ${m.lastName}`.trim();

router.get('/', async (req, res) => {
  const members = await Member.find().sort({ lastName: 1, firstName: 1 }).limit(500).lean();
  res.json({ members });
});

router.post('/', async (req, res) => {
  const data = pick(req.body, FIELDS);
  // Check the details before taking a number, so a rejected form does not skip one.
  await new Member({ ...data, memberNo: 'pending' }).validate();
  const coop = await Cooperative.findById(req.user.cooperativeId).select('settings.tagPrefix').lean();
  const number = await nextNumber('member');
  const memberNo = `${coop.settings.tagPrefix}-M-${String(number).padStart(4, '0')}`;
  const member = await Member.create({ ...data, memberNo });
  await recordAudit({ action: 'create', entityType: 'Member', entityId: member._id, entityLabel: label(member) });
  res.status(201).json({ member });
});

router.get('/:id', async (req, res) => {
  const member = await Member.findOne({ _id: req.params.id }).lean();
  if (!member) throw notFound('Farmer');
  res.json({ member });
});

router.patch('/:id', async (req, res) => {
  const before = await Member.findOne({ _id: req.params.id }).lean();
  if (!before) throw notFound('Farmer');
  const member = await Member.findOneAndUpdate(
    { _id: req.params.id },
    { $set: pick(req.body, FIELDS) },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  await recordAudit({
    action: 'update', entityType: 'Member', entityId: member._id, entityLabel: label(member),
    changes: diff(before, member, FIELDS),
  });
  res.json({ member });
});

export default router;

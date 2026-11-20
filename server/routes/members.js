import { Router } from 'express';
import { Member } from '../models/Member.js';
import { User } from '../models/User.js';
import { Batch } from '../models/Batch.js';
import { Sack } from '../models/Sack.js';
import { Cooperative } from '../models/Cooperative.js';
import { ROLES } from '../lib/roles.js';
import { MEMBER_STATUSES, MEMBER_TIERS } from '../../shared/statuses.js';
import { pick, diff } from '../lib/pick.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { assertFeature } from '../middleware/features.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { recordAudit } from '../services/audit.js';
import { addressLine, resolveAddress } from '../lib/address.js';
import { loadAccounts } from '../services/fees.js';
import { nextNumber } from '../services/sequences.js';

const router = Router();
const FIELDS = [
  'tier', 'firstName', 'lastName', 'phone', 'address', 'birthDate',
  'farmAreaHa', 'rsbsaNo', 'status', 'joinedAt', 'notes',
];
const AUDIT_FIELDS = [
  'tier', 'firstName', 'lastName', 'phone', 'address.street', 'address.barangay', 'address.municipality',
  'address.province', 'address.region', 'birthDate', 'farmAreaHa', 'rsbsaNo', 'status', 'joinedAt', 'notes',
];
const PAGE_SIZE = 50;
const fullName = (m) => `${m.firstName} ${m.lastName}`.trim();

const placeView = (a) => ({
  country: a?.country ?? '',
  region: a?.region ?? '', regionCode: a?.regionCode ?? '',
  province: a?.province ?? '', provinceCode: a?.provinceCode ?? '',
  municipality: a?.municipality ?? '', municipalityCode: a?.municipalityCode ?? '',
  barangay: a?.barangay ?? '', barangayCode: a?.barangayCode ?? '',
  street: a?.street ?? '',
});

export const farmView = (f) => ({
  id: f._id, name: f.name, location: placeView(f.location), locationLine: addressLine(f.location),
  areaHa: f.areaHa ?? null, notes: f.notes ?? '', active: f.active !== false,
});

const view = (m) => ({
  id: m._id,
  memberNo: m.memberNo,
  tier: m.tier,
  firstName: m.firstName,
  lastName: m.lastName,
  fullName: fullName(m),
  phone: m.phone ?? '',
  address: {
    country: m.address?.country ?? '',
    region: m.address?.region ?? '', regionCode: m.address?.regionCode ?? '',
    province: m.address?.province ?? '', provinceCode: m.address?.provinceCode ?? '',
    municipality: m.address?.municipality ?? '', municipalityCode: m.address?.municipalityCode ?? '',
    barangay: m.address?.barangay ?? '', barangayCode: m.address?.barangayCode ?? '',
    street: m.address?.street ?? '',
  },
  addressLine: addressLine(m.address),
  birthDate: m.birthDate ?? null,
  farmAreaHa: m.farmAreaHa ?? null,
  farms: (m.farms ?? []).map(farmView),
  rsbsaNo: m.rsbsaNo ?? '',
  status: m.status,
  joinedAt: m.joinedAt ?? null,
  notes: m.notes ?? '',
});

// Flattens the audited fields so nested address changes are recorded by name.
const flat = (m) => ({
  ...m,
  'address.barangay': m.address?.barangay ?? null,
  'address.municipality': m.address?.municipality ?? null,
  'address.province': m.address?.province ?? null,
  'address.region': m.address?.region ?? null,
  'address.street': m.address?.street ?? null,
});

function clean(body) {
  const data = pick(body, FIELDS);
  for (const field of ['firstName', 'lastName', 'phone', 'rsbsaNo', 'notes']) {
    if (typeof data[field] === 'string') data[field] = data[field].trim();
  }
  // The address is chosen from the official list: only codes come in, and the
  // names are looked up here.
  if (data.address !== undefined) {
    try {
      data.address = resolveAddress(data.address);
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  }
  for (const field of ['birthDate', 'joinedAt']) {
    if (data[field] === '' || data[field] === null) data[field] = null;
    else if (data[field] !== undefined) {
      const value = new Date(data[field]);
      if (Number.isNaN(value.getTime())) throw new HttpError(400, 'Please enter a valid date.');
      if (value > new Date()) throw new HttpError(400, 'Dates cannot be in the future.');
      data[field] = value;
    }
  }
  if (data.farmAreaHa === '' || data.farmAreaHa === null) data.farmAreaHa = null;
  else if (data.farmAreaHa !== undefined) {
    const area = Number(data.farmAreaHa);
    if (!Number.isFinite(area) || area < 0) throw new HttpError(400, 'Farm area must be 0 or more hectares.');
    data.farmAreaHa = area;
  }
  return data;
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Builds a filter from the search form. Every word typed must match the
// first name, last name, or member number.
function searchFilter(body = {}) {
  const filter = {};
  if (MEMBER_TIERS.includes(body.tier)) filter.tier = body.tier;
  if (MEMBER_STATUSES.includes(body.status)) filter.status = body.status;
  const words = String(body.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (words.length) {
    filter.$and = words.map((word) => {
      const rx = new RegExp(escapeRegex(word), 'i');
      return { $or: [{ firstName: rx }, { lastName: rx }, { memberNo: rx }] };
    });
  }
  return filter;
}

async function listMembers(body) {
  const filter = searchFilter(body);
  const page = Math.max(1, Number.parseInt(body?.page, 10) || 1);
  const [members, total] = await Promise.all([
    Member.find(filter).sort({ lastName: 1, firstName: 1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Member.countDocuments(filter),
  ]);
  return { members: members.map(view), total, page, pageSize: PAGE_SIZE };
}

async function totals() {
  const rows = await Member.aggregate([{ $group: { _id: { tier: '$tier', status: '$status' }, count: { $sum: 1 } } }]);
  const out = { all: 0, members: 0, guests: 0, traders: 0, inactive: 0 };
  for (const { _id, count } of rows) {
    out.all += count;
    if (_id.status === 'inactive') out.inactive += count;
    else if (_id.tier === 'guest') out.guests += count;
    else if (_id.tier === 'trader') out.traders += count;
    else out.members += count;
  }
  return out;
}

router.get('/', async (req, res) => {
  res.json({ ...(await listMembers({})), totals: await totals() });
});

// Search text travels in the request body, never in the address (RA 10173).
router.post('/search', async (req, res) => {
  res.json({ ...(await listMembers(req.body)), totals: await totals() });
});

router.post('/', async (req, res) => {
  const data = clean(req.body);
  // Check the details before taking a number, so a rejected form does not skip one.
  await new Member({ ...data, memberNo: 'pending' }).validate();
  const coop = await Cooperative.findById(req.user.cooperativeId).select('settings.tagPrefix').lean();
  const number = await nextNumber('member');
  const memberNo = `${coop.settings.tagPrefix}-M-${String(number).padStart(4, '0')}`;
  const member = await Member.create({ ...data, memberNo });
  await recordAudit({ action: 'create', entityType: 'Member', entityId: member._id, entityLabel: fullName(member) });
  res.status(201).json({ member: view(member) });
});

// ----- One farmer -----

const portalView = (user) => (user
  ? {
    hasLogin: true, active: user.active, phone: user.phone ?? '', email: user.email ?? '',
    mustChangePassword: user.mustChangePassword, lastLoginAt: user.lastLoginAt,
  }
  : { hasLogin: false });

const portalUser = (memberId) => User.findOne({ memberId, role: ROLES.MEMBER });

router.get('/:id', async (req, res) => {
  const member = await Member.findOne({ _id: req.params.id }).lean();
  if (!member) throw notFound('Farmer');
  const [user, deliveries, sacksStored] = await Promise.all([
    portalUser(member._id).lean(),
    Batch.find({ memberId: member._id, status: { $ne: 'cancelled' } }).sort({ receivedAt: -1 }).lean(),
    Sack.countDocuments({ memberId: member._id, status: 'stored' }),
  ]);
  const accounts = await loadAccounts(deliveries);
  const stored = await Sack.aggregate([
    { $match: { memberId: member._id, status: 'stored' } },
    { $group: { _id: '$batchId', count: { $sum: 1 } } },
  ]);
  const storedBy = new Map(stored.map((r) => [String(r._id), r.count]));
  const rows = deliveries.map((b) => {
    const a = accounts.get(String(b._id));
    return {
      id: b._id, batchNo: b.batchNo, status: b.status, receivedAt: b.receivedAt, contractEnd: b.contractEnd,
      sacksStored: storedBy.get(String(b._id)) ?? 0,
      totalCentavos: a.totalCentavos, paidCentavos: a.paidCentavos + a.adjustedCentavos - a.refundedCentavos, balanceCentavos: a.balanceCentavos,
      planStatus: a.plan?.status ?? null,
    };
  });
  const sum = (key) => rows.reduce((total, r) => total + r[key], 0);
  res.json({
    member: view(member),
    portal: portalView(user),
    storage: { batches: deliveries.length, sacksStored },
    deliveries: rows,
    account: { totalCentavos: sum('totalCentavos'), paidCentavos: sum('paidCentavos'), balanceCentavos: sum('balanceCentavos') },
  });
});

router.patch('/:id', async (req, res) => {
  const before = await Member.findOne({ _id: req.params.id }).lean();
  if (!before) throw notFound('Farmer');
  const member = await Member.findOneAndUpdate(
    { _id: req.params.id },
    { $set: clean(req.body) },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  const changes = diff(flat(before), flat(member), AUDIT_FIELDS);
  if (changes.length) {
    await recordAudit({ action: 'update', entityType: 'Member', entityId: member._id, entityLabel: fullName(member), changes });
  }
  // An inactive farmer cannot keep signing in.
  if (before.status !== 'inactive' && member.status === 'inactive') {
    const user = await portalUser(member._id);
    if (user?.active) {
      user.active = false;
      await user.save();
      await recordAudit({
        action: 'update', entityType: 'User', entityId: user._id, entityLabel: `${fullName(member)} (farmer login)`,
        changes: [{ field: 'active', from: true, to: false }],
      });
    }
  }
  res.json({ member: view(member) });
});

// ----- Farms -----

const FARM_AUDIT = ['name', 'location', 'areaHa', 'notes', 'active'];

function cleanFarm(body = {}, { creating = false } = {}) {
  const data = pick(body, ['name', 'location', 'areaHa', 'notes', 'active']);
  if (data.name !== undefined || creating) {
    data.name = String(data.name ?? '').trim();
    if (!data.name) throw new HttpError(400, 'Give the farm a name, such as "Riverside lot".');
    if (data.name.length > 80) throw new HttpError(400, 'The farm name is too long.');
  }
  if (data.notes !== undefined) data.notes = String(data.notes ?? '').trim().slice(0, 300);
  if (data.location !== undefined) {
    try {
      data.location = resolveAddress(data.location);
    } catch (err) {
      throw new HttpError(400, err.message);
    }
    if (!data.location.municipalityCode) throw new HttpError(400, 'Choose at least the city or municipality where the farm is.');
  } else if (creating) {
    throw new HttpError(400, 'Choose where the farm is.');
  }
  if (data.areaHa === '' || data.areaHa === null) data.areaHa = null;
  else if (data.areaHa !== undefined) {
    const area = Number(data.areaHa);
    if (!Number.isFinite(area) || area < 0) throw new HttpError(400, 'Farm area must be 0 or more hectares.');
    data.areaHa = area;
  }
  if (data.active !== undefined) data.active = data.active !== false;
  return data;
}

const farmAudit = (f) => ({ ...f, location: addressLine(f.location) || null });

router.post('/:id/farms', async (req, res) => {
  const member = await Member.findOne({ _id: req.params.id });
  if (!member) throw notFound('Farmer');
  if (member.farms.length >= 50) throw new HttpError(400, 'A farmer can have up to 50 farms.');
  member.farms.push(cleanFarm(req.body, { creating: true }));
  await member.save();
  const farm = member.farms.at(-1);
  await recordAudit({ action: 'create', entityType: 'Farm', entityId: farm._id, entityLabel: `${farm.name} (${fullName(member)})` });
  res.status(201).json({ member: view(member.toObject()) });
});

router.patch('/:id/farms/:farmId', async (req, res) => {
  const member = await Member.findOne({ _id: req.params.id });
  if (!member) throw notFound('Farmer');
  const farm = member.farms.id(req.params.farmId);
  if (!farm) throw notFound('Farm');
  const before = farmAudit(farm.toObject());
  farm.set(cleanFarm(req.body));
  const changes = diff(before, farmAudit(farm.toObject()), FARM_AUDIT);
  if (changes.length) {
    await member.save();
    await recordAudit({ action: 'update', entityType: 'Farm', entityId: farm._id, entityLabel: `${farm.name} (${fullName(member)})`, changes });
  }
  res.json({ member: view(member.toObject()) });
});

// Farmer login: enable (creates it the first time), disable, or reset the password.
router.post('/:id/portal-access', async (req, res) => {
  await assertFeature(req, 'farmer_portal');
  const member = await Member.findOne({ _id: req.params.id }).lean();
  if (!member) throw notFound('Farmer');
  const action = req.body?.action;
  const label = `${fullName(member)} (farmer login)`;
  let user = await portalUser(member._id);
  let password;

  if (action === 'enable') {
    if (member.status !== 'active') throw new HttpError(400, 'This farmer is inactive. Make them active first.');
    const phone = String(req.body?.phone ?? user?.phone ?? member.phone ?? '').trim() || undefined;
    const email = String(req.body?.email ?? user?.email ?? '').trim().toLowerCase() || undefined;
    if (!phone && !email) throw new HttpError(400, 'Enter a mobile number or email for the farmer to sign in with.');
    try {
      if (user) {
        const changes = diff(user.toObject(), { active: true, phone, email }, ['active', 'phone', 'email']);
        user.set({ active: true, phone, email });
        await user.save();
        if (changes.length) await recordAudit({ action: 'update', entityType: 'User', entityId: user._id, entityLabel: label, changes });
      } else {
        password = temporaryPassword();
        user = await User.create({
          name: fullName(member), phone, email, role: ROLES.MEMBER, memberId: member._id,
          passwordHash: await hashPassword(password), mustChangePassword: true,
        });
        await recordAudit({ action: 'create', entityType: 'User', entityId: user._id, entityLabel: label });
      }
    } catch (err) {
      if (err?.code === 11000) throw new HttpError(409, 'Another account already uses that mobile number or email.');
      throw err;
    }
  } else if (action === 'disable') {
    if (!user) throw new HttpError(400, 'This farmer has no login.');
    if (user.active) {
      user.active = false;
      await user.save();
      await recordAudit({ action: 'update', entityType: 'User', entityId: user._id, entityLabel: label, changes: [{ field: 'active', from: true, to: false }] });
    }
  } else if (action === 'reset') {
    if (!user?.active) throw new HttpError(400, 'This farmer has no active login.');
    password = temporaryPassword();
    user.passwordHash = await hashPassword(password);
    user.mustChangePassword = true;
    await user.save();
    await recordAudit({ action: 'password_reset', entityType: 'User', entityId: user._id, entityLabel: label });
  } else {
    throw new HttpError(400, 'Unknown action.');
  }

  // The temporary password is shown once and never stored or logged.
  res.json({ portal: portalView(user), ...(password ? { temporaryPassword: password } : {}) });
});

export default router;

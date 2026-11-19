import { AuditLog } from '../models/AuditLog.js';
import { Batch } from '../models/Batch.js';
import { Cooperative } from '../models/Cooperative.js';
import { CustodyEvent } from '../models/CustodyEvent.js';
import { Member } from '../models/Member.js';
import { Quadrant } from '../models/Quadrant.js';
import { Sack } from '../models/Sack.js';
import { User } from '../models/User.js';
import { getContext } from '../context.js';
import { ROLES } from '../lib/roles.js';
import { DAY_MS } from '../lib/dates.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { FEATURES, SUBSCRIPTION_STATUSES } from '../../shared/statuses.js';
import { inTransaction } from './tx.js';

// Super Admin work across cooperatives. Every function here must run inside
// crossTenant() (see routes/admin.js). Nothing here returns farmer details:
// only counts.

const ENDING_SOON_DAYS = 30;
const text = (v) => (typeof v === 'string' ? v.trim() : undefined);

// One audit entry in the platform log, and a copy in the cooperative's own
// log so its admins can see what OnioNet changed.
export async function auditBoth(cooperativeId, entry, { session } = {}) {
  const ctx = getContext();
  const base = { actorId: ctx.userId, actorName: ctx.userName, actorRole: ctx.role, ...entry };
  await AuditLog.create([{ ...base, cooperativeId: null }, { ...base, cooperativeId }], { session, ordered: true });
}

const groupCount = async (Model, match, key = '$cooperativeId') => {
  const rows = await Model.aggregate([{ $match: match }, { $group: { _id: key, count: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
};

function subscriptionView(sub, now = new Date()) {
  const endsAt = sub?.endsAt ? new Date(sub.endsAt) : null;
  const daysLeft = endsAt ? Math.ceil((endsAt - now) / DAY_MS) : null;
  return {
    plan: sub?.plan ?? '', status: sub?.status ?? 'trial', startedAt: sub?.startedAt ?? null, endsAt,
    capacityLimit: sub?.capacityLimit ?? 0, enabledFeatures: sub?.enabledFeatures ?? [], notes: sub?.notes ?? '',
    daysLeft,
    endingSoon: daysLeft !== null && daysLeft >= 0 && daysLeft <= ENDING_SOON_DAYS,
    ended: daysLeft !== null && daysLeft < 0,
  };
}

// Every cooperative with its size and use. Counts only, never farmer details.
export async function cooperativeRows() {
  const now = new Date();
  const [coops, layout, stored, farmers, team, lastActivity] = await Promise.all([
    Cooperative.find().sort('name').lean(),
    Quadrant.aggregate([{ $match: { active: true } }, { $group: { _id: '$cooperativeId', capacity: { $sum: '$capacity' }, quadrants: { $sum: 1 } } }]),
    groupCount(Sack, { status: 'stored' }),
    groupCount(Member, { status: 'active' }),
    groupCount(User, { role: { $in: [ROLES.COOP_ADMIN, ROLES.COOP_STAFF] }, active: true }),
    CustodyEvent.aggregate([{ $group: { _id: '$cooperativeId', at: { $max: '$occurredAt' } } }]),
  ]);
  const layoutBy = new Map(layout.map((r) => [String(r._id), r]));
  const lastBy = new Map(lastActivity.map((r) => [String(r._id), r.at]));
  return coops.map((c) => {
    const id = String(c._id);
    const capacity = layoutBy.get(id)?.capacity ?? 0;
    const sacks = stored.get(id) ?? 0;
    return {
      id: c._id, name: c.name, facilityName: c.facilityName ?? '', address: c.address ?? '', status: c.status,
      tagPrefix: c.settings.tagPrefix, createdAt: c.createdAt,
      subscription: subscriptionView(c.subscription, now),
      capacity, quadrants: layoutBy.get(id)?.quadrants ?? 0, sacksStored: sacks,
      percentUsed: capacity ? Math.round((sacks / capacity) * 1000) / 10 : 0,
      activeFarmers: farmers.get(id) ?? 0, activeTeam: team.get(id) ?? 0,
      lastActivityAt: lastBy.get(id) ?? null,
    };
  });
}

export async function overview() {
  const [rows, deliveries, recent] = await Promise.all([
    cooperativeRows(),
    Batch.countDocuments({ status: { $in: ['stored', 'partly_released'] } }),
    AuditLog.find({ cooperativeId: null }).sort({ occurredAt: -1 }).limit(10).lean(),
  ]);
  const active = rows.filter((r) => r.status === 'active');
  const sum = (key) => active.reduce((s, r) => s + r[key], 0);
  const capacity = sum('capacity');
  const stored = sum('sacksStored');
  return {
    totals: {
      cooperatives: rows.length, active: active.length, suspended: rows.length - active.length,
      capacity, sacksStored: stored, percentUsed: capacity ? Math.round((stored / capacity) * 1000) / 10 : 0,
      deliveriesInStorage: deliveries, activeFarmers: sum('activeFarmers'),
      endingSoon: rows.filter((r) => r.subscription.endingSoon).length,
      ended: rows.filter((r) => r.subscription.ended && r.subscription.status !== 'canceled').length,
    },
    cooperatives: rows,
    endingSoon: rows.filter((r) => r.subscription.endingSoon || (r.subscription.ended && r.subscription.status !== 'canceled'))
      .sort((a, b) => new Date(a.subscription.endsAt) - new Date(b.subscription.endsAt)),
    activity: recent.map((a) => ({
      id: a._id, occurredAt: a.occurredAt, actorName: a.actorName, action: a.action, entityType: a.entityType,
      entityLabel: a.entityLabel ?? '', changes: a.changes ?? [],
    })),
  };
}

// ----- Validation -----

function readSubscription(body = {}, { partial = false } = {}) {
  const out = {};
  if (body.plan !== undefined || !partial) {
    out.plan = text(body.plan) || 'trial';
  }
  if (body.status !== undefined || !partial) {
    const status = body.status ?? 'trial';
    if (!SUBSCRIPTION_STATUSES.includes(status)) throw new HttpError(400, 'Choose a valid subscription status.');
    out.status = status;
  }
  for (const field of ['startedAt', 'endsAt']) {
    if (body[field] === undefined) continue;
    if (body[field] === null || body[field] === '') { out[field] = null; continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body[field]))) throw new HttpError(400, 'Enter a valid date.');
    out[field] = new Date(`${body[field]}T12:00:00`);
  }
  if (out.startedAt && out.endsAt && out.endsAt < out.startedAt) throw new HttpError(400, 'The end date must be after the start date.');
  if (body.capacityLimit !== undefined || !partial) {
    const limit = Number(body.capacityLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000_000) throw new HttpError(400, 'Enter the most sacks the plan allows.');
    out.capacityLimit = limit;
  }
  if (body.enabledFeatures !== undefined || !partial) {
    const features = body.enabledFeatures ?? [];
    if (!Array.isArray(features) || features.some((f) => !FEATURES.includes(f))) throw new HttpError(400, 'Unknown feature.');
    out.enabledFeatures = [...new Set(features)];
  }
  if (body.notes !== undefined) out.notes = text(body.notes) ?? '';
  return out;
}

// Quadrants named 1-A, 1-B, ... 2-A, filled floor by floor.
export function makeLayout({ floors, perFloor, capacityEach }) {
  const f = Number(floors);
  const p = Number(perFloor);
  const cap = Number(capacityEach);
  if (!Number.isInteger(f) || f < 1 || f > 10) throw new HttpError(400, 'Floors must be from 1 to 10.');
  if (!Number.isInteger(p) || p < 1 || p > 26) throw new HttpError(400, 'Quadrants per floor must be from 1 to 26.');
  if (!Number.isInteger(cap) || cap < 1 || cap > 100_000) throw new HttpError(400, 'Enter how many sacks each quadrant holds.');
  const out = [];
  for (let floor = 1; floor <= f; floor += 1) {
    for (let i = 0; i < p; i += 1) out.push({ code: `${floor}-${String.fromCharCode(65 + i)}`, floor, capacity: cap, fillOrder: out.length + 1 });
  }
  return out;
}

function readAdmin(body = {}) {
  const name = text(body.name);
  const email = text(body.email)?.toLowerCase() || undefined;
  const phone = text(body.phone) || undefined;
  if (!name) throw new HttpError(400, "Enter the cooperative admin's name.");
  if (!email && !phone) throw new HttpError(400, "Enter the cooperative admin's email or mobile number.");
  return { name, email, phone };
}

const duplicate = (err) => {
  if (err?.code !== 11000) return err;
  const key = Object.keys(err.keyPattern ?? {}).join(',');
  if (key.includes('tagPrefix')) return new HttpError(409, 'Another cooperative already uses that tag prefix.');
  return new HttpError(409, 'Another account already uses that email or mobile number.');
};

async function createAdmin(cooperativeId, data, session) {
  const password = temporaryPassword();
  const [user] = await User.create([{
    ...data, cooperativeId, role: ROLES.COOP_ADMIN, passwordHash: await hashPassword(password), mustChangePassword: true,
  }], { session });
  return { user, password };
}

// ----- Onboarding -----

export async function onboard(body = {}) {
  const name = text(body.name);
  if (!name) throw new HttpError(400, 'Enter the cooperative name.');
  const tagPrefix = text(body.tagPrefix)?.toUpperCase() ?? '';
  if (!/^[A-Z0-9]{2,6}$/.test(tagPrefix)) throw new HttpError(400, 'The tag prefix must be 2 to 6 letters or numbers, for example FAF.');
  const contractMonths = Number(body.contractMonths ?? 3);
  if (!Number.isInteger(contractMonths) || contractMonths < 1 || contractMonths > 24) throw new HttpError(400, 'Contract length must be from 1 to 24 months.');
  const subscription = readSubscription(body.subscription);
  const quadrants = body.layout ? makeLayout(body.layout) : [];
  const total = quadrants.reduce((s, q) => s + q.capacity, 0);
  if (total > subscription.capacityLimit) {
    throw new HttpError(400, `This layout holds ${total.toLocaleString('en-US')} sacks, but the plan allows ${subscription.capacityLimit.toLocaleString('en-US')}.`);
  }
  const admin = readAdmin(body.admin);

  try {
    return await inTransaction(async (session) => {
      const [coop] = await Cooperative.create([{
        name, facilityName: text(body.facilityName), address: text(body.address),
        contact: { personName: text(body.contact?.personName), phone: text(body.contact?.phone), email: text(body.contact?.email)?.toLowerCase() },
        status: 'active',
        settings: { tagPrefix, contractMonths },
        subscription,
      }], { session });
      if (quadrants.length) await Quadrant.insertMany(quadrants.map((q) => ({ ...q, cooperativeId: coop._id })), { session });
      const { user, password } = await createAdmin(coop._id, admin, session);
      await auditBoth(coop._id, {
        action: 'create', entityType: 'Cooperative', entityId: coop._id, entityLabel: name,
        changes: [
          { field: 'plan', from: null, to: `${subscription.plan}, up to ${subscription.capacityLimit.toLocaleString('en-US')} sacks` },
          { field: 'layout', from: null, to: quadrants.length ? `${quadrants.length} quadrants, ${total.toLocaleString('en-US')} sacks` : 'none yet' },
          { field: 'cooperativeAdmin', from: null, to: user.name },
        ],
      }, { session });
      return { cooperative: coop, admin: user, temporaryPassword: password };
    });
  } catch (err) {
    throw duplicate(err);
  }
}

// ----- One cooperative -----

export async function cooperativeDetail(id) {
  const coop = await Cooperative.findById(id).lean();
  if (!coop) throw notFound('Cooperative');
  const row = (await cooperativeRows()).find((r) => String(r.id) === String(coop._id));
  const admins = await User.find({ cooperativeId: coop._id, role: ROLES.COOP_ADMIN }).sort({ active: -1, name: 1 }).lean();
  return {
    cooperative: {
      ...row,
      contact: { personName: coop.contact?.personName ?? '', phone: coop.contact?.phone ?? '', email: coop.contact?.email ?? '' },
      contractMonths: coop.settings.contractMonths,
    },
    admins: admins.map((u) => ({
      id: u._id, name: u.name, email: u.email ?? '', phone: u.phone ?? '', active: u.active,
      mustChangePassword: u.mustChangePassword, lastLoginAt: u.lastLoginAt,
    })),
  };
}

export async function updateCooperative(id, body = {}) {
  const coop = await Cooperative.findById(id);
  if (!coop) throw notFound('Cooperative');
  const changes = [];
  const set = (path, to, field = path) => {
    const from = coop.get(path) ?? null;
    if ((from ?? '') !== (to ?? '')) { changes.push({ field, from, to }); coop.set(path, to); }
  };
  if (body.name !== undefined) {
    const name = text(body.name);
    if (!name) throw new HttpError(400, 'Enter the cooperative name.');
    set('name', name);
  }
  for (const f of ['facilityName', 'address']) if (body[f] !== undefined) set(f, text(body[f]) ?? '');
  for (const f of ['personName', 'phone', 'email']) if (body.contact?.[f] !== undefined) set(`contact.${f}`, text(body.contact[f]) ?? '', `contact ${f}`);
  if (body.status !== undefined) {
    if (!['active', 'suspended'].includes(body.status)) throw new HttpError(400, 'Choose active or suspended.');
    set('status', body.status);
  }
  if (changes.length) {
    await coop.save();
    await auditBoth(coop._id, { action: 'update', entityType: 'Cooperative', entityId: coop._id, entityLabel: coop.name, changes });
  }
  return cooperativeDetail(coop._id);
}

export async function updateSubscription(id, body = {}) {
  const coop = await Cooperative.findById(id);
  if (!coop) throw notFound('Cooperative');
  const next = readSubscription(body, { partial: true });
  if (next.capacityLimit !== undefined) {
    const layout = await Quadrant.aggregate([{ $match: { cooperativeId: coop._id, active: true } }, { $group: { _id: null, total: { $sum: '$capacity' } } }]);
    const total = layout[0]?.total ?? 0;
    if (next.capacityLimit < total) {
      throw new HttpError(400, `This cooperative's layout already holds ${total.toLocaleString('en-US')} sacks. The limit cannot be lower than that.`);
    }
  }
  const changes = [];
  for (const [field, to] of Object.entries(next)) {
    const from = coop.subscription?.[field] ?? null;
    const plain = (v) => (v instanceof Date ? v.toISOString() : Array.isArray(v) ? [...v].sort().join(',') : v ?? null);
    if (plain(from?.toObject ? from.toObject() : from) !== plain(to)) {
      changes.push({ field, from: from?.toObject ? from.toObject() : from, to });
      coop.set(`subscription.${field}`, to);
    }
  }
  if (changes.length) {
    await coop.save();
    await auditBoth(coop._id, { action: 'update', entityType: 'Subscription', entityId: coop._id, entityLabel: `${coop.name} subscription`, changes });
  }
  return cooperativeDetail(coop._id);
}

export async function addAdmin(id, body) {
  const coop = await Cooperative.findById(id).lean();
  if (!coop) throw notFound('Cooperative');
  const data = readAdmin(body);
  try {
    const { user, password } = await createAdmin(coop._id, data);
    await auditBoth(coop._id, { action: 'create', entityType: 'User', entityId: user._id, entityLabel: user.name, changes: [{ field: 'role', from: null, to: ROLES.COOP_ADMIN }] });
    return { admin: { id: user._id, name: user.name }, temporaryPassword: password };
  } catch (err) {
    throw duplicate(err);
  }
}

// For a cooperative admin who is locked out. Only admins, never staff or farmers.
export async function resetAdminPassword(id, userId) {
  const user = await User.findOne({ _id: userId, cooperativeId: id, role: ROLES.COOP_ADMIN });
  if (!user) throw notFound('Cooperative admin');
  const password = temporaryPassword();
  user.passwordHash = await hashPassword(password);
  user.mustChangePassword = true;
  user.active = true;
  await user.save();
  await auditBoth(user.cooperativeId, { action: 'password_reset', entityType: 'User', entityId: user._id, entityLabel: user.name });
  return { admin: { id: user._id, name: user.name }, temporaryPassword: password };
}

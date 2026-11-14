import { Router } from 'express';
import { User } from '../models/User.js';
import { ROLE_LABELS, ROLES } from '../lib/roles.js';
import { pick, diff } from '../lib/pick.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { recordAudit } from '../services/audit.js';

// Staff and admin accounts of one cooperative (Cooperative Admin only).
// Farmer logins are managed from the Farmers page, not here.
const router = Router();
const TEAM_ROLES = [ROLES.COOP_ADMIN, ROLES.COOP_STAFF];
const FIELDS = ['name', 'email', 'phone', 'role', 'active'];

const view = (user, req) => ({
  id: user._id,
  name: user.name,
  email: user.email ?? '',
  phone: user.phone ?? '',
  role: user.role,
  roleLabel: ROLE_LABELS[user.role],
  active: user.active,
  mustChangePassword: user.mustChangePassword,
  lastLoginAt: user.lastLoginAt,
  isYou: String(user._id) === req.user.userId,
});

function clean(body, fields) {
  const data = pick(body, fields);
  for (const field of ['name', 'email', 'phone']) {
    if (typeof data[field] === 'string') data[field] = data[field].trim();
  }
  // Empty sign-in fields are stored as "not set", so uniqueness checks ignore them.
  for (const field of ['email', 'phone']) if (data[field] === '') data[field] = undefined;
  if (data.email) data.email = data.email.toLowerCase();
  if (data.role !== undefined && !TEAM_ROLES.includes(data.role)) {
    throw new HttpError(400, 'Choose Cooperative Admin or Cooperative Staff.');
  }
  return data;
}

const findTeamUser = (id) => User.findOne({ _id: id, role: { $in: TEAM_ROLES } });
const duplicate = () => new HttpError(409, 'Another account already uses that email or mobile number.');

router.get('/', async (req, res) => {
  const users = await User.find({ role: { $in: TEAM_ROLES } }).sort({ active: -1, name: 1 }).lean();
  res.json({ users: users.map((u) => view(u, req)) });
});

router.post('/', async (req, res) => {
  const data = clean(req.body, ['name', 'email', 'phone', 'role']);
  if (!data.role) throw new HttpError(400, 'Choose a role.');
  const password = temporaryPassword();
  let user;
  try {
    user = await User.create({ ...data, passwordHash: await hashPassword(password), mustChangePassword: true });
  } catch (err) {
    if (err?.code === 11000) throw duplicate();
    throw err;
  }
  await recordAudit({
    action: 'create', entityType: 'User', entityId: user._id, entityLabel: user.name,
    changes: [{ field: 'role', from: null, to: user.role }],
  });
  // Shown to the admin once so they can hand it over. It is never stored or logged.
  res.status(201).json({ user: view(user, req), temporaryPassword: password });
});

router.patch('/:id', async (req, res) => {
  const user = await findTeamUser(req.params.id);
  if (!user) throw notFound('User');
  const data = clean(req.body, FIELDS);
  const isSelf = String(user._id) === req.user.userId;
  if (isSelf && data.active === false) throw new HttpError(400, 'You cannot turn off your own account.');
  if (isSelf && data.role && data.role !== user.role) throw new HttpError(400, 'You cannot change your own role.');

  const before = user.toObject();
  user.set(data);
  if (!user.email && !user.phone) throw new HttpError(400, 'An email or mobile number is required.');
  try {
    await user.save();
  } catch (err) {
    if (err?.code === 11000) throw duplicate();
    throw err;
  }
  const changes = diff(before, user.toObject(), FIELDS);
  if (changes.length) {
    await recordAudit({ action: 'update', entityType: 'User', entityId: user._id, entityLabel: user.name, changes });
  }
  res.json({ user: view(user, req) });
});

router.post('/:id/reset-password', async (req, res) => {
  const user = await findTeamUser(req.params.id);
  if (!user) throw notFound('User');
  if (String(user._id) === req.user.userId) {
    throw new HttpError(400, 'To change your own password, use Change Password.');
  }
  const password = temporaryPassword();
  user.passwordHash = await hashPassword(password);
  user.mustChangePassword = true;
  await user.save();
  await recordAudit({ action: 'password_reset', entityType: 'User', entityId: user._id, entityLabel: user.name });
  res.json({ user: view(user, req), temporaryPassword: password });
});

export default router;

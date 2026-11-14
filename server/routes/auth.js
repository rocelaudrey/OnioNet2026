import { Router } from 'express';
import { User } from '../models/User.js';
import { Cooperative } from '../models/Cooperative.js';
import { ROLE_LABELS, ROLES } from '../lib/roles.js';
import { withDb } from '../db.js';
import { asSystem } from '../context.js';
import { issueSession, clearSession, requireAuth } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { MIN_PASSWORD_LENGTH, checkPassword, hashPassword } from '../lib/password.js';
import { recordAudit } from '../services/audit.js';

const router = Router();

// The UI shows names, never raw database IDs.
function sessionView(user, coop) {
  return {
    name: user.name,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role],
    cooperativeName: coop?.name ?? null,
    facilityName: coop?.facilityName ?? null,
    mustChangePassword: user.mustChangePassword,
  };
}

async function loadCooperative(user) {
  if (!user.cooperativeId) return null;
  return Cooperative.findById(user.cooperativeId).select('name facilityName status').lean();
}

// Sign in with an email or a mobile number.
router.post('/login', withDb, async (req, res) => {
  const login = String(req.body?.login ?? req.body?.email ?? '').trim();
  const password = String(req.body?.password ?? '');
  const invalid = () => res.status(401).json({ error: 'Incorrect sign-in details.' });
  if (!login || !password) return invalid();

  // No session exists yet, so this lookup runs as trusted system code.
  const user = await asSystem(() =>
    User.findOne({ $or: [{ email: login.toLowerCase() }, { phone: login }], active: true })
      .select('+passwordHash'));
  if (!user || !(await checkPassword(password, user.passwordHash))) return invalid();

  const coop = await loadCooperative(user);
  if (user.role !== ROLES.SUPER_ADMIN && coop?.status !== 'active') {
    return res.status(403).json({ error: 'This cooperative account is not active. Please contact OnioNet.' });
  }

  await asSystem(() => User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }));
  issueSession(res, user);
  res.json({ user: sessionView(user, coop) });
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, withDb, async (req, res) => {
  const user = await asSystem(() => User.findOne({ _id: req.user.userId, active: true }));
  if (!user) {
    clearSession(res);
    return res.status(401).json({ error: 'Please sign in.' });
  }
  res.json({ user: sessionView(user, await loadCooperative(user)) });
});

router.post('/change-password', requireAuth, withDb, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (newPassword === currentPassword) throw new HttpError(400, 'Your new password must be different from the current one.');

  const user = await asSystem(() =>
    User.findOne({ _id: req.user.userId, active: true }).select('+passwordHash'));
  if (!user || !(await checkPassword(currentPassword, user.passwordHash))) {
    throw new HttpError(400, 'Your current password is incorrect.');
  }
  const passwordHash = await hashPassword(newPassword);
  await asSystem(() => User.updateOne({ _id: user._id }, { $set: { passwordHash, mustChangePassword: false } }));
  await recordAudit({ action: 'password_reset', entityType: 'User', entityId: user._id, entityLabel: user.name });
  res.json({ ok: true });
});

export default router;

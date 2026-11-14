import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { asSystem, runWithContext } from '../context.js';
import { User } from '../models/User.js';

export const AUTH_COOKIE = 'onionet_session';
const SESSION_HOURS = 12;

export function signSession(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      name: user.name,
      role: user.role,
      coop: user.cooperativeId ? String(user.cooperativeId) : null,
      member: user.memberId ? String(user.memberId) : null,
    },
    config.jwtSecret,
    { expiresIn: `${SESSION_HOURS}h` },
  );
}

export function issueSession(res, user) {
  res.cookie(AUTH_COOKIE, signSession(user), {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(AUTH_COOKIE, { path: '/' });
}

// Checks the session and opens the request context. Everything after this
// middleware runs scoped to the user's cooperative (see plugins/tenant.js).
export function requireAuth(req, res, next) {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) return res.status(401).json({ error: 'Please sign in.' });
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    clearSession(res);
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
  req.user = {
    userId: payload.sub,
    userName: payload.name,
    role: payload.role,
    cooperativeId: payload.coop,
    memberId: payload.member,
  };
  runWithContext(req.user, next);
}

// A session token lasts for hours, so check on every request that the account
// is still active and still has the same role. Turning a user off or changing
// their role takes effect at once.
export async function requireActiveUser(req, res, next) {
  const user = await asSystem(() => User.findById(req.user.userId).select('active role').lean());
  if (!user || !user.active || user.role !== req.user.role) {
    clearSession(res);
    return res.status(401).json({ error: 'Please sign in again.' });
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this.' });
    }
    next();
  };
}

import express from 'express';
import cookieParser from 'cookie-parser';
import { withDb } from './db.js';
import { ROLES } from './lib/roles.js';
import { requireActiveUser, requireAuth, requireRole } from './middleware/auth.js';
import { errorHandler } from './middleware/errors.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import cooperativeRoutes from './routes/cooperative.js';
import quadrantRoutes from './routes/quadrants.js';
import memberRoutes from './routes/members.js';
import userRoutes from './routes/users.js';
import * as lists from './routes/lists.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);

// Everything below needs a session. requireAuth also opens the request
// context that scopes every database query to the user's cooperative.
const api = express.Router();
api.use(requireAuth, withDb, requireActiveUser);

const superAdmin = requireRole(ROLES.SUPER_ADMIN);
const coopTeam = requireRole(ROLES.COOP_ADMIN, ROLES.COOP_STAFF);

api.use('/admin', superAdmin, adminRoutes);
api.use('/cooperative', coopTeam, cooperativeRoutes);
api.use('/quadrants', coopTeam, quadrantRoutes);
api.use('/users', requireRole(ROLES.COOP_ADMIN), userRoutes);
api.use('/members', coopTeam, memberRoutes);
api.use('/batches', coopTeam, lists.batches);
api.use('/sacks', coopTeam, lists.sacks);
api.use('/tags', coopTeam, lists.tags);
api.use('/transactions', coopTeam, lists.transactions);

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use(errorHandler);

export default app;

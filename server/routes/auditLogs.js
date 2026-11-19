import { Router } from 'express';
import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTIONS } from '../../shared/statuses.js';
import { ROLE_LABELS } from '../lib/roles.js';

// The audit log, for the Cooperative Admin (mounted behind requireRole).
// Raw record IDs are never sent; entries show the record's name instead.
const router = Router();
const PAGE_SIZE = 50;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const day = (text, end) => (/^\d{4}-\d{2}-\d{2}$/.test(String(text ?? '')) ? new Date(`${text}T${end ? '23:59:59.999' : '00:00:00'}`) : null);

// The people and record types that appear in this cooperative's log, for the filters.
router.get('/filters', async (req, res) => {
  const [people, types] = await Promise.all([AuditLog.distinct('actorName'), AuditLog.distinct('entityType')]);
  res.json({ people: people.sort(), types: types.sort(), actions: AUDIT_ACTIONS });
});

router.post('/search', async (req, res) => {
  const body = req.body ?? {};
  const filter = {};
  if (typeof body.actorName === 'string' && body.actorName) filter.actorName = body.actorName;
  if (typeof body.entityType === 'string' && body.entityType) filter.entityType = body.entityType;
  if (AUDIT_ACTIONS.includes(body.action)) filter.action = body.action;
  const from = day(body.from, false);
  const to = day(body.to, true);
  if (from || to) filter.occurredAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const q = String(body.q ?? '').trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ entityLabel: rx }, { actorName: rx }];
  }
  const page = Math.max(1, Number.parseInt(body.page, 10) || 1);
  const [rows, total] = await Promise.all([
    AuditLog.find(filter).sort({ occurredAt: -1, _id: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json({
    total, page, pageSize: PAGE_SIZE,
    entries: rows.map((r) => ({
      id: r._id,
      occurredAt: r.occurredAt,
      actorName: r.actorName,
      actorRole: ROLE_LABELS[r.actorRole] ?? '',
      action: r.action,
      entityType: r.entityType,
      entityLabel: r.entityLabel ?? '',
      changes: r.changes ?? [],
    })),
  });
});

export default router;

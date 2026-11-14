import { Router } from 'express';
import { Tag } from '../models/Tag.js';
import { CustodyEvent } from '../models/CustodyEvent.js';
import { Sack } from '../models/Sack.js';
import { TAG_STATUSES } from '../../shared/statuses.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { SCAN_PROBLEMS, STATUS_CHANGES, changeTagStatus, resolveTag } from '../services/tags.js';

const router = Router();
const PAGE_SIZE = 50;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const view = (tag) => ({
  id: tag._id,
  code: tag.code,
  status: tag.status,
  lotNo: tag.tagLotId?.lotNo ?? null,
  source: tag.source,
  qrSigned: tag.qrSigned,
  useCount: tag.useCount,
  lastScannedAt: tag.lastScannedAt,
});

async function totals() {
  const rows = await Tag.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  const out = Object.fromEntries(TAG_STATUSES.map((s) => [s, 0]));
  out.all = 0;
  for (const { _id, count } of rows) {
    out[_id] = count;
    out.all += count;
  }
  return out;
}

// Tag codes are not personal data, so filters can travel in the address.
router.get('/', async (req, res) => {
  const filter = {};
  if (TAG_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  const q = String(req.query.q ?? '').trim();
  if (q) filter.code = new RegExp(escapeRegex(q), 'i');
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const [tags, total] = await Promise.all([
    Tag.find(filter).sort('code').skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).populate('tagLotId', 'lotNo').lean(),
    Tag.countDocuments(filter),
  ]);
  res.json({ tags: tags.map(view), total, page, pageSize: PAGE_SIZE, totals: await totals() });
});

// Find a tag by scanning it or typing its code.
router.post('/lookup', async (req, res) => {
  const { tag, problem } = await resolveTag(req.body?.text, { allowTyped: true });
  if (problem) throw new HttpError(problem === 'unknown' ? 404 : 400, SCAN_PROBLEMS[problem]);
  res.json({ tag: { id: tag._id, code: tag.code, status: tag.status } });
});

router.get('/:id', async (req, res) => {
  const tag = await Tag.findOne({ _id: req.params.id }).populate('tagLotId', 'lotNo').lean();
  if (!tag) throw notFound('Tag');
  const events = await CustodyEvent.find({ tagId: tag._id }).sort({ occurredAt: -1 }).limit(100).lean();
  const sack = tag.currentSackId
    ? await Sack.findOne({ _id: tag.currentSackId }).populate('batchId', 'batchNo ownerType').populate('quadrantId', 'code')
      .populate('memberId', 'firstName lastName').lean()
    : null;
  res.json({
    tag: { ...view(tag), allowedChanges: STATUS_CHANGES[tag.status] },
    sack: sack && {
      sackNo: sack.sackNo,
      batchId: sack.batchId?._id,
      batchNo: sack.batchId?.batchNo,
      quadrantCode: sack.quadrantId?.code,
      ownerName: sack.memberId ? `${sack.memberId.firstName} ${sack.memberId.lastName}`.trim() : 'Cooperative stock',
      gateInAt: sack.gateInAt,
    },
    history: events.map((e) => ({
      id: e._id, type: e.type, method: e.method ?? 'scan', occurredAt: e.occurredAt, performedByName: e.performedByName, notes: e.notes ?? '',
    })),
  });
});

router.post('/:id/status', async (req, res) => {
  const tag = await changeTagStatus(req.params.id, req.body?.status, req.body?.notes);
  res.json({ tag: { id: tag._id, code: tag.code, status: tag.status } });
});

export default router;

import { Router } from 'express';
import { TagCount } from '../models/TagCount.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { assertFeature } from '../middleware/features.js';
import { recordAudit } from '../services/audit.js';
import { nextNumber } from '../services/sequences.js';
import { SCAN_PROBLEMS, countResult, resolveTag } from '../services/tags.js';

// Tag count (reconciliation): staff scan every tag on hand, then the system
// lists what is missing, unexpected, or in the wrong state.
const router = Router();
router.use(async (req, res, next) => {
  await assertFeature(req, 'tag_reconciliation');
  next();
});

const view = (count) => ({
  id: count._id,
  countNo: count.countNo,
  status: count.status,
  startedAt: count.startedAt,
  startedByName: count.startedBy?.name ?? '',
  finishedAt: count.finishedAt,
  scanned: count.scannedTagIds.length + count.unknownCodes.length,
});

const load = async (id) => {
  const count = await TagCount.findOne({ _id: id }).populate('startedBy', 'name');
  if (!count) throw notFound('Tag count');
  return count;
};

router.get('/', async (req, res) => {
  const counts = await TagCount.find().sort({ countNo: -1 }).limit(50).populate('startedBy', 'name').lean();
  res.json({ counts: counts.map(view) });
});

// Only one count can be open at a time, so two people do not split the scans.
router.post('/', async (req, res) => {
  const open = await TagCount.findOne({ status: 'open' }).populate('startedBy', 'name');
  if (open) return res.json({ count: view(open), resumed: true });
  const count = await TagCount.create({ countNo: await nextNumber('tagCount'), startedBy: req.user.userId });
  await recordAudit({ action: 'create', entityType: 'TagCount', entityId: count._id, entityLabel: `Tag Count ${count.countNo}` });
  res.status(201).json({ count: view(await load(count._id)) });
});

router.get('/:id', async (req, res) => {
  const count = await load(req.params.id);
  res.json({ count: view(count), result: await countResult(count) });
});

// One scanned (or typed) tag. Typing is allowed here because a count changes
// no custody record.
router.post('/:id/scans', async (req, res) => {
  const count = await load(req.params.id);
  if (count.status !== 'open') throw new HttpError(400, 'This count is finished.');
  const { tag, problem, code } = await resolveTag(req.body?.text, { allowTyped: true });

  if (problem === 'unreadable' || problem === 'bad_signature') throw new HttpError(400, SCAN_PROBLEMS[problem]);
  // $addToSet keeps each tag once however many times it is scanned.
  if (problem === 'unknown') {
    const repeat = count.unknownCodes.includes(code);
    await TagCount.updateOne({ _id: count._id, status: 'open' }, { $addToSet: { unknownCodes: code } });
    return res.json({ outcome: 'unexpected', code, repeat, message: SCAN_PROBLEMS.unknown });
  }
  const repeat = count.scannedTagIds.some((id) => id.equals(tag._id));
  await TagCount.updateOne({ _id: count._id, status: 'open' }, { $addToSet: { scannedTagIds: tag._id } });
  const wrong = ['assigned', 'lost', 'retired'].includes(tag.status);
  res.json({ outcome: wrong ? 'wrong_state' : 'ok', code: tag.code, status: tag.status, repeat });
});

router.post('/:id/finish', async (req, res) => {
  const count = await load(req.params.id);
  if (count.status === 'open') {
    count.result = await countResult(count);
    count.status = 'finished';
    count.finishedAt = new Date();
    await count.save();
    await recordAudit({ action: 'update', entityType: 'TagCount', entityId: count._id, entityLabel: `Tag Count ${count.countNo}`, changes: [{ field: 'status', from: 'open', to: 'finished' }] });
  }
  res.json({ count: view(count), result: count.result });
});

export default router;

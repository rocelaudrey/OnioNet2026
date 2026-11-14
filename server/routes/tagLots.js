import { Router } from 'express';
import { TagLot } from '../models/TagLot.js';
import { Tag } from '../models/Tag.js';
import { ROLES } from '../lib/roles.js';
import { requireRole } from '../middleware/auth.js';
import { assertFeature } from '../middleware/features.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { recordAudit } from '../services/audit.js';
import { MAX_LOT_SIZE, generateLot, importLot, qrTextFor } from '../services/tags.js';

// Viewing lots is for the whole team; making, importing, and printing tags is
// for the Cooperative Admin.
const router = Router();
const adminOnly = requireRole(ROLES.COOP_ADMIN);

const view = (lot) => ({
  id: lot._id,
  lotNo: lot.lotNo,
  source: lot.source,
  quantity: lot.quantity,
  firstCode: lot.firstCode,
  lastCode: lot.lastCode,
  createdAt: lot.createdAt,
  createdByName: lot.createdBy?.name ?? '',
  printedAt: lot.printedAt,
  notes: lot.notes ?? '',
});

const withCreator = (id) => TagLot.findOne({ _id: id }).populate('createdBy', 'name').lean();

router.get('/', async (req, res) => {
  const lots = await TagLot.find().sort({ lotNo: -1 }).limit(200).populate('createdBy', 'name').lean();
  res.json({ lots: lots.map(view), maxLotSize: MAX_LOT_SIZE });
});

router.post('/', adminOnly, async (req, res) => {
  const lot = await generateLot({ quantity: req.body?.quantity, notes: String(req.body?.notes ?? '').trim() || undefined });
  res.status(201).json({ lot: view(await withCreator(lot._id)) });
});

router.post('/import', adminOnly, async (req, res) => {
  await assertFeature(req, 'tag_import');
  const lot = await importLot({ entries: req.body?.entries, notes: String(req.body?.notes ?? '').trim() || undefined });
  res.status(201).json({ lot: view(await withCreator(lot._id)) });
});

// The QR text for every tag in a lot. The print sheet is drawn in the browser.
router.get('/:id/print', adminOnly, async (req, res) => {
  const lot = await TagLot.findOne({ _id: req.params.id }).populate('createdBy', 'name').lean();
  if (!lot) throw notFound('Tag lot');
  const tags = await Tag.find({ tagLotId: lot._id }).select('code status qrSigned').sort('code').lean();
  if (tags.some((t) => !t.qrSigned)) {
    throw new HttpError(400, 'This lot has pre-printed tags without an OnioNet security code. They cannot be reprinted here.');
  }
  res.json({ lot: view(lot), tags: tags.map((t) => ({ code: t.code, status: t.status, qr: qrTextFor(t.code) })) });
});

router.post('/:id/printed', adminOnly, async (req, res) => {
  const lot = await TagLot.findOneAndUpdate(
    { _id: req.params.id }, { $set: { printedAt: new Date() } }, { returnDocument: 'after' },
  ).populate('createdBy', 'name').lean();
  if (!lot) throw notFound('Tag lot');
  await recordAudit({ action: 'export', entityType: 'TagLot', entityId: lot._id, entityLabel: `Tag Lot ${lot.lotNo} print sheet` });
  res.json({ lot: view(lot) });
});

export default router;

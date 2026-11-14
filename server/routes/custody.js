import { Router } from 'express';
import {
  gateIn, gateInRange, gateOut, moveSack, releaseSlip, replaceTag, startRelease,
} from '../services/custody.js';

const router = Router();

router.post('/gate-in', async (req, res) => {
  const result = await gateIn({
    batchId: req.body?.batchId,
    text: req.body?.text,
    quadrantId: req.body?.quadrantId,
    clientEventId: req.body?.clientEventId,
  });
  res.status(result.repeat ? 200 : 201).json(result);
});

// Many tags at once, from a first and a last tag (scanned or typed).
router.post('/gate-in-range', async (req, res) => {
  const body = req.body ?? {};
  const result = await gateInRange({
    batchId: body.batchId, quadrantId: body.quadrantId, first: body.first, last: body.last,
    method: body.method, clientEventId: body.clientEventId, dryRun: body.dryRun === true,
  });
  res.status(result.dryRun || result.repeat ? 200 : 201).json(result);
});

router.post('/move', async (req, res) => {
  const result = await moveSack({ text: req.body?.text, toQuadrantId: req.body?.toQuadrantId, clientEventId: req.body?.clientEventId });
  res.status(result.repeat ? 200 : 201).json(result);
});

// A release groups the sacks scanned out of one delivery in one visit.
router.post('/releases', async (req, res) => {
  res.status(201).json(await startRelease(req.body?.batchId));
});

router.get('/releases/:releaseNo', async (req, res) => {
  res.json({ slip: await releaseSlip(req.params.releaseNo) });
});

router.post('/gate-out', async (req, res) => {
  const result = await gateOut({
    batchId: req.body?.batchId, releaseNo: req.body?.releaseNo, text: req.body?.text, clientEventId: req.body?.clientEventId,
  });
  res.status(result.repeat ? 200 : 201).json(result);
});

router.post('/replace-tag', async (req, res) => {
  res.status(201).json(await replaceTag({
    oldTagId: req.body?.oldTagId, newText: req.body?.newText, reason: req.body?.reason, notes: req.body?.notes,
  }));
});

export default router;

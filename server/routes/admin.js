import { Router } from 'express';
import { crossTenant } from '../context.js';
import {
  addAdmin, cooperativeDetail, cooperativeRows, onboard, overview, resetAdminPassword, updateCooperative, updateSubscription,
} from '../services/platform.js';

// Super Admin only (mounted behind requireRole). Every handler runs across
// cooperatives, and nothing returns farmer details: only counts.
const router = Router();
const cross = (fn) => (req, res) => crossTenant(() => fn(req, res));

router.get('/overview', cross(async (req, res) => res.json(await overview())));
router.get('/cooperatives', cross(async (req, res) => res.json({ cooperatives: await cooperativeRows() })));

router.post('/cooperatives', cross(async (req, res) => {
  const { cooperative, admin, temporaryPassword } = await onboard(req.body);
  res.status(201).json({
    cooperative: { id: cooperative._id, name: cooperative.name },
    admin: { name: admin.name, email: admin.email ?? '', phone: admin.phone ?? '' },
    temporaryPassword,
  });
}));

router.get('/cooperatives/:id', cross(async (req, res) => res.json(await cooperativeDetail(req.params.id))));
router.patch('/cooperatives/:id', cross(async (req, res) => res.json(await updateCooperative(req.params.id, req.body))));
router.patch('/cooperatives/:id/subscription', cross(async (req, res) => res.json(await updateSubscription(req.params.id, req.body))));
router.post('/cooperatives/:id/admins', cross(async (req, res) => res.status(201).json(await addAdmin(req.params.id, req.body))));
router.post('/cooperatives/:id/admins/:userId/reset-password', cross(async (req, res) => res.json(await resetAdminPassword(req.params.id, req.params.userId))));

export default router;

import { Router } from 'express';
import { Cooperative } from '../models/Cooperative.js';

// Super Admin only (mounted behind requireRole). No farmer details here.
const router = Router();

router.get('/cooperatives', async (req, res) => {
  const coops = await Cooperative.find().sort('name').lean();
  res.json({
    cooperatives: coops.map((c) => ({
      id: c._id,
      name: c.name,
      facilityName: c.facilityName,
      status: c.status,
      plan: c.subscription?.plan,
      subscriptionStatus: c.subscription?.status,
      subscriptionEndsAt: c.subscription?.endsAt,
      capacityLimit: c.subscription?.capacityLimit,
    })),
  });
});

export default router;

import { Cooperative } from '../models/Cooperative.js';
import { HttpError } from './errors.js';

// Blocks a route when the cooperative's plan does not include a feature.
export async function assertFeature(req, feature) {
  const coop = await Cooperative.findById(req.user.cooperativeId).select('subscription.enabledFeatures').lean();
  if (!coop?.subscription?.enabledFeatures?.includes(feature)) {
    throw new HttpError(403, 'This is not available on your plan. Contact OnioNet to turn it on.');
  }
}

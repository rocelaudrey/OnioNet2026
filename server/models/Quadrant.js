import mongoose from 'mongoose';
import { tenantPlugin } from '../plugins/tenant.js';

// One storage area. Occupancy is counted from sacks when read, never stored.
const quadrantSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true }, // e.g. "1-A"
    floor: { type: Number, required: true, min: 1 },
    capacity: { type: Number, required: true, min: 0, validate: Number.isInteger }, // sacks
    fillOrder: { type: Number, required: true, min: 1 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

quadrantSchema.plugin(tenantPlugin);
quadrantSchema.index({ cooperativeId: 1, code: 1 }, { unique: true });

export const Quadrant = mongoose.models.Quadrant || mongoose.model('Quadrant', quadrantSchema);

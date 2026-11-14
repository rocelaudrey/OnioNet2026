import mongoose from 'mongoose';
import { tenantPlugin } from '../plugins/tenant.js';

// Next batch, receipt, member, lot, and tag number per cooperative.
const counterSchema = new mongoose.Schema({
  key: { type: String, required: true }, // e.g. "tag", "member", "batch:2026"
  value: { type: Number, default: 0 },
});

counterSchema.plugin(tenantPlugin);
counterSchema.index({ cooperativeId: 1, key: 1 }, { unique: true });

export const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

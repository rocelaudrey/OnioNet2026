import mongoose from 'mongoose';
import { SACK_STATUSES } from '../../shared/statuses.js';
import { tenantPlugin } from '../plugins/tenant.js';

const ref = (model, extra = {}) => ({ type: mongoose.Schema.Types.ObjectId, ref: model, ...extra });

// One physical sack, created at gate-in when a tag is scanned onto it.
const sackSchema = new mongoose.Schema(
  {
    batchId: ref('Batch', { required: true }),
    memberId: ref('Member', { default: null }), // copied from the batch; empty for coop-owned
    sackNo: { type: Number, required: true, min: 1 }, // sequence within the batch
    currentTagId: ref('Tag', { default: null }), // empty after gate-out
    quadrantId: ref('Quadrant', { required: true }),
    status: { type: String, enum: SACK_STATUSES, default: 'stored' },
    gateInAt: { type: Date, required: true, default: Date.now },
    gateOutAt: { type: Date, default: null },
    weightKg: { type: Number, min: 0, default: null },
    notes: { type: String, trim: true },
  },
  { timestamps: true },
);

sackSchema.plugin(tenantPlugin);
sackSchema.index({ cooperativeId: 1, batchId: 1, sackNo: 1 }, { unique: true });
sackSchema.index({ cooperativeId: 1, status: 1, quadrantId: 1 });
sackSchema.index({ cooperativeId: 1, memberId: 1, status: 1 });
// A tag can be on only one sack at a time.
sackSchema.index(
  { currentTagId: 1 },
  { unique: true, partialFilterExpression: { currentTagId: { $type: 'objectId' } } },
);

export const Sack = mongoose.models.Sack || mongoose.model('Sack', sackSchema);

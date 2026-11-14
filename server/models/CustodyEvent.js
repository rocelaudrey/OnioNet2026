import mongoose from 'mongoose';
import { CUSTODY_EVENT_TYPES, CUSTODY_METHODS } from '../../shared/statuses.js';
import { tenantPlugin } from '../plugins/tenant.js';
import { immutablePlugin } from '../plugins/immutable.js';

const ref = (model, extra = {}) => ({ type: mongoose.Schema.Types.ObjectId, ref: model, default: null, ...extra });

// The custody record. Append-only: it can never be edited or deleted.
const custodyEventSchema = new mongoose.Schema(
  {
    type: { type: String, enum: CUSTODY_EVENT_TYPES, required: true },
    method: { type: String, enum: CUSTODY_METHODS, default: 'scan' },
    tagId: ref('Tag'),
    sackId: ref('Sack'),
    batchId: ref('Batch'),
    memberId: ref('Member'),
    fromQuadrantId: ref('Quadrant'),
    toQuadrantId: ref('Quadrant'),
    performedBy: ref('User', { required: true, default: undefined }),
    performedByName: { type: String, required: true }, // copied so history survives renames
    occurredAt: { type: Date, required: true, default: Date.now },
    releaseNo: { type: String, trim: true }, // groups one visit's gate-outs for the release slip
    clientEventId: { type: String, trim: true }, // stops a retried scan being recorded twice
    notes: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

custodyEventSchema.plugin(tenantPlugin);
custodyEventSchema.plugin(immutablePlugin);
custodyEventSchema.index({ cooperativeId: 1, tagId: 1, occurredAt: -1 });
custodyEventSchema.index({ cooperativeId: 1, sackId: 1, occurredAt: -1 });
custodyEventSchema.index({ cooperativeId: 1, occurredAt: -1 });
custodyEventSchema.index({ cooperativeId: 1, releaseNo: 1 }, { sparse: true });
custodyEventSchema.index(
  { cooperativeId: 1, clientEventId: 1 },
  { unique: true, partialFilterExpression: { clientEventId: { $type: 'string' } } },
);

export const CustodyEvent =
  mongoose.models.CustodyEvent || mongoose.model('CustodyEvent', custodyEventSchema);

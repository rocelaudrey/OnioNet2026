import mongoose from 'mongoose';
import { tenantPlugin } from '../plugins/tenant.js';

// One tag count (reconciliation) session. The result (missing, unexpected,
// wrong state) is worked out when read.
const tagCountSchema = new mongoose.Schema(
  {
    countNo: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['open', 'finished'], default: 'open' },
    startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    startedAt: { type: Date, required: true, default: Date.now },
    finishedAt: { type: Date, default: null },
    scannedTagIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tag' }], default: [] },
    unknownCodes: { type: [String], default: [] },
    // Saved when the count is finished, so the report does not change later.
    result: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

tagCountSchema.plugin(tenantPlugin);
tagCountSchema.index({ cooperativeId: 1, countNo: 1 }, { unique: true });

export const TagCount = mongoose.models.TagCount || mongoose.model('TagCount', tagCountSchema);

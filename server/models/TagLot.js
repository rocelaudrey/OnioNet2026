import mongoose from 'mongoose';
import { TAG_SOURCES } from '../../shared/statuses.js';
import { tenantPlugin } from '../plugins/tenant.js';

// A set of tags generated (or imported) together.
const tagLotSchema = new mongoose.Schema(
  {
    lotNo: { type: Number, required: true, min: 1 },
    source: { type: String, enum: TAG_SOURCES, default: 'generated' },
    firstCode: { type: String, trim: true },
    lastCode: { type: String, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    printedAt: { type: Date, default: null },
    notes: { type: String, trim: true },
  },
  { timestamps: true },
);

tagLotSchema.plugin(tenantPlugin);
tagLotSchema.index({ cooperativeId: 1, lotNo: 1 }, { unique: true });

export const TagLot = mongoose.models.TagLot || mongoose.model('TagLot', tagLotSchema);

import mongoose from 'mongoose';
import { TAG_SOURCES, TAG_STATUSES } from '../../shared/statuses.js';
import { isValidTagCode } from '../lib/tagCode.js';
import { tenantPlugin } from '../plugins/tenant.js';

// One reusable PVC tag. The QR text (code + HMAC signature) is generated for
// printing and never stored. No farmer or batch data is ever in the QR.
const tagSchema = new mongoose.Schema(
  {
    code: {
      type: String, required: true, uppercase: true, trim: true, // e.g. FAF-000123-K
      validate: { validator: isValidTagCode, message: 'Invalid tag code' },
    },
    tagLotId: { type: mongoose.Schema.Types.ObjectId, ref: 'TagLot', required: true },
    source: { type: String, enum: TAG_SOURCES, default: 'generated' },
    qrSigned: { type: Boolean, default: true }, // false only for unsigned pre-printed tags
    status: { type: String, enum: TAG_STATUSES, default: 'available' },
    currentSackId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sack', default: null },
    useCount: { type: Number, default: 0, min: 0 },
    lastScannedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

tagSchema.plugin(tenantPlugin);
tagSchema.index({ code: 1 }, { unique: true });
tagSchema.index({ cooperativeId: 1, status: 1 });
tagSchema.index({ cooperativeId: 1, tagLotId: 1 });

export const Tag = mongoose.models.Tag || mongoose.model('Tag', tagSchema);

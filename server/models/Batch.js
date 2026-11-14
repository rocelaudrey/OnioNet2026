import mongoose from 'mongoose';
import {
  ADDED_FEE_CHARGED_PER, BATCH_STATUSES, OWNER_TYPES,
} from '../../shared/statuses.js';
import { tenantPlugin } from '../plugins/tenant.js';

const centavos = { type: Number, default: 0, min: 0, validate: Number.isInteger };

// One delivery received at the gate. Fees and balance are NOT stored here;
// the fee service computes them from feeTerms every time the batch is read.
const batchSchema = new mongoose.Schema(
  {
    batchNo: { type: String, required: true, trim: true }, // e.g. FAF-B-2026-0001
    ownerType: { type: String, enum: OWNER_TYPES, required: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', default: null },
    receivedAt: { type: Date, required: true, default: Date.now },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    variety: { type: String, trim: true },
    sizeClass: { type: String, trim: true },
    grade: { type: String, trim: true },
    declaredSackCount: { type: Number, required: true, min: 1, validate: Number.isInteger },
    totalWeightKg: { type: Number, min: 0, default: null },
    contractStart: { type: Date, required: true },
    contractEnd: { type: Date, required: true },
    // Copy of the fees in force at intake. Later setting changes do not touch it.
    feeTerms: {
      storageFeeCentavos: centavos,
      overdueFeePerDayCentavos: centavos,
      memberDiscountPercent: { type: Number, default: 0, min: 0, max: 100 },
      added: {
        type: [new mongoose.Schema({
          name: { type: String, required: true },
          amountCentavos: { ...centavos, required: true },
          chargedPer: { type: String, enum: ADDED_FEE_CHARGED_PER, required: true },
        }, { _id: false })],
        default: [],
      },
    },
    status: { type: String, enum: BATCH_STATUSES, default: 'receiving' },
    notes: { type: String, trim: true },
  },
  { timestamps: true },
);

batchSchema.plugin(tenantPlugin);

batchSchema.pre('validate', function check() {
  if (this.ownerType === 'coop_owned' && this.memberId) {
    this.invalidate('memberId', 'Coop-owned stock has no farmer');
  }
  if (this.ownerType !== 'coop_owned' && !this.memberId) {
    this.invalidate('memberId', 'A farmer is required');
  }
});

batchSchema.index({ cooperativeId: 1, batchNo: 1 }, { unique: true });
batchSchema.index({ cooperativeId: 1, memberId: 1 });
batchSchema.index({ cooperativeId: 1, status: 1, contractEnd: 1 });

export const Batch = mongoose.models.Batch || mongoose.model('Batch', batchSchema);

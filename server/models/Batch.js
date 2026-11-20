import mongoose from 'mongoose';
import {
  ADDED_FEE_CHARGED_PER, BATCH_CONDITIONS, BATCH_STATUSES, OWNER_TYPES,
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
    // The farm the onions came from. The name and place are copied at intake
    // so later edits to the farm do not change this delivery's record.
    farm: {
      type: new mongoose.Schema({
        farmId: { type: mongoose.Schema.Types.ObjectId, required: true },
        name: { type: String, required: true },
        location: { type: String, default: '' },
      }, { _id: false }),
      default: null,
    },
    // Condition as seen by staff (at intake or a later check). Recorded only.
    condition: {
      type: new mongoose.Schema({
        rating: { type: String, enum: BATCH_CONDITIONS, required: true },
        notes: { type: String, trim: true, maxlength: 300 },
        checkedAt: { type: Date, required: true },
        checkedByName: { type: String, required: true },
      }, { _id: false }),
      default: null,
    },
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
    // Installment ("layaway") plan for paying the balance. Progress is worked
    // out by the fee service when read, never stored.
    paymentPlan: {
      type: new mongoose.Schema({
        createdAt: { type: Date, required: true },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        createdByName: { type: String, required: true },
        frequency: { type: String, enum: ['monthly', 'every_2_weeks', 'weekly'], required: true },
        installments: {
          type: [new mongoose.Schema({
            dueDate: { type: Date, required: true },
            amountCentavos: { type: Number, required: true, min: 1, validate: Number.isInteger },
          }, { _id: false })],
          required: true,
        },
        notes: { type: String, trim: true },
        cancelledAt: { type: Date, default: null },
        cancelledByName: { type: String },
        cancelReason: { type: String, trim: true },
      }, { _id: false }),
      default: null,
    },
    // Bumped by every money change, so two payments on one delivery at the
    // same moment conflict and one is retried against the new balance.
    ledgerVersion: { type: Number, default: 0 },
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

import mongoose from 'mongoose';
import { CHARGE_KINDS, PAYMENT_METHODS, TRANSACTION_TYPES } from '../../shared/statuses.js';
import { tenantPlugin } from '../plugins/tenant.js';

// Money that actually moved. Charges are not stored here; they come from the
// fee service. A wrong entry is voided, never deleted.
const transactionSchema = new mongoose.Schema(
  {
    receiptNo: { type: String, required: true, trim: true },
    type: { type: String, enum: TRANSACTION_TYPES, required: true },
    // For type 'charge' only: what the manual charge is for.
    chargeKind: { type: String, enum: [...CHARGE_KINDS, null], default: null },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', default: null },
    amountCentavos: { type: Number, required: true, min: 1, validate: Number.isInteger },
    // Payments and refunds only; empty for waivers and charges.
    method: { type: String, enum: [...PAYMENT_METHODS, null], default: null },
    referenceNo: { type: String, trim: true },
    paidAt: { type: Date, required: true, default: Date.now },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    voided: {
      at: { type: Date, default: null },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      reason: { type: String, trim: true },
    },
    notes: { type: String, trim: true },
    clientRequestId: { type: String, trim: true }, // stops a double-tapped Save from paying twice
  },
  { timestamps: true },
);

transactionSchema.plugin(tenantPlugin);
transactionSchema.index({ cooperativeId: 1, receiptNo: 1 }, { unique: true });
transactionSchema.index({ cooperativeId: 1, batchId: 1 });
transactionSchema.index({ cooperativeId: 1, memberId: 1, paidAt: -1 });
transactionSchema.index({ cooperativeId: 1, paidAt: -1 });
transactionSchema.index(
  { cooperativeId: 1, clientRequestId: 1 },
  { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string' } } },
);

export const Transaction =
  mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);

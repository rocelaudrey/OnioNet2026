import mongoose from 'mongoose';
import {
  ADDED_FEE_APPLIES_TO, ADDED_FEE_CHARGED_PER, FEATURES, SUBSCRIPTION_STATUSES,
} from '../../shared/statuses.js';

// The tenant itself. Its _id is the cooperativeId on every other record.
// Layout, capacity, fees, tag prefix, and branding all live in data, never in code.
const centavos = { type: Number, default: 0, min: 0, validate: Number.isInteger };

export const addedFeeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  amountCentavos: { ...centavos, required: true },
  chargedPer: { type: String, enum: ADDED_FEE_CHARGED_PER, required: true },
  appliesTo: { type: String, enum: ADDED_FEE_APPLIES_TO, default: 'every_batch' },
  active: { type: Boolean, default: true },
});

const cooperativeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    facilityName: { type: String, trim: true },
    address: { type: String, trim: true },
    contact: {
      personName: { type: String, trim: true },
      phone: { type: String, trim: true },
      email: { type: String, trim: true, lowercase: true },
    },
    branding: {
      displayName: { type: String, trim: true },
      logoUrl: { type: String, trim: true },
    },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    settings: {
      tagPrefix: { type: String, required: true, uppercase: true, trim: true, match: /^[A-Z0-9]{2,6}$/ },
      contractMonths: { type: Number, default: 3, min: 1 },
      sizeClasses: { type: [String], default: [] },
      grades: { type: [String], default: [] },
      fees: {
        // Built-in fees: always present, editable, never removable.
        storageFeeCentavos: centavos, // once per sack for the contract period
        overdueFeePerDayCentavos: centavos, // per sack per day past contract end
        memberDiscountPercent: { type: Number, default: 0, min: 0, max: 100 },
        added: { type: [addedFeeSchema], default: [] },
      },
    },
    subscription: {
      plan: { type: String, trim: true, default: 'trial' },
      status: { type: String, enum: SUBSCRIPTION_STATUSES, default: 'trial' },
      startedAt: { type: Date, default: Date.now },
      endsAt: { type: Date, default: null },
      capacityLimit: { type: Number, default: 10000, min: 0 }, // most sacks the plan allows
      enabledFeatures: { type: [{ type: String, enum: FEATURES }], default: [] },
      notes: { type: String, trim: true },
    },
  },
  { timestamps: true },
);

cooperativeSchema.index({ 'settings.tagPrefix': 1 }, { unique: true });

export const Cooperative =
  mongoose.models.Cooperative || mongoose.model('Cooperative', cooperativeSchema);

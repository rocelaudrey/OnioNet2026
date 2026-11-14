import mongoose from 'mongoose';
import { MEMBER_STATUSES, MEMBER_TIERS } from '../../shared/statuses.js';
import { tenantPlugin } from '../plugins/tenant.js';

// A farmer who stores onions. Collect only what the cooperative needs (RA 10173).
const memberSchema = new mongoose.Schema(
  {
    memberNo: { type: String, required: true, trim: true }, // e.g. FAF-M-0042
    tier: { type: String, enum: MEMBER_TIERS, required: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    address: {
      barangay: { type: String, trim: true },
      municipality: { type: String, trim: true },
      province: { type: String, trim: true },
    },
    birthDate: { type: Date, default: null },
    farmAreaHa: { type: Number, min: 0, default: null },
    rsbsaNo: { type: String, trim: true },
    status: { type: String, enum: MEMBER_STATUSES, default: 'active' },
    joinedAt: { type: Date, default: null },
    notes: { type: String, trim: true },
  },
  { timestamps: true },
);

memberSchema.plugin(tenantPlugin);
memberSchema.index({ cooperativeId: 1, memberNo: 1 }, { unique: true });
memberSchema.index({ cooperativeId: 1, lastName: 1, firstName: 1 });

memberSchema.virtual('fullName').get(function fullName() {
  return `${this.firstName} ${this.lastName}`.trim();
});

export const Member = mongoose.models.Member || mongoose.model('Member', memberSchema);

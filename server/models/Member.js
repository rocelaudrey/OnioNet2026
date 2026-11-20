import mongoose from 'mongoose';
import { MEMBER_STATUSES, MEMBER_TIERS } from '../../shared/statuses.js';
import { tenantPlugin } from '../plugins/tenant.js';

// Same shape as the farmer's address: PSGC codes with their names.
const placeFields = {
  country: { type: String, trim: true },
  region: { type: String, trim: true },
  regionCode: { type: String, trim: true },
  province: { type: String, trim: true },
  provinceCode: { type: String, trim: true },
  municipality: { type: String, trim: true },
  municipalityCode: { type: String, trim: true },
  barangay: { type: String, trim: true },
  barangayCode: { type: String, trim: true },
  street: { type: String, trim: true }, // sitio or landmark
};

// A farm where the farmer grows the onions they store, so each delivery can
// say where it came from. A farm no longer used is turned off, never deleted,
// because past deliveries point to it.
const farmSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  location: placeFields,
  areaHa: { type: Number, min: 0, default: null },
  notes: { type: String, trim: true, maxlength: 300 },
  active: { type: Boolean, default: true },
});

// A farmer who stores onions. Collect only what the cooperative needs (RA 10173).
const memberSchema = new mongoose.Schema(
  {
    memberNo: { type: String, required: true, trim: true }, // e.g. FAF-M-0042
    tier: { type: String, enum: MEMBER_TIERS, required: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    // Chosen from the official PSGC list. Names are kept with the codes so
    // reports read without a lookup. Older records may have names only.
    address: {
      country: { type: String, trim: true },
      region: { type: String, trim: true },
      regionCode: { type: String, trim: true },
      province: { type: String, trim: true },
      provinceCode: { type: String, trim: true },
      municipality: { type: String, trim: true },
      municipalityCode: { type: String, trim: true },
      barangay: { type: String, trim: true },
      barangayCode: { type: String, trim: true },
      street: { type: String, trim: true }, // house no., street, purok, or sitio
    },
    birthDate: { type: Date, default: null },
    farmAreaHa: { type: Number, min: 0, default: null },
    farms: { type: [farmSchema], default: [] },
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

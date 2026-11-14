import mongoose from 'mongoose';
import { ROLES } from '../lib/roles.js';
import { tenantPlugin } from '../plugins/tenant.js';

// Someone who can sign in. cooperativeId is empty only for the Super Admin.
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(ROLES), required: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', default: null }, // member role only
    active: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.plugin(tenantPlugin, { allowNull: true });

userSchema.pre('validate', function check() {
  if (!this.email && !this.phone) this.invalidate('email', 'An email or mobile number is required');
  if (this.role !== ROLES.SUPER_ADMIN && !this.cooperativeId) {
    this.invalidate('cooperativeId', 'A cooperative is required');
  }
  if (this.role === ROLES.SUPER_ADMIN && this.cooperativeId) {
    this.invalidate('cooperativeId', 'The Super Admin does not belong to a cooperative');
  }
  if (this.role === ROLES.MEMBER && !this.memberId) {
    this.invalidate('memberId', 'A farmer login must be linked to a farmer record');
  }
});

// Sign-in names are unique across the whole system.
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });

export const User = mongoose.models.User || mongoose.model('User', userSchema);

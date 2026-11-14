import mongoose from 'mongoose';
import { AUDIT_ACTIONS } from '../../shared/statuses.js';
import { tenantPlugin } from '../plugins/tenant.js';
import { immutablePlugin } from '../plugins/immutable.js';

// Who changed what. Append-only. cooperativeId is empty for platform actions
// by the Super Admin. Passwords and secrets are never recorded.
const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, required: true },
    actorRole: { type: String },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    entityType: { type: String, required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    entityLabel: { type: String }, // the human name shown in the UI
    changes: {
      type: [new mongoose.Schema({
        field: { type: String, required: true },
        from: mongoose.Schema.Types.Mixed,
        to: mongoose.Schema.Types.Mixed,
      }, { _id: false })],
      default: [],
    },
    occurredAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);

auditLogSchema.plugin(tenantPlugin, { allowNull: true });
auditLogSchema.plugin(immutablePlugin);
auditLogSchema.index({ cooperativeId: 1, occurredAt: -1 });
auditLogSchema.index({ cooperativeId: 1, entityType: 1, entityId: 1 });

export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);

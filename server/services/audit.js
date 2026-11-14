import { AuditLog } from '../models/AuditLog.js';
import { crossTenant, getContext } from '../context.js';
import { ROLES } from '../lib/roles.js';

// Writes one audit entry for the signed-in user. Never pass passwords or secrets.
export async function recordAudit({ action, entityType, entityId = null, entityLabel, changes = [] }, { session } = {}) {
  const ctx = getContext();
  const write = async () => {
    const [entry] = await AuditLog.create(
      [{
        actorId: ctx?.userId ?? null,
        actorName: ctx?.userName ?? 'System',
        actorRole: ctx?.role,
        action, entityType, entityId, entityLabel, changes,
      }],
      { session },
    );
    return entry;
  };
  // Super Admin actions are platform entries with no cooperative.
  if (ctx?.role === ROLES.SUPER_ADMIN && !ctx.crossTenant) return crossTenant(write);
  return write();
}

import { AsyncLocalStorage } from 'node:async_hooks';
import { ROLES } from './lib/roles.js';

// Per-request context. The auth middleware fills it after checking the JWT;
// the tenant plugin reads it to scope every query to one cooperative.
const storage = new AsyncLocalStorage();

// Mongoose queries only run when awaited. Awaiting INSIDE the scope makes sure
// a query returned from fn runs with this context, not the caller's.
const run = (ctx, fn) => storage.run(Object.freeze(ctx), async () => await fn());

export function runWithContext(ctx, fn) {
  return run({ ...ctx }, fn);
}

export function getContext() {
  return storage.getStore() ?? null;
}

// The ONLY way to query across cooperatives. Allowed for the Super Admin
// (inside /api/admin routes) and for trusted system code such as login and
// the seed script, which call asSystem.
export async function crossTenant(fn) {
  const ctx = getContext();
  if (!ctx || (ctx.role !== ROLES.SUPER_ADMIN && !ctx.system)) {
    throw new Error('Cross-cooperative access is not allowed for this user');
  }
  return run({ ...ctx, crossTenant: true }, fn);
}

// For code that runs with no signed-in user: login lookup, seed, scripts.
export function asSystem(fn) {
  return run({ system: true, crossTenant: true }, fn);
}

// Runs fn scoped to one cooperative with no user, e.g. seeding a tenant.
export function asCooperative(cooperativeId, fn) {
  return run({ system: true, cooperativeId: String(cooperativeId) }, fn);
}

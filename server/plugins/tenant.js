import mongoose from 'mongoose';
import { getContext } from '../context.js';

// Adds cooperativeId to a model and scopes EVERY query to the cooperative in
// the request context. With no context the query throws (fail closed), so a
// forgotten middleware can never return another cooperative's data.
//
// options.allowNull: cooperativeId may be empty (Super Admin users, platform
// audit entries). Scoped queries still never match those records.

const QUERY_OPS = [
  'find', 'findOne', 'countDocuments', 'distinct',
  'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany',
];

export class TenantError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TenantError';
  }
}

// Returns the cooperativeId to scope to, or null when cross-tenant is allowed.
function scopeId(modelName) {
  const ctx = getContext();
  if (!ctx) throw new TenantError(`${modelName} was queried with no cooperative context`);
  if (ctx.crossTenant) return null;
  if (!ctx.cooperativeId) throw new TenantError(`${modelName} was queried by a user with no cooperative`);
  return new mongoose.Types.ObjectId(String(ctx.cooperativeId));
}

function stamp(doc, modelName, allowNull) {
  const id = scopeId(modelName);
  if (id === null) {
    if (!doc.cooperativeId && !allowNull) throw new TenantError(`${modelName} needs a cooperative`);
    return;
  }
  if (doc.cooperativeId && String(doc.cooperativeId) !== String(id)) {
    throw new TenantError(`Cannot write ${modelName} into another cooperative`);
  }
  doc.cooperativeId = id;
}

export function tenantPlugin(schema, options = {}) {
  const allowNull = options.allowNull === true;

  schema.add({
    cooperativeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cooperative',
      index: true,
      immutable: true,
      default: null,
      ...(allowNull ? {} : { required: true }),
    },
  });

  schema.pre(QUERY_OPS, function scopeQuery() {
    const id = scopeId(this.model.modelName);
    if (id === null) return;
    const filter = this.getQuery();
    // Asking for another cooperative by name is refused outright, rather than
    // being silently turned into a query on the caller's own data.
    if (filter.cooperativeId != null && String(filter.cooperativeId) !== String(id)) {
      throw new TenantError(`Cannot query ${this.model.modelName} in another cooperative`);
    }
    // Set last so nothing supplied by the caller can widen the scope.
    this.setQuery({ ...filter, cooperativeId: id });
  });

  // This count ignores filters, so it can never be scoped.
  schema.pre('estimatedDocumentCount', function block() {
    if (scopeId(this.model.modelName) !== null) {
      throw new TenantError('estimatedDocumentCount is not allowed on tenant data; use countDocuments');
    }
  });

  schema.pre('aggregate', function scopeAggregate() {
    const id = scopeId(this._model.modelName);
    if (id !== null) this.pipeline().unshift({ $match: { cooperativeId: id } });
  });

  schema.pre('validate', function stampDoc() {
    if (this.isNew) stamp(this, this.constructor.modelName, allowNull);
  });

  schema.pre('insertMany', function stampMany(...args) {
    const docs = args.find((a) => Array.isArray(a)) ?? [];
    for (const doc of docs) stamp(doc, this.modelName, allowNull);
  });

  schema.pre('bulkWrite', function block() {
    if (scopeId(this.modelName) !== null) {
      throw new TenantError('bulkWrite is not allowed on tenant data');
    }
  });
}

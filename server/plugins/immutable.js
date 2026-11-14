// Append-only records (custody events, audit logs): once written they can
// never be edited or deleted.
const BLOCKED = [
  'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany',
];

export function immutablePlugin(schema) {
  schema.pre(BLOCKED, function block() {
    throw new Error(`${this.model.modelName} records cannot be changed or deleted`);
  });
  schema.pre('save', function block() {
    if (!this.isNew) throw new Error(`${this.constructor.modelName} records cannot be changed`);
  });
  schema.pre('deleteOne', { document: true, query: false }, function block() {
    throw new Error(`${this.constructor.modelName} records cannot be deleted`);
  });
}

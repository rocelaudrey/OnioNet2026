// Copies only the allowed fields from a request body, so clients can never
// set fields such as cooperativeId, status flags, or IDs they should not.
export function pick(source, fields) {
  const out = {};
  for (const field of fields) {
    if (source && Object.hasOwn(source, field) && source[field] !== undefined) out[field] = source[field];
  }
  return out;
}

export function diff(before, after, fields) {
  const changes = [];
  for (const field of fields) {
    const from = before?.[field] ?? null;
    const to = after?.[field] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ field, from, to });
  }
  return changes;
}

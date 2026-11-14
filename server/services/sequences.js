import { Counter } from '../models/Counter.js';

// Hands out the next number for a key within the current cooperative.
// Atomic, so two staff working at once never get the same number.
export async function nextNumber(key, { session } = {}) {
  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: 'after', session },
  );
  return counter.value;
}

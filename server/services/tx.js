import mongoose from 'mongoose';
import { config } from '../config.js';

// Multi-step changes (tag + custody event + audit entry) must all succeed or
// all fail, so they run in a MongoDB transaction. Transactions need a replica
// set, which Atlas always is. A plain local MongoDB is not, so in local
// development only we fall back to running the steps without one.
let supported;

async function supportsTransactions() {
  if (supported === undefined) {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    supported = Boolean(hello.setName) || hello.msg === 'isdbgrid';
    if (!supported) {
      if (config.isProduction) throw new Error('The database must be a replica set (MongoDB Atlas).');
      console.warn('[onionet] This MongoDB has no transaction support. Multi-step changes are NOT atomic. Use an Atlas dev cluster.');
    }
  }
  return supported;
}

// Runs fn(session). Pass { session } to every query and write inside fn.
export async function inTransaction(fn) {
  if (!(await supportsTransactions())) return fn(undefined);
  let result;
  await mongoose.connection.transaction(async (session) => {
    result = await fn(session);
  });
  return result;
}

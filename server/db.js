import mongoose from 'mongoose';
import { config } from './config.js';

// Cache the connection across serverless invocations so each function call
// does not open a new connection to Atlas.
const cached = (globalThis.__onionetMongo ??= { conn: null, promise: null });

export async function connectDb() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose
      .connect(config.mongodbUri, { bufferCommands: false, maxPoolSize: 5 })
      .catch((err) => {
        cached.promise = null;
        throw err;
      });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

export async function withDb(req, res, next) {
  try {
    await connectDb();
    next();
  } catch (err) {
    next(err);
  }
}

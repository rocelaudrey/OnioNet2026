import { Batch } from '../models/Batch.js';
import { Quadrant } from '../models/Quadrant.js';
import { Sack } from '../models/Sack.js';

// Occupancy is always counted from sacks when read, never stored.

export async function storedByQuadrant(session) {
  const rows = await Sack.aggregate([
    { $match: { status: 'stored' } },
    { $group: { _id: '$quadrantId', count: { $sum: 1 } } },
  ]).session(session ?? null);
  return new Map(rows.map((r) => [String(r._id), r.count]));
}

// Sacks still expected from deliveries that are being received: declared
// minus already scanned in. They hold their space until receiving is finished.
async function pendingSacks(session, exceptBatchId) {
  const receiving = await Batch.find({ status: 'receiving' }).select('declaredSackCount').session(session ?? null).lean();
  const open = receiving.filter((b) => String(b._id) !== String(exceptBatchId ?? ''));
  if (!open.length) return 0;
  const rows = await Sack.aggregate([
    { $match: { batchId: { $in: open.map((b) => b._id) } } },
    { $group: { _id: '$batchId', count: { $sum: 1 } } },
  ]).session(session ?? null);
  const received = new Map(rows.map((r) => [String(r._id), r.count]));
  return open.reduce((sum, b) => sum + Math.max(0, b.declaredSackCount - (received.get(String(b._id)) ?? 0)), 0);
}

// The whole picture: each quadrant with its usage, plus totals.
// available = capacity of active quadrants − sacks stored − sacks still expected.
export async function capacityOverview({ session, exceptBatchId } = {}) {
  const [quadrants, used, pending] = await Promise.all([
    Quadrant.find().sort('fillOrder').session(session ?? null).lean(),
    storedByQuadrant(session),
    pendingSacks(session, exceptBatchId),
  ]);
  const rows = quadrants.map((q) => {
    const count = used.get(String(q._id)) ?? 0;
    return { id: q._id, code: q.code, floor: q.floor, capacity: q.capacity, fillOrder: q.fillOrder, active: q.active, used: count, free: Math.max(0, q.capacity - count) };
  });
  const active = rows.filter((q) => q.active);
  const capacity = active.reduce((sum, q) => sum + q.capacity, 0);
  const stored = rows.reduce((sum, q) => sum + q.used, 0);
  return { quadrants: rows, capacity, stored, pending, available: Math.max(0, capacity - stored - pending) };
}

// The first quadrant in fill order that is in use and has room.
export const suggestQuadrant = (overview) => overview.quadrants.find((q) => q.active && q.free > 0) ?? null;

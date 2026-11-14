import { Batch } from '../models/Batch.js';
import { Cooperative } from '../models/Cooperative.js';
import { Member } from '../models/Member.js';
import { Sack } from '../models/Sack.js';
import { getContext } from '../context.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { recordAudit } from './audit.js';
import { capacityOverview } from './capacity.js';
import { nextNumber } from './sequences.js';

const n = (v) => v.toLocaleString('en-US');

// Same day N months later; the 31st falls back to the month's last day.
export function addMonths(date, months) {
  const out = new Date(date);
  const day = out.getDate();
  out.setDate(1);
  out.setMonth(out.getMonth() + months);
  out.setDate(Math.min(day, new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate()));
  return out;
}

// The fees a delivery comes in with, copied from Settings at intake so that
// later setting changes never alter a delivery already received.
export function feeTermsFor(fees, ownerType, optionalFeeIds = []) {
  if (ownerType === 'coop_owned') {
    return { storageFeeCentavos: 0, overdueFeePerDayCentavos: 0, memberDiscountPercent: 0, added: [] };
  }
  const chosen = new Set(optionalFeeIds.map(String));
  return {
    storageFeeCentavos: fees.storageFeeCentavos,
    overdueFeePerDayCentavos: fees.overdueFeePerDayCentavos,
    memberDiscountPercent: ownerType === 'member' ? fees.memberDiscountPercent : 0, // never for guests
    added: fees.added
      .filter((f) => f.active && (f.appliesTo === 'every_batch' || chosen.has(String(f._id))))
      .map((f) => ({ name: f.name, amountCentavos: f.amountCentavos, chargedPer: f.chargedPer })),
  };
}

export async function assertRoom(declaredSackCount, { exceptBatchId } = {}) {
  const overview = await capacityOverview({ exceptBatchId });
  if (declaredSackCount > overview.available) {
    throw new HttpError(400, `There is room for ${n(overview.available)} more sacks, but this delivery has ${n(declaredSackCount)}.`);
  }
}

function sackCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 100000) throw new HttpError(400, 'Enter how many sacks were delivered.');
  return count;
}

const text = (value) => String(value ?? '').trim() || undefined;

function weight(value) {
  if (value === '' || value === null || value === undefined) return null;
  const kg = Number(value);
  if (!Number.isFinite(kg) || kg < 0) throw new HttpError(400, 'Total weight must be 0 or more kilograms.');
  return kg;
}

// Starts an intake. The owner is a farmer, or the cooperative itself.
export async function startIntake(body = {}) {
  const ctx = getContext();
  const coop = await Cooperative.findById(ctx.cooperativeId).select('settings').lean();
  const declaredSackCount = sackCount(body.declaredSackCount);

  let ownerType = 'coop_owned';
  let member = null;
  if (!body.coopOwned) {
    member = body.memberId ? await Member.findOne({ _id: body.memberId }).lean() : null;
    if (!member) throw new HttpError(400, 'Choose the farmer who delivered the sacks.');
    if (member.status !== 'active') throw new HttpError(400, 'This farmer is inactive. Make them active before receiving a delivery.');
    ownerType = member.tier; // member or guest, fixed for this delivery from now on
  }
  await assertRoom(declaredSackCount);

  const receivedAt = new Date();
  const year = receivedAt.getFullYear();
  const number = await nextNumber(`batch:${year}`);
  const batch = await Batch.create({
    batchNo: `${coop.settings.tagPrefix}-B-${year}-${String(number).padStart(4, '0')}`,
    ownerType,
    memberId: member?._id ?? null,
    receivedAt,
    receivedBy: ctx.userId,
    variety: text(body.variety),
    sizeClass: text(body.sizeClass),
    grade: text(body.grade),
    declaredSackCount,
    totalWeightKg: weight(body.totalWeightKg),
    contractStart: receivedAt,
    contractEnd: addMonths(receivedAt, coop.settings.contractMonths),
    feeTerms: feeTermsFor(coop.settings.fees, ownerType, Array.isArray(body.optionalFeeIds) ? body.optionalFeeIds : []),
    notes: text(body.notes),
  });
  await recordAudit({ action: 'create', entityType: 'Batch', entityId: batch._id, entityLabel: batch.batchNo });
  return batch;
}

const EDITABLE = ['variety', 'sizeClass', 'grade', 'totalWeightKg', 'notes', 'declaredSackCount'];

// Corrects intake details. The owner and the fees cannot be changed.
export async function updateBatch(id, body = {}) {
  const batch = await Batch.findOne({ _id: id });
  if (!batch) throw notFound('Delivery');
  if (batch.status === 'cancelled') throw new HttpError(400, 'This delivery was cancelled.');
  const before = batch.toObject();

  for (const field of ['variety', 'sizeClass', 'grade', 'notes']) {
    if (body[field] !== undefined) batch[field] = text(body[field]);
  }
  if (body.totalWeightKg !== undefined) batch.totalWeightKg = weight(body.totalWeightKg);
  if (body.declaredSackCount !== undefined) {
    const count = sackCount(body.declaredSackCount);
    if (count !== batch.declaredSackCount) {
      if (batch.status !== 'receiving') throw new HttpError(400, 'The sack count can only be changed while the delivery is being received.');
      const received = await Sack.countDocuments({ batchId: batch._id });
      if (count < received) throw new HttpError(400, `${n(received)} sacks are already scanned in. The count cannot be lower than that.`);
      if (count > batch.declaredSackCount) {
        const overview = await capacityOverview({ exceptBatchId: batch._id });
        if (count - received > overview.available) {
          throw new HttpError(400, `There is room for ${n(overview.available)} more sacks.`);
        }
      }
      batch.declaredSackCount = count;
    }
  }
  const after = batch.toObject();
  const changes = EDITABLE
    .filter((f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null))
    .map((f) => ({ field: f, from: before[f] ?? null, to: after[f] ?? null }));
  if (changes.length) {
    await batch.save();
    await recordAudit({ action: 'update', entityType: 'Batch', entityId: batch._id, entityLabel: batch.batchNo, changes });
  }
  return batch;
}

async function setStatus(batch, to) {
  const from = batch.status;
  // Guarded on the old status so two people cannot both finish or cancel it.
  const updated = await Batch.findOneAndUpdate({ _id: batch._id, status: from }, { $set: { status: to } }, { returnDocument: 'after' });
  if (!updated) throw new HttpError(409, 'This delivery was just changed by someone else. Please check it again.');
  await recordAudit({ action: 'update', entityType: 'Batch', entityId: batch._id, entityLabel: batch.batchNo, changes: [{ field: 'status', from, to }] });
  return updated;
}

export async function finishReceiving(id, { acceptShortfall = false } = {}) {
  const batch = await Batch.findOne({ _id: id });
  if (!batch) throw notFound('Delivery');
  if (batch.status !== 'receiving') throw new HttpError(400, 'This delivery is not being received.');
  const received = await Sack.countDocuments({ batchId: batch._id });
  if (received === 0) throw new HttpError(400, 'No sacks have been scanned in yet. Scan the sacks, or cancel this delivery.');
  if (received < batch.declaredSackCount && !acceptShortfall) {
    const err = new HttpError(409, `Only ${n(received)} of ${n(batch.declaredSackCount)} sacks were scanned in.`);
    err.details = { shortfall: true, received, declared: batch.declaredSackCount };
    throw err;
  }
  return setStatus(batch, 'stored');
}

// Only a delivery with no sacks scanned in can be cancelled. Nothing is deleted.
export async function cancelIntake(id) {
  const batch = await Batch.findOne({ _id: id });
  if (!batch) throw notFound('Delivery');
  if (batch.status !== 'receiving') throw new HttpError(400, 'Only a delivery that is still being received can be cancelled.');
  if (await Sack.countDocuments({ batchId: batch._id })) {
    throw new HttpError(400, 'Sacks from this delivery are already scanned in, so it cannot be cancelled.');
  }
  return setStatus(batch, 'cancelled');
}

import { Batch } from '../models/Batch.js';
import { getContext } from '../context.js';
import { addMonths, DAY_MS } from '../lib/dates.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { formatPHP } from '../../shared/money.js';
import { recordAudit } from './audit.js';
import { accountFor } from './fees.js';
import { inTransaction } from './tx.js';

export const FREQUENCIES = { monthly: 'Monthly', every_2_weeks: 'Every 2 weeks', weekly: 'Weekly' };
const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function dueDates(first, count, frequency) {
  return Array.from({ length: count }, (_, i) => {
    if (frequency === 'monthly') return addMonths(first, i);
    return new Date(first.getTime() + i * (frequency === 'weekly' ? 7 : 14) * DAY_MS);
  });
}

// Splits an amount into equal installments; the last one takes the leftover centavos.
export function splitEvenly(total, count) {
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? total - base * (count - 1) : base));
}

// Sets up an installment plan for a delivery's current balance.
// dryRun returns the schedule without saving it.
export async function createPlan(batchId, body = {}) {
  const ctx = getContext();
  const count = Number(body.count);
  if (!Number.isInteger(count) || count < 2 || count > 12) throw new HttpError(400, 'Choose from 2 to 12 installments.');
  if (!FREQUENCIES[body.frequency]) throw new HttpError(400, 'Choose how often the farmer pays.');
  const text = String(body.firstDueDate ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new HttpError(400, 'Choose the first due date.');
  const now = new Date();
  if (text < localDate(now)) throw new HttpError(400, 'The first due date cannot be in the past.');
  const first = new Date(`${text}T12:00:00`);
  const notes = String(body.notes ?? '').trim() || undefined;

  return inTransaction(async (session) => {
    const s = session ?? null;
    const batch = await Batch.findOne({ _id: batchId }).session(s);
    if (!batch) throw notFound('Delivery');
    if (batch.status === 'cancelled') throw new HttpError(400, 'This delivery was cancelled.');
    if (batch.ownerType === 'coop_owned') throw new HttpError(400, 'Cooperative stock has no fees to pay.');
    if (batch.paymentPlan && !batch.paymentPlan.cancelledAt) {
      throw new HttpError(409, 'This delivery already has an installment plan. Cancel it first to set up a new one.');
    }
    const account = await accountFor(batch.toObject(), { session, asOf: now });
    const balance = account.balanceCentavos;
    if (balance <= 0) throw new HttpError(400, 'This delivery has no balance to pay.');
    if (Math.floor(balance / count) < 100) {
      throw new HttpError(400, `The balance is ${formatPHP(balance)}, too small for ${count} installments.`);
    }
    const amounts = splitEvenly(balance, count);
    const installments = dueDates(first, count, body.frequency).map((dueDate, i) => ({ dueDate, amountCentavos: amounts[i] }));
    if (body.dryRun === true) return { dryRun: true, balanceCentavos: balance, installments };

    await Batch.updateOne({ _id: batch._id }, {
      $set: {
        paymentPlan: {
          createdAt: now, createdBy: ctx.userId, createdByName: ctx.userName,
          frequency: body.frequency, installments, notes,
        },
      },
      $inc: { ledgerVersion: 1 },
    }, { session });
    await recordAudit({
      action: 'create', entityType: 'PaymentPlan', entityId: batch._id, entityLabel: `${batch.batchNo} installment plan`,
      changes: [{ field: 'installments', from: null, to: `${count} × ${FREQUENCIES[body.frequency].toLowerCase()}, ${formatPHP(balance)} in total` }],
    }, { session });
    return { dryRun: false, balanceCentavos: balance, installments };
  });
}

// A cancelled plan is kept on the delivery (marked cancelled) until a new one replaces it.
export async function cancelPlan(batchId, reasonText) {
  const ctx = getContext();
  const reason = String(reasonText ?? '').trim();
  if (!reason) throw new HttpError(400, 'Enter the reason for cancelling the plan.');
  const batch = await Batch.findOne({ _id: batchId });
  if (!batch) throw notFound('Delivery');
  if (!batch.paymentPlan || batch.paymentPlan.cancelledAt) throw new HttpError(400, 'This delivery has no installment plan.');
  const updated = await Batch.findOneAndUpdate(
    { _id: batch._id, 'paymentPlan.cancelledAt': null },
    { $set: { 'paymentPlan.cancelledAt': new Date(), 'paymentPlan.cancelledByName': ctx.userName, 'paymentPlan.cancelReason': reason }, $inc: { ledgerVersion: 1 } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new HttpError(409, 'This plan was just changed by someone else.');
  await recordAudit({
    action: 'update', entityType: 'PaymentPlan', entityId: batch._id, entityLabel: `${batch.batchNo} installment plan`,
    changes: [{ field: 'status', from: 'active', to: `cancelled: ${reason}` }],
  });
  return updated;
}

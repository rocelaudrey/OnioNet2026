import { Batch } from '../models/Batch.js';
import { Cooperative } from '../models/Cooperative.js';
import { Transaction } from '../models/Transaction.js';
import { getContext } from '../context.js';
import { ROLES } from '../lib/roles.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { PAYMENT_METHODS, TRANSACTION_TYPES } from '../../shared/statuses.js';
import { formatPHP } from '../../shared/money.js';
import { recordAudit } from './audit.js';
import { accountFor } from './fees.js';
import { nextNumber } from './sequences.js';
import { inTransaction } from './tx.js';

export const TYPE_LABELS = { payment: 'Payment', adjustment: 'Waiver or discount', refund: 'Refund' };
const MAX_AMOUNT = 100_000_000; // ₱1,000,000.00

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// "YYYY-MM-DD" from a date picker. Today means now; another day means noon.
function readDate(value, now) {
  if (value === undefined || value === null || value === '') return now;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new HttpError(400, 'Enter a valid date.');
  if (text === localDate(now)) return now;
  const date = new Date(`${text}T12:00:00`);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Enter a valid date.');
  if (date > now) throw new HttpError(400, 'The date cannot be in the future.');
  return date;
}

// Records money for one delivery: a payment, a waiver or discount, or a refund.
// The amount is checked against the balance from the fee service, inside a
// transaction that also bumps the delivery's ledgerVersion, so two people
// paying the same delivery at once cannot overpay it.
export async function recordTransaction(body = {}) {
  const ctx = getContext();
  const { type } = body;
  if (!TRANSACTION_TYPES.includes(type)) throw new HttpError(400, 'Choose a payment, a waiver or discount, or a refund.');
  if (type !== 'payment' && ctx.role !== ROLES.COOP_ADMIN) {
    throw new HttpError(403, 'Only a Cooperative Admin can record waivers, discounts, and refunds.');
  }
  const amount = body.amountCentavos;
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) throw new HttpError(400, 'Enter an amount more than ₱0.00.');

  let method;
  let referenceNo = String(body.referenceNo ?? '').trim() || undefined;
  if (type === 'adjustment') {
    referenceNo = undefined;
  } else {
    method = body.method;
    if (!PAYMENT_METHODS.includes(method)) throw new HttpError(400, 'Choose how the money was paid: cash, GCash, or bank.');
    if (method !== 'cash' && !referenceNo) throw new HttpError(400, 'Enter the GCash or bank reference number.');
  }
  const notes = String(body.notes ?? '').trim() || undefined;
  if (type === 'adjustment' && !notes) throw new HttpError(400, 'Enter the reason for this waiver or discount.');
  const now = new Date();
  const paidAt = readDate(body.paidAt, now);
  const requestId = String(body.clientRequestId ?? '').trim() || undefined;
  const coop = await Cooperative.findById(ctx.cooperativeId).select('settings.tagPrefix').lean();

  const run = () => inTransaction(async (session) => {
    const s = session ?? null;
    if (requestId) {
      const previous = await Transaction.findOne({ clientRequestId: requestId }).session(s).lean();
      if (previous) return { repeat: true, transaction: previous };
    }
    const batch = await Batch.findOne({ _id: body.batchId }).session(s);
    if (!batch) throw notFound('Delivery');
    if (batch.status === 'cancelled') throw new HttpError(400, 'This delivery was cancelled.');
    if (batch.ownerType === 'coop_owned') throw new HttpError(400, 'Cooperative stock has no fees, so there is nothing to pay.');
    const received = new Date(batch.receivedAt);
    received.setHours(0, 0, 0, 0);
    if (paidAt < received) throw new HttpError(400, 'The date cannot be before the delivery was received.');

    await Batch.updateOne({ _id: batch._id }, { $inc: { ledgerVersion: 1 } }, { session });
    const account = await accountFor(batch.toObject(), { session, asOf: now });
    const balance = account.balanceCentavos;
    if (type !== 'refund' && amount > balance) {
      throw new HttpError(400, balance > 0
        ? `The balance is ${formatPHP(balance)}. ${TYPE_LABELS[type]} cannot be more than that.`
        : 'This delivery has no balance to pay.');
    }
    if (type === 'refund') {
      const refundable = Math.max(0, account.paidCentavos - account.refundedCentavos);
      if (amount > refundable) throw new HttpError(400, `Only ${formatPHP(refundable)} has been paid that can be refunded.`);
    }

    const year = paidAt.getFullYear();
    const number = await nextNumber(`receipt:${year}`, { session });
    const receiptNo = `${coop.settings.tagPrefix}-R-${year}-${String(number).padStart(4, '0')}`;
    const [transaction] = await Transaction.create([{
      receiptNo, type, batchId: batch._id, memberId: batch.memberId, amountCentavos: amount,
      method, referenceNo, paidAt, recordedBy: ctx.userId, notes, clientRequestId: requestId,
    }], { session });
    await recordAudit({
      action: 'create', entityType: 'Transaction', entityId: transaction._id,
      entityLabel: `${receiptNo} (${TYPE_LABELS[type]}, ${batch.batchNo})`,
      changes: [{ field: 'amountCentavos', from: null, to: amount }],
    }, { session });
    return { repeat: false, transaction: transaction.toObject() };
  });

  try {
    return await run();
  } catch (err) {
    // Two identical requests racing: read back the one that was saved.
    if (err?.code !== 11000 || !requestId) throw err;
    const previous = await Transaction.findOne({ clientRequestId: requestId }).lean();
    if (!previous) throw err;
    return { repeat: true, transaction: previous };
  }
}

// A wrong entry is voided with a reason, never deleted.
export async function voidTransaction(id, reasonText) {
  const ctx = getContext();
  const reason = String(reasonText ?? '').trim();
  if (!reason) throw new HttpError(400, 'Enter the reason for voiding.');
  return inTransaction(async (session) => {
    const s = session ?? null;
    const transaction = await Transaction.findOne({ _id: id }).session(s);
    if (!transaction) throw notFound('Receipt');
    if (transaction.voided?.at) throw new HttpError(400, 'This entry is already voided.');
    const batch = await Batch.findOne({ _id: transaction.batchId }).session(s);
    await Batch.updateOne({ _id: batch._id }, { $inc: { ledgerVersion: 1 } }, { session });
    if (transaction.type === 'payment') {
      const account = await accountFor(batch.toObject(), { session });
      if (account.refundedCentavos > account.paidCentavos - transaction.amountCentavos) {
        throw new HttpError(400, 'Part of this payment was refunded. Void the refund first.');
      }
    }
    const updated = await Transaction.findOneAndUpdate(
      { _id: transaction._id, 'voided.at': null },
      { $set: { voided: { at: new Date(), by: ctx.userId, reason } } },
      { returnDocument: 'after', session },
    ).lean();
    if (!updated) throw new HttpError(409, 'This entry was just changed by someone else.');
    await recordAudit({
      action: 'void', entityType: 'Transaction', entityId: transaction._id,
      entityLabel: `${transaction.receiptNo} (${TYPE_LABELS[transaction.type]})`,
      changes: [{ field: 'voided', from: null, to: reason }],
    }, { session });
    return updated;
  });
}

import { Sack } from '../models/Sack.js';
import { Transaction } from '../models/Transaction.js';
import { DAY_MS, addMonths } from '../lib/dates.js';

// THE fee service. Every peso amount shown anywhere (delivery page, farmer
// page, inventory list, ledger, dashboard, reports, receipts) comes from
// computeCharges() and settle() here, so they always agree.
//
// Charges are never stored. They are worked out when read from:
//   - the fee rates copied onto the delivery at intake (batch.feeTerms)
//   - each sack's gate-in and gate-out times
//   - the time of reading (asOf), so overdue fees grow without scheduled jobs
// Money is integer centavos throughout.
//
// Rules:
//   Storage fee      rate x every sack received (covers the contract period)
//   Added fees       'sack': rate x sacks received
//                    'batch': rate once, when the delivery has at least one sack
//                    'sack_per_month': rate x months each sack is stored; every
//                    started month counts, at least one per sack
//   Member discount  % off the storage fee and added fees, rounded to the
//                    nearest centavo. Never on the overdue fee.
//   Overdue fee      rate x days each sack stays after the contract end; every
//                    started day counts. A released sack stops counting when
//                    it leaves.
//   Cancelled deliveries have no charges.

// Months a sack is stored: every started month counts, at least 1.
export function monthsStored(start, end) {
  if (!(end > start)) return 1;
  let months = 1;
  while (addMonths(start, months) < end && months < 1200) months += 1;
  return months;
}

// Days a sack stays past the contract end: every started day counts.
export function overdueDays(contractEnd, end) {
  const ms = end - contractEnd;
  return ms > 0 ? Math.ceil(ms / DAY_MS) : 0;
}

// percent may have up to 2 decimals (e.g. 12.5%). Rounded half up.
export function percentOf(centavos, percent) {
  return Math.round((centavos * Math.round(percent * 100)) / 10000);
}

const UNIT_FOR = { sack: 'sack', batch: 'delivery', sack_per_month: 'sack-month' };

export function computeCharges(batch, sacks, asOf = new Date()) {
  const terms = batch.feeTerms ?? {};
  const lines = [];
  const add = (key, label, quantity, unit, rate, discountable = true) => {
    lines.push({ key, label, quantity, unit, rateCentavos: rate, amountCentavos: quantity * rate, discountable });
  };
  const empty = batch.status === 'cancelled';
  const stays = empty ? [] : sacks.map((s) => ({
    start: new Date(s.gateInAt),
    end: s.gateOutAt ? new Date(s.gateOutAt) : asOf,
  }));
  const count = stays.length;

  add('storage', 'Storage fee', count, 'sack', terms.storageFeeCentavos ?? 0);
  (terms.added ?? []).forEach((fee, i) => {
    let quantity = 0;
    if (fee.chargedPer === 'sack') quantity = count;
    else if (fee.chargedPer === 'batch') quantity = count > 0 ? 1 : 0;
    else if (fee.chargedPer === 'sack_per_month') quantity = stays.reduce((sum, s) => sum + monthsStored(s.start, s.end), 0);
    add(`added:${i}`, fee.name, quantity, UNIT_FOR[fee.chargedPer] ?? 'item', fee.amountCentavos);
  });

  const subtotal = lines.reduce((sum, l) => sum + l.amountCentavos, 0);
  const discountPercent = terms.memberDiscountPercent ?? 0;
  const discount = percentOf(subtotal, discountPercent);

  let sackDays = 0;
  let overdueSacks = 0;
  if (batch.contractEnd) {
    const contractEnd = new Date(batch.contractEnd);
    for (const s of stays) {
      const days = overdueDays(contractEnd, s.end);
      sackDays += days;
      if (days > 0) overdueSacks += 1;
    }
  }
  const overdueRate = terms.overdueFeePerDayCentavos ?? 0;
  const overdue = sackDays * overdueRate;
  if (sackDays > 0) add('overdue', 'Overdue fee', sackDays, 'sack-day', overdueRate, false);

  return {
    lines,
    subtotalCentavos: subtotal,
    discountPercent,
    discountCentavos: discount,
    overdueCentavos: overdue,
    overdueSacks,
    overdueSackDays: sackDays,
    totalCentavos: subtotal - discount + overdue,
    asOf,
  };
}

export const CHARGE_LABELS = { hauling: 'Hauling fee', overdue: 'Overdue charge', other: 'Other charge' };

// Adds the manual charges staff entered (hauling, overdue, other), then what
// was paid, waived or discounted, and refunded. Voided entries do not count.
// Manual charges are never discounted. balance > 0 is owed; < 0 is a credit.
export function settle(charges, transactions) {
  let paid = 0;
  let adjusted = 0;
  let refunded = 0;
  let manual = 0;
  let manualOverdue = 0;
  const manualLines = [];
  for (const t of transactions) {
    if (t.voided?.at) continue;
    if (t.type === 'payment') paid += t.amountCentavos;
    else if (t.type === 'adjustment') adjusted += t.amountCentavos;
    else if (t.type === 'refund') refunded += t.amountCentavos;
    else if (t.type === 'charge') {
      manual += t.amountCentavos;
      if (t.chargeKind === 'overdue') manualOverdue += t.amountCentavos;
      manualLines.push({
        key: `charge:${t._id ?? manualLines.length}`, label: CHARGE_LABELS[t.chargeKind] ?? 'Charge', note: t.notes ?? '',
        date: t.paidAt ?? null, quantity: 1, unit: 'charge', rateCentavos: t.amountCentavos, amountCentavos: t.amountCentavos,
        discountable: false, manual: true,
      });
    }
  }
  const total = charges.totalCentavos + manual;
  return {
    ...charges,
    lines: [...(charges.lines ?? []), ...manualLines],
    manualCentavos: manual,
    // Overdue in all: the built-in daily fee plus overdue charges added by hand.
    autoOverdueCentavos: charges.overdueCentavos ?? 0,
    overdueCentavos: (charges.overdueCentavos ?? 0) + manualOverdue,
    totalCentavos: total,
    paidCentavos: paid,
    adjustedCentavos: adjusted,
    refundedCentavos: refunded,
    balanceCentavos: total - paid - adjusted + refunded,
  };
}

// ----- Installment plans -----

// A due date is late once that whole day has passed.
const endOfDay = (date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

// Progress of an installment plan. Money paid, waived, or discounted after
// the plan was set up (minus refunds, ignoring voided entries) is applied to
// the installments in due-date order. A plan covers the balance at the time
// it was set up; anything owed since (such as new overdue fees) is shown as
// not covered.
export function planProgress(plan, transactions, account, asOf = new Date()) {
  if (!plan || plan.cancelledAt) return null;
  const since = new Date(plan.createdAt);
  let covered = 0;
  for (const t of transactions) {
    // Charges added later raise the balance; they are not money toward the plan.
    if (t.voided?.at || t.type === 'charge' || new Date(t.createdAt) < since) continue;
    if (t.type === 'refund') covered -= t.amountCentavos;
    else covered += t.amountCentavos;
  }
  let left = Math.max(0, covered);
  let next = null;
  let dueShown = false; // the first unpaid installment that is not yet late is "due"
  const installments = plan.installments.map((inst, i) => {
    const paid = Math.min(inst.amountCentavos, left);
    left -= paid;
    let status = 'paid';
    if (paid < inst.amountCentavos) {
      if (asOf > endOfDay(inst.dueDate)) status = 'late';
      else if (!dueShown) { status = 'due'; dueShown = true; } else status = 'upcoming';
    }
    const row = { number: i + 1, dueDate: inst.dueDate, amountCentavos: inst.amountCentavos, paidCentavos: paid, status };
    if (status !== 'paid' && !next) next = row;
    return row;
  });
  const total = installments.reduce((sum, r) => sum + r.amountCentavos, 0);
  const paidTowardPlan = installments.reduce((sum, r) => sum + r.paidCentavos, 0);
  const remaining = total - paidTowardPlan;
  const late = installments.filter((r) => r.status === 'late');
  const done = remaining === 0 || account.balanceCentavos <= 0;
  return {
    status: done ? 'completed' : late.length ? 'late' : 'on_track',
    createdAt: plan.createdAt,
    createdByName: plan.createdByName,
    frequency: plan.frequency,
    notes: plan.notes ?? '',
    installments,
    totalCentavos: total,
    paidCentavos: paidTowardPlan,
    remainingCentavos: done ? 0 : remaining,
    lateCount: done ? 0 : late.length,
    lateCentavos: done ? 0 : late.reduce((sum, r) => sum + r.amountCentavos - r.paidCentavos, 0),
    next: done ? null : next,
    notCoveredCentavos: Math.max(0, account.balanceCentavos - (done ? 0 : remaining)),
  };
}

// Accounts for many deliveries at once (lean batches with feeTerms, status,
// contractEnd). Returns Map(batchId string -> account).
export async function loadAccounts(batches, { asOf = new Date(), session } = {}) {
  const out = new Map();
  if (!batches.length) return out;
  const ids = batches.map((b) => b._id);
  const [sacks, transactions] = await Promise.all([
    Sack.find({ batchId: { $in: ids } }).select('batchId gateInAt gateOutAt').session(session ?? null).lean(),
    Transaction.find({ batchId: { $in: ids } }).select('batchId type chargeKind amountCentavos notes paidAt voided createdAt').sort({ paidAt: 1, _id: 1 }).session(session ?? null).lean(),
  ]);
  const group = (rows) => {
    const map = new Map(ids.map((id) => [String(id), []]));
    for (const row of rows) map.get(String(row.batchId))?.push(row);
    return map;
  };
  const sacksBy = group(sacks);
  const txBy = group(transactions);
  for (const batch of batches) {
    const key = String(batch._id);
    const account = settle(computeCharges(batch, sacksBy.get(key), asOf), txBy.get(key));
    account.plan = planProgress(batch.paymentPlan, txBy.get(key), account, asOf);
    out.set(key, account);
  }
  return out;
}

export async function accountFor(batch, options) {
  return (await loadAccounts([batch], options)).get(String(batch._id));
}

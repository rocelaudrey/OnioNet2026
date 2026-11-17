import { Batch } from '../models/Batch.js';
import { Transaction } from '../models/Transaction.js';
import { loadAccounts } from './fees.js';

// Cooperative-wide money totals, from the fee service. Shared by the
// Transactions page and the dashboard so both always show the same numbers.
export async function moneySummary(now = new Date()) {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Collections count payments minus refunds, ignoring voided entries.
  const collected = async (since) => {
    const rows = await Transaction.aggregate([
      { $match: { 'voided.at': null, paidAt: { $gte: since }, type: { $in: ['payment', 'refund'] } } },
      { $group: { _id: '$type', total: { $sum: '$amountCentavos' } } },
    ]);
    const by = Object.fromEntries(rows.map((r) => [r._id, r.total]));
    return (by.payment ?? 0) - (by.refund ?? 0);
  };

  const batches = await Batch.find({ status: { $ne: 'cancelled' }, ownerType: { $ne: 'coop_owned' } }).lean();
  const accounts = await loadAccounts(batches, { asOf: now });
  const out = {
    outstandingCentavos: 0, unpaidDeliveries: 0, overdueFeesCentavos: 0, latePlans: 0, lateInstallmentsCentavos: 0,
  };
  for (const account of accounts.values()) {
    if (account.plan?.status === 'late') {
      out.latePlans += 1;
      out.lateInstallmentsCentavos += account.plan.lateCentavos;
    }
    if (account.balanceCentavos > 0) {
      out.outstandingCentavos += account.balanceCentavos;
      out.unpaidDeliveries += 1;
    }
    out.overdueFeesCentavos += account.overdueCentavos;
  }
  const [today, month] = await Promise.all([collected(startOfDay), collected(startOfMonth)]);
  return { collectedTodayCentavos: today, collectedThisMonthCentavos: month, ...out };
}

import { addressLine } from '../lib/address.js';
import { Batch } from '../models/Batch.js';
import { Member } from '../models/Member.js';
import { Sack } from '../models/Sack.js';
import { Transaction } from '../models/Transaction.js';
import { transactionView } from '../routes/transactions.js';
import { loadAccounts } from './fees.js';

// Sacks received and still stored, per delivery.
export async function storedByBatch(batchIds) {
  const rows = await Sack.aggregate([
    { $match: { batchId: { $in: batchIds } } },
    { $group: { _id: '$batchId', received: { $sum: 1 }, stored: { $sum: { $cond: [{ $eq: ['$status', 'stored'] }, 1, 0] } } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { received: r.received, stored: r.stored }]));
}

// Farmers with their deliveries and balances, from the fee service.
export async function farmerAccounts(memberFilter = {}) {
  const members = await Member.find(memberFilter).sort({ lastName: 1, firstName: 1 }).lean();
  const ids = members.map((m) => m._id);
  const batches = await Batch.find({ memberId: { $in: ids }, status: { $ne: 'cancelled' } }).sort({ receivedAt: 1 }).lean();
  const [accounts, counts] = await Promise.all([loadAccounts(batches), storedByBatch(batches.map((b) => b._id))]);
  return { members, batches, accounts, counts };
}

// One farmer's statement: every delivery with its charges and payments.
// The cooperative's Statement of Account report and the farmer's own "My Fees"
// page both use this, so they always agree. forFarmer leaves out staff names.
export async function statementFor(memberId, { forFarmer = false } = {}) {
  const { members, batches, accounts, counts } = await farmerAccounts({ _id: memberId });
  const member = members[0];
  if (!member) return null;
  const now = new Date();
  const transactions = await Transaction.find({ batchId: { $in: batches.map((b) => b._id) } }).sort({ paidAt: 1, _id: 1 })
    .populate('recordedBy', 'name').populate('batchId', 'batchNo').populate('memberId', 'firstName lastName').lean();
  const deliveries = batches.map((b) => {
    const account = accounts.get(String(b._id));
    const c = counts.get(String(b._id)) ?? { received: 0, stored: 0 };
    return {
      id: b._id, batchNo: b.batchNo, status: b.status, receivedAt: b.receivedAt, contractEnd: b.contractEnd,
      variety: b.variety ?? '', sacksReceived: c.received, sacksStored: c.stored,
      overdue: c.stored > 0 && b.contractEnd < now,
      // Farmers do not see staff names or the cooperative's internal void reasons.
      account: forFarmer && account.plan ? { ...account, plan: { ...account.plan, createdByName: undefined } } : account,
      transactions: transactions.filter((t) => String(t.batchId._id) === String(b._id)).map((t) => {
        const v = transactionView(t);
        if (forFarmer) {
          delete v.recordedByName;
          delete v.voidReason;
        }
        return v;
      }),
    };
  });
  const total = (key) => deliveries.reduce((s, d) => s + d.account[key], 0);
  return {
    generatedAt: now,
    member: {
      memberNo: member.memberNo, name: `${member.firstName} ${member.lastName}`.trim(), tier: member.tier, phone: member.phone ?? '',
      address: addressLine(member.address),
    },
    totals: {
      chargesCentavos: total('totalCentavos'), paidCentavos: total('paidCentavos'), adjustedCentavos: total('adjustedCentavos'),
      refundedCentavos: total('refundedCentavos'), balanceCentavos: total('balanceCentavos'),
      sacksStored: deliveries.reduce((s, d) => s + d.sacksStored, 0),
    },
    deliveries,
  };
}

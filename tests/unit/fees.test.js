import { describe, it, expect } from 'vitest';
import { computeCharges, monthsStored, overdueDays, percentOf, settle } from '../../server/services/fees.js';

const DAY = 86_400_000;
const asOf = new Date(2026, 10, 14, 12, 0, 0);
const daysAgo = (n) => new Date(asOf.getTime() - n * DAY);
const sacks = (count, gateInAt, gateOutAt = null) => Array.from({ length: count }, () => ({ gateInAt, gateOutAt }));
const terms = (over = {}) => ({ storageFeeCentavos: 15000, overdueFeePerDayCentavos: 200, memberDiscountPercent: 0, added: [], ...over });
const batch = (over = {}) => ({ status: 'stored', contractEnd: new Date(asOf.getTime() + 30 * DAY), feeTerms: terms(), ...over });

describe('monthsStored', () => {
  it('counts every started month, at least one', () => {
    const start = new Date(2026, 0, 15);
    expect(monthsStored(start, start)).toBe(1);
    expect(monthsStored(start, new Date(2026, 0, 16))).toBe(1);
    expect(monthsStored(start, new Date(2026, 1, 15))).toBe(1);   // exactly one month
    expect(monthsStored(start, new Date(2026, 1, 15, 0, 1))).toBe(2);
    expect(monthsStored(start, new Date(2026, 4, 1))).toBe(4);
    expect(monthsStored(new Date(2026, 0, 31), new Date(2026, 1, 28))).toBe(1); // short month
  });
});

describe('overdueDays', () => {
  it('counts every started day after the contract end', () => {
    const end = new Date(2026, 5, 1);
    expect(overdueDays(end, new Date(2026, 4, 30))).toBe(0);
    expect(overdueDays(end, end)).toBe(0);
    expect(overdueDays(end, new Date(end.getTime() + 1))).toBe(1);
    expect(overdueDays(end, new Date(end.getTime() + DAY))).toBe(1);
    expect(overdueDays(end, new Date(end.getTime() + DAY + 1))).toBe(2);
  });
});

describe('percentOf', () => {
  it('rounds to the nearest centavo, half up, and allows 2 decimals', () => {
    expect(percentOf(15000, 10)).toBe(1500);
    expect(percentOf(105, 10)).toBe(11);    // 10.5 -> 11
    expect(percentOf(104, 10)).toBe(10);    // 10.4 -> 10
    expect(percentOf(10000, 12.5)).toBe(1250);
    expect(percentOf(333, 33.33)).toBe(111);
    expect(percentOf(0, 50)).toBe(0);
    expect(percentOf(12345, 0)).toBe(0);
  });
});

describe('computeCharges', () => {
  it('charges the storage fee per sack received', () => {
    const c = computeCharges(batch(), sacks(12, daysAgo(10)), asOf);
    expect(c.lines).toEqual([{ key: 'storage', label: 'Storage fee', quantity: 12, unit: 'sack', rateCentavos: 15000, amountCentavos: 180000, discountable: true }]);
    expect(c).toMatchObject({ subtotalCentavos: 180000, discountCentavos: 0, overdueCentavos: 0, totalCentavos: 180000 });
  });

  it('charges added fees per sack, per delivery, and per sack per started month', () => {
    const added = [
      { name: 'Handling', amountCentavos: 500, chargedPer: 'sack' },
      { name: 'Loading', amountCentavos: 2000, chargedPer: 'batch' },
      { name: 'Cooling', amountCentavos: 1000, chargedPer: 'sack_per_month' },
    ];
    // 4 sacks in for 100 days (4 started months); 1 sack in for 20 days (1 month).
    const list = [...sacks(4, daysAgo(100)), ...sacks(1, daysAgo(20))];
    const c = computeCharges(batch({ feeTerms: terms({ added }) }), list, asOf);
    expect(c.lines.map((l) => [l.label, l.quantity, l.unit, l.amountCentavos])).toEqual([
      ['Storage fee', 5, 'sack', 75000],
      ['Handling', 5, 'sack', 2500],
      ['Loading', 1, 'delivery', 2000],
      ['Cooling', 17, 'sack-month', 17000],
    ]);
    expect(c.totalCentavos).toBe(96500);
  });

  it('gives the member discount on storage and added fees, but never on the overdue fee', () => {
    const b = batch({
      contractEnd: daysAgo(5.5), // every sack is 6 started days overdue
      feeTerms: terms({ memberDiscountPercent: 10, added: [{ name: 'Handling', amountCentavos: 500, chargedPer: 'sack' }] }),
    });
    const c = computeCharges(b, sacks(10, daysAgo(100)), asOf);
    expect(c).toMatchObject({
      subtotalCentavos: 155000, discountPercent: 10, discountCentavos: 15500,
      overdueSacks: 10, overdueSackDays: 60, overdueCentavos: 12000,
      totalCentavos: 155000 - 15500 + 12000,
    });
    expect(c.lines.at(-1)).toMatchObject({ key: 'overdue', quantity: 60, unit: 'sack-day', rateCentavos: 200, amountCentavos: 12000, discountable: false });
  });

  it('stops the overdue fee and monthly fees when a sack is released', () => {
    const contractEnd = daysAgo(10.5);
    const added = [{ name: 'Cooling', amountCentavos: 1000, chargedPer: 'sack_per_month' }];
    const list = [
      ...sacks(2, daysAgo(100), daysAgo(60)),   // left before the contract ended: 2 months, no overdue
      ...sacks(1, daysAgo(100), daysAgo(5.5)),  // left 5 days late: 6 started days
      ...sacks(1, daysAgo(100)),                // still stored: 11 started days
    ];
    const c = computeCharges(batch({ contractEnd, feeTerms: terms({ added }) }), list, asOf);
    expect(c.overdueSackDays).toBe(5 + 11);
    expect(c.overdueSacks).toBe(2);
    expect(c.lines.find((l) => l.label === 'Cooling').quantity).toBe(2 * 2 + 4 + 4);
    expect(c.lines.find((l) => l.key === 'storage').quantity).toBe(4); // storage covers every sack received
  });

  it('grows the overdue fee over time without anything being saved', () => {
    const b = batch({ contractEnd: daysAgo(1) });
    const list = sacks(3, daysAgo(100));
    const today = computeCharges(b, list, asOf).overdueCentavos;
    const nextWeek = computeCharges(b, list, new Date(asOf.getTime() + 7 * DAY)).overdueCentavos;
    expect(today).toBe(3 * 1 * 200);
    expect(nextWeek).toBe(3 * 8 * 200);
  });

  it('shows the overdue days even when the overdue fee is zero', () => {
    const c = computeCharges(batch({ contractEnd: daysAgo(2), feeTerms: terms({ overdueFeePerDayCentavos: 0 }) }), sacks(1, daysAgo(50)), asOf);
    expect(c).toMatchObject({ overdueSackDays: 2, overdueCentavos: 0 });
  });

  it('charges nothing for coop stock, for a delivery with no sacks yet, or a cancelled one', () => {
    const zero = { storageFeeCentavos: 0, overdueFeePerDayCentavos: 0, memberDiscountPercent: 0, added: [] };
    expect(computeCharges(batch({ ownerType: 'coop_owned', feeTerms: zero }), sacks(5, daysAgo(400)), asOf).totalCentavos).toBe(0);
    const withBatchFee = batch({ feeTerms: terms({ added: [{ name: 'Loading', amountCentavos: 2000, chargedPer: 'batch' }] }) });
    expect(computeCharges(withBatchFee, [], asOf).totalCentavos).toBe(0);
    expect(computeCharges({ ...batch(), status: 'cancelled' }, sacks(2, daysAgo(5)), asOf).totalCentavos).toBe(0);
  });

  it('works only in whole centavos', () => {
    const c = computeCharges(batch({ feeTerms: terms({ storageFeeCentavos: 3333, memberDiscountPercent: 12.5 }) }), sacks(7, daysAgo(3)), asOf);
    for (const value of [c.subtotalCentavos, c.discountCentavos, c.totalCentavos]) expect(Number.isInteger(value)).toBe(true);
    expect(c.discountCentavos).toBe(2916); // 23331 x 12.5% = 2916.375
  });
});

describe('settle', () => {
  const charges = { totalCentavos: 100000 };
  it('subtracts payments and waivers, adds refunds, and ignores voided entries', () => {
    const account = settle(charges, [
      { type: 'payment', amountCentavos: 60000 },
      { type: 'payment', amountCentavos: 5000, voided: { at: new Date() } },
      { type: 'adjustment', amountCentavos: 10000 },
      { type: 'refund', amountCentavos: 2500 },
      { type: 'payment', amountCentavos: 9999, voided: { at: null } },
    ]);
    expect(account).toMatchObject({ paidCentavos: 69999, adjustedCentavos: 10000, refundedCentavos: 2500, balanceCentavos: 100000 - 69999 - 10000 + 2500 });
  });
  it('shows a credit as a negative balance', () => {
    expect(settle(charges, [{ type: 'payment', amountCentavos: 120000 }]).balanceCentavos).toBe(-20000);
  });
});

import { planProgress } from '../../server/services/fees.js';
import { splitEvenly } from '../../server/services/plans.js';

describe('splitEvenly', () => {
  it('splits into whole centavos, with the leftover on the last installment', () => {
    expect(splitEvenly(100000, 3)).toEqual([33333, 33333, 33334]);
    expect(splitEvenly(90000, 3)).toEqual([30000, 30000, 30000]);
    expect(splitEvenly(119600, 4).reduce((a, b) => a + b, 0)).toBe(119600);
  });
});

describe('planProgress', () => {
  const created = new Date(2026, 9, 1, 9, 0);
  const plan = {
    createdAt: created, createdByName: 'Admin', frequency: 'monthly',
    installments: [
      { dueDate: new Date(2026, 9, 15, 12), amountCentavos: 30000 },
      { dueDate: new Date(2026, 10, 15, 12), amountCentavos: 30000 },
      { dueDate: new Date(2026, 11, 15, 12), amountCentavos: 30000 },
    ],
  };
  const tx = (type, amountCentavos, createdAt, voided) => ({ type, amountCentavos, createdAt, voided: voided ? { at: createdAt } : undefined });
  const after = new Date(2026, 9, 2);

  it('applies money paid after the plan to installments in due-date order', () => {
    const p = planProgress(plan, [tx('payment', 45000, after)], { balanceCentavos: 45000 }, new Date(2026, 9, 20));
    expect(p.installments.map((r) => [r.paidCentavos, r.status])).toEqual([[30000, 'paid'], [15000, 'due'], [0, 'upcoming']]);
    expect(p).toMatchObject({ status: 'on_track', paidCentavos: 45000, remainingCentavos: 45000, next: { number: 2 }, notCoveredCentavos: 0 });
  });

  it('marks an installment late only after its whole due day has passed', () => {
    const onDueDay = planProgress(plan, [], { balanceCentavos: 90000 }, new Date(2026, 9, 15, 23, 0));
    expect(onDueDay.installments[0].status).toBe('due');
    const dayAfter = planProgress(plan, [], { balanceCentavos: 90000 }, new Date(2026, 9, 16, 0, 1));
    expect(dayAfter).toMatchObject({ status: 'late', lateCount: 1, lateCentavos: 30000 });
    expect(dayAfter.installments.map((r) => r.status)).toEqual(['late', 'due', 'upcoming']);
  });

  it('ignores money from before the plan and voided entries; waivers count and refunds take away', () => {
    const before = new Date(2026, 8, 30);
    const p = planProgress(plan, [
      tx('payment', 50000, before),
      tx('payment', 30000, after, true),
      tx('adjustment', 20000, after),
      tx('payment', 15000, after),
      tx('refund', 5000, after),
    ], { balanceCentavos: 60000 }, new Date(2026, 9, 10));
    expect(p.paidCentavos).toBe(30000);
    expect(p.installments[0].status).toBe('paid');
  });

  it('shows new charges since the plan as not covered', () => {
    // 30,000 paid toward the plan, but the balance is 70,000 because of new overdue fees.
    const p = planProgress(plan, [tx('payment', 30000, after)], { balanceCentavos: 70000 }, new Date(2026, 9, 10));
    expect(p).toMatchObject({ remainingCentavos: 60000, notCoveredCentavos: 10000 });
  });

  it('is completed when the plan or the whole balance is paid, and absent when cancelled', () => {
    expect(planProgress(plan, [tx('payment', 90000, after)], { balanceCentavos: 0 }, new Date(2027, 0, 1)))
      .toMatchObject({ status: 'completed', lateCount: 0, next: null });
    expect(planProgress(plan, [], { balanceCentavos: 0 }, new Date(2027, 0, 1)).status).toBe('completed');
    expect(planProgress({ ...plan, cancelledAt: new Date() }, [], { balanceCentavos: 90000 })).toBeNull();
    expect(planProgress(null, [], { balanceCentavos: 1 })).toBeNull();
  });
});

describe('manual charges', () => {
  it('add to the total, are never discounted, and show as their own lines', () => {
    const charges = computeCharges(batch({ feeTerms: terms({ memberDiscountPercent: 10 }) }), sacks(2, daysAgo(5)), asOf);
    const account = settle(charges, [
      { _id: 'h', type: 'charge', chargeKind: 'hauling', amountCentavos: 4000, notes: '₱20 × 2 sacks', paidAt: daysAgo(5) },
      { _id: 'o', type: 'charge', chargeKind: 'overdue', amountCentavos: 1000, voided: { at: new Date() } },
      { type: 'payment', amountCentavos: 10000 },
    ]);
    expect(account.manualCentavos).toBe(4000);
    expect(account.totalCentavos).toBe(30000 - 3000 + 4000);
    expect(account.balanceCentavos).toBe(31000 - 10000);
    expect(account.lines.at(-1)).toMatchObject({ key: 'charge:h', label: 'Hauling fee', note: '₱20 × 2 sacks', amountCentavos: 4000, manual: true, discountable: false });
    expect(account.lines.filter((l) => l.manual)).toHaveLength(1); // the voided one is left out
  });

  it('do not count as money paid toward an installment plan', () => {
    const plan = { createdAt: new Date(2026, 9, 1), createdByName: 'A', frequency: 'monthly', installments: [{ dueDate: new Date(2026, 10, 1), amountCentavos: 10000 }] };
    const p = planProgress(plan, [{ type: 'charge', amountCentavos: 50000, createdAt: new Date(2026, 9, 2) }], { balanceCentavos: 60000 }, new Date(2026, 9, 3));
    expect(p).toMatchObject({ paidCentavos: 0, remainingCentavos: 10000, notCoveredCentavos: 50000 });
  });
});

describe('overdue charges added by hand', () => {
  it('count toward the overdue total but not the built-in daily fee', () => {
    const charges = { totalCentavos: 10000, overdueCentavos: 500, lines: [] };
    const a = settle(charges, [
      { type: 'charge', chargeKind: 'overdue', amountCentavos: 3000 },
      { type: 'charge', chargeKind: 'hauling', amountCentavos: 2000 },
      { type: 'charge', chargeKind: 'overdue', amountCentavos: 999, voided: { at: new Date() } },
    ]);
    expect(a.autoOverdueCentavos).toBe(500);
    expect(a.overdueCentavos).toBe(3500);
    expect(a.totalCentavos).toBe(15000);
  });
});

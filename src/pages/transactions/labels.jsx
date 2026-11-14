import { Badge } from '../../components/ui.jsx';

export const TYPE_LABELS = { payment: 'Payment', adjustment: 'Waiver or discount', refund: 'Refund' };
export const METHOD_LABELS = { cash: 'Cash', gcash: 'GCash', bank: 'Bank transfer' };

export function TypeBadge({ type, voided }) {
  if (voided) return <Badge>Voided</Badge>;
  const color = { payment: 'green', adjustment: 'purple', refund: 'orange' }[type] ?? 'gray';
  return <Badge color={color}>{TYPE_LABELS[type] ?? type}</Badge>;
}

const UNITS = { sack: ['sack', 'sacks'], delivery: ['delivery', 'deliveries'], 'sack-month': ['sack-month', 'sack-months'], 'sack-day': ['sack-day', 'sack-days'] };
export function quantityText(quantity, unit) {
  const [one, many] = UNITS[unit] ?? [unit, unit];
  return `${quantity.toLocaleString('en-US')} ${quantity === 1 ? one : many}`;
}

// Balance in words and color: owed (red), paid (green), credit (purple).
export function BalanceText({ centavos, format }) {
  if (centavos > 0) return <span className="font-semibold text-critical">{format(centavos)}</span>;
  if (centavos < 0) return <span className="font-semibold text-brand-purple">{format(-centavos)} credit</span>;
  return <span className="font-semibold text-brand-green">Paid</span>;
}

export const FREQUENCY_LABELS = { monthly: 'Monthly', every_2_weeks: 'Every 2 weeks', weekly: 'Weekly' };

// Installment plan status. Completed plans need no badge in lists.
export function PlanBadge({ status, showCompleted = false }) {
  if (status === 'late') return <Badge color="red">Installment late</Badge>;
  if (status === 'on_track') return <Badge color="purple">On installments</Badge>;
  if (status === 'completed' && showCompleted) return <Badge color="green">Plan paid</Badge>;
  return null;
}

export const INSTALLMENT_STATUS = {
  paid: ['Paid', 'green'],
  due: ['Due', 'amber'],
  upcoming: ['Upcoming', 'gray'],
  late: ['Late', 'red'],
};

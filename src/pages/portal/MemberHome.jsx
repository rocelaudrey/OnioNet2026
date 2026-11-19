import { Link } from 'react-router-dom';
import { CalendarClock, ChevronRight, Package, Receipt, Warehouse } from 'lucide-react';
import { Card, EmptyState } from '../../components/Card.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { Badge, Notice } from '../../components/ui.jsx';
import { date, formatPHP, number } from '../../lib/format.js';
import { useLoad } from '../../lib/useLoad.js';
import { BATCH_STATUS } from '../inventory/labels.jsx';

export function balanceWords(c) {
  if (c > 0) return formatPHP(c);
  if (c < 0) return `${formatPHP(-c)} credit`;
  return 'Paid';
}

export function DeliveryCard({ d }) {
  return (
    <Link to={`/my-batches/${d.id}`} className="flex items-center gap-3 rounded-xl border border-line p-4 hover:bg-page">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-green-tint text-brand-green"><Package size={18} /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{d.batchNo}</span>
        <span className="block text-sm text-muted">
          {number(d.sacksStored)} of {number(d.sacksReceived)} sacks in storage · received {date(d.receivedAt)}
        </span>
        <span className="mt-1 flex flex-wrap gap-1">
          <Badge color={BATCH_STATUS[d.status]?.[1] ?? 'gray'}>{BATCH_STATUS[d.status]?.[0] ?? d.status}</Badge>
          {d.overdue && <Badge color="red">Past contract end</Badge>}
          {d.balanceCentavos > 0 && <Badge color="amber">Owes {formatPHP(d.balanceCentavos)}</Badge>}
          {d.planStatus === 'late' && <Badge color="red">Installment late</Badge>}
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-muted" />
    </Link>
  );
}

// The farmer's home page: their own storage at a glance, in plain words.
export default function MemberHome() {
  const { data, error } = useLoad('/me/summary');
  if (error) return <Notice>{error}</Notice>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const s = data;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="My Sacks in Storage" value={number(s.sacksStored)} icon={Package} color="green" trend={`in ${number(s.deliveriesInStorage)} ${s.deliveriesInStorage === 1 ? 'delivery' : 'deliveries'}`} />
        <StatCard label="My Deliveries" value={number(s.deliveries)} icon={Warehouse} color="purple" />
        <StatCard label="Balance" value={balanceWords(s.balanceCentavos)} icon={Receipt} color={s.balanceCentavos > 0 ? 'orange' : 'green'} />
        <StatCard label="Next Contract End" value={s.nextContractEnd ? date(s.nextContractEnd) : 'None'} icon={CalendarClock} color={s.overdueDeliveries ? 'red' : 'green'} trend={s.overdueDeliveries ? 'Past due' : undefined} />
      </div>

      {s.overdueDeliveries > 0 && (
        <Notice>
          {s.overdueDeliveries === 1 ? 'One of your deliveries is' : `${s.overdueDeliveries} of your deliveries are`} past the contract end. An overdue fee is added every day the sacks stay. Talk to the cooperative office about releasing them.
        </Notice>
      )}
      {s.nextInstallment && (
        <Notice kind={s.lateInstallments ? 'error' : 'warning'}>
          {s.lateInstallments ? 'You have a late installment. ' : ''}Next installment: {formatPHP(s.nextInstallment.amountCentavos)} due {date(s.nextInstallment.dueDate)} for {s.nextInstallment.batchNo}.
        </Notice>
      )}

      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base">My Recent Deliveries</h2>
          {s.deliveries > s.recent.length && <Link to="/my-batches" className="text-sm font-medium text-brand-green hover:underline">See all</Link>}
        </div>
        {s.recent.length === 0
          ? <EmptyState icon={Package} title="No deliveries yet" detail="Your deliveries will show here once the cooperative receives your onions." />
          : <div className="space-y-3">{s.recent.map((d) => <DeliveryCard key={d.id} d={d} />)}</div>}
      </Card>
    </>
  );
}

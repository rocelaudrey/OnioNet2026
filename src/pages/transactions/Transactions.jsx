import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, CircleDollarSign, Plus, Receipt, Search, Wallet } from 'lucide-react';
import { Card, EmptyState } from '../../components/Card.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { Button, Notice, Table, Td, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { date, formatPHP, number } from '../../lib/format.js';
import { useLoad } from '../../lib/useLoad.js';
import RecordPayment from './RecordPayment.jsx';
import { METHOD_LABELS, TYPE_LABELS, TypeBadge } from './labels.jsx';

export default function Transactions() {
  const navigate = useNavigate();
  const summary = useLoad('/transactions/summary');
  const [filters, setFilters] = useState({ q: '', type: '', status: '', from: '', to: '', page: 1 });
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const [recording, setRecording] = useState(false);

  // Farmer names are searched in the request body, never in the address.
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      api('/transactions/search', { method: 'POST', body: filters })
        .then((data) => current && setState({ data, error: '', loading: false }))
        .catch((err) => current && setState((st) => ({ ...st, error: err.message, loading: false })));
    }, filters.q ? 300 : 0);
    return () => { current = false; clearTimeout(timer); };
  }, [filters]);

  const set = (field) => (e) => setFilters({ ...filters, [field]: e.target.value, page: 1 });
  const s = summary.data;
  const peso = (v) => (s ? formatPHP(v) : '—');
  const { data, error, loading } = state;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Object.entries(filters).some(([k, v]) => k !== 'page' && v);

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle="Fees, payments, and receipts"
        action={<Button onClick={() => setRecording(true)}><Plus size={16} /> Record Payment</Button>}
      />
      <Notice>{summary.error}</Notice>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Collected Today" value={peso(s?.collectedTodayCentavos)} icon={Wallet} color="green" />
        <StatCard label="Collected This Month" value={peso(s?.collectedThisMonthCentavos)} icon={CalendarDays} color="purple" />
        <StatCard
          label="Unpaid Balances" value={peso(s?.outstandingCentavos)} icon={CircleDollarSign} color={s?.outstandingCentavos ? 'red' : 'gray'}
          trend={s ? `${number(s.unpaidDeliveries)} ${s.unpaidDeliveries === 1 ? 'delivery' : 'deliveries'}${s.latePlans ? ` · ${number(s.latePlans)} late on installments` : ''}` : undefined}
        />
        <StatCard label="Overdue Fees So Far" value={peso(s?.overdueFeesCentavos)} icon={Receipt} color="orange" />
      </div>

      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="relative sm:col-span-2">
            <span className="sr-only">Search</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" value={filters.q} onChange={set('q')} placeholder="Farmer, receipt, or delivery number" className={`${inputClass} mt-0 pl-9`} />
          </label>
          <select aria-label="Type" value={filters.type} onChange={set('type')} className={`${inputClass} mt-0`}>
            <option value="">All types</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs text-muted">
            From
            <input type="date" value={filters.from} onChange={set('from')} className={`${inputClass} mt-0 flex-1`} />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            To
            <input type="date" value={filters.to} onChange={set('to')} className={`${inputClass} mt-0 flex-1`} />
          </label>
        </div>
        <label className="mb-4 flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox" className="h-4 w-4 accent-brand-green" checked={filters.status === 'valid'}
            onChange={(e) => setFilters({ ...filters, status: e.target.checked ? 'valid' : '', page: 1 })}
          />
          Hide voided entries
        </label>

        <Notice>{error}</Notice>
        {loading && <p className="py-6 text-center text-sm text-muted">Loading…</p>}

        {data && data.transactions.length > 0 && (
          <Table minWidth={820} columns={['Receipt No.', 'Date', 'Farmer', 'Delivery', 'Type', 'Paid by', 'Amount']}>
            {data.transactions.map((t) => (
              <tr
                key={t.id} tabIndex={0} role="link" aria-label={`Open receipt ${t.receiptNo}`}
                onClick={() => navigate(`/transactions/${t.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/transactions/${t.id}`)}
                className={`cursor-pointer hover:bg-page focus:bg-page focus:outline-none ${t.voided ? 'text-muted' : ''}`}
              >
                <Td className="whitespace-nowrap font-mono text-xs">{t.receiptNo}</Td>
                <Td className="whitespace-nowrap">{date(t.paidAt)}</Td>
                <Td className="font-medium">{t.ownerName}</Td>
                <Td className="whitespace-nowrap text-muted">{t.batchNo}</Td>
                <Td><TypeBadge type={t.type} voided={t.voided} /></Td>
                <Td>{t.method ? METHOD_LABELS[t.method] : ''}</Td>
                <Td className={`whitespace-nowrap text-right font-medium ${t.voided ? 'line-through' : ''}`}>{formatPHP(t.amountCentavos)}</Td>
              </tr>
            ))}
          </Table>
        )}

        {data && data.transactions.length === 0 && (filtered ? (
          <EmptyState icon={Search} title="Nothing matches" detail="Try a different name or number, or clear the filters." />
        ) : (
          <EmptyState icon={Receipt} title="No payments yet" detail="Payments, waivers, and refunds will be listed here." />
        ))}

        {data && data.total > data.pageSize && (
          <div className="mt-4 flex items-center justify-between text-sm text-muted">
            <span>Page {data.page} of {number(pages)} · {number(data.total)} entries</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={data.page <= 1} onClick={() => setFilters({ ...filters, page: data.page - 1 })}>Previous</Button>
              <Button variant="secondary" disabled={data.page >= pages} onClick={() => setFilters({ ...filters, page: data.page + 1 })}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      {recording && <RecordPayment onClose={() => setRecording(false)} onDone={(t) => navigate(`/transactions/${t.id}`)} />}
    </>
  );
}

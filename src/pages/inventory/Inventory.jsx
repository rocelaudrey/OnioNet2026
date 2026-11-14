import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, CalendarClock, Package, PackagePlus, Plus, Search, Warehouse } from 'lucide-react';
import { Card, EmptyState } from '../../components/Card.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { Button, CapacityBar, Notice, Table, Td, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { date, formatPHP, number } from '../../lib/format.js';
import { useLoad } from '../../lib/useLoad.js';
import IntakeForm from './IntakeForm.jsx';
import { BATCH_STATUS, BatchStatusBadge } from './labels.jsx';
import { PlanBadge } from '../transactions/labels.jsx';

export default function Inventory() {
  const navigate = useNavigate();
  const summary = useLoad('/batches/summary');
  const [filters, setFilters] = useState({ q: '', status: '', page: 1 });
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const [receiving, setReceiving] = useState(false);

  // Farmer names are searched in the request body, never in the address.
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      const body = { q: filters.q, page: filters.page, ...(filters.status === 'overdue' ? { overdue: true } : { status: filters.status }) };
      api('/batches/search', { method: 'POST', body })
        .then((data) => current && setState({ data, error: '', loading: false }))
        .catch((err) => current && setState((s) => ({ ...s, error: err.message, loading: false })));
    }, filters.q ? 300 : 0);
    return () => { current = false; clearTimeout(timer); };
  }, [filters]);

  const set = (field) => (e) => setFilters({ ...filters, [field]: e.target.value, page: 1 });
  const s = summary.data;
  const show = (n) => (s ? number(n) : '—');
  const { data, error, loading } = state;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Boolean(filters.q || filters.status);

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Sacks and deliveries in storage"
        action={(
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate('/inventory/move')}><ArrowLeftRight size={16} /> Move Sacks</Button>
            <Button onClick={() => setReceiving(true)} disabled={!s}><Plus size={16} /> Receive Delivery</Button>
          </div>
        )}
      />
      <Notice>{summary.error}</Notice>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Sacks in Storage" value={show(s?.stored)} icon={Package} color="green" />
        <StatCard label="Available Space" value={show(s?.available)} icon={Warehouse} color="purple" trend={s?.pending ? `${number(s.pending)} more expected` : undefined} />
        <StatCard label="Being Received" value={show(s?.receiving)} icon={PackagePlus} color="orange" />
        <StatCard label="Overdue Deliveries" value={show(s?.overdue)} icon={CalendarClock} color={s?.overdue ? 'red' : 'gray'} />
      </div>

      {s && (
        <Card title="Storage by Quadrant" className="mb-4">
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            {s.quadrants.filter((q) => q.active || q.used > 0).map((q) => (
              <div key={q.id}>
                <p className="mb-1 text-sm font-medium">{q.code}{!q.active && <span className="ml-2 text-xs font-normal text-muted">Turned off</span>}</p>
                <CapacityBar used={q.used} capacity={q.capacity} unit="" />
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Deliveries">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search deliveries</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" value={filters.q} onChange={set('q')} placeholder="Search by farmer or delivery number" className={`${inputClass} mt-0 pl-9`} />
          </label>
          <select aria-label="Status" value={filters.status} onChange={set('status')} className={`${inputClass} mt-0 sm:w-48`}>
            <option value="">All deliveries</option>
            {Object.entries(BATCH_STATUS).map(([value, [label]]) => <option key={value} value={value}>{label}</option>)}
            <option value="overdue">Overdue</option>
          </select>
        </div>

        <Notice>{error}</Notice>
        {loading && <p className="py-6 text-center text-sm text-muted">Loading…</p>}

        {data && data.batches.length > 0 && (
          <Table minWidth={860} columns={['Delivery No.', 'Owner', 'Received', 'Sacks in storage', 'Contract ends', 'Balance', 'Status']}>
            {data.batches.map((b) => (
              <tr
                key={b.id} tabIndex={0} role="link" aria-label={`Open delivery ${b.batchNo}`}
                onClick={() => navigate(`/inventory/${b.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/inventory/${b.id}`)}
                className="cursor-pointer hover:bg-page focus:bg-page focus:outline-none"
              >
                <Td className="whitespace-nowrap text-muted">{b.batchNo}</Td>
                <Td className="font-medium">{b.ownerName}</Td>
                <Td className="whitespace-nowrap">{date(b.receivedAt)}</Td>
                <Td className="whitespace-nowrap">
                  {b.status === 'receiving' ? `${number(b.sacksReceived)} of ${number(b.declaredSackCount)} scanned` : `${number(b.sacksStored)} of ${number(b.sacksReceived)}`}
                </Td>
                <Td className="whitespace-nowrap">{date(b.contractEnd)}</Td>
                <Td className={`whitespace-nowrap ${b.balanceCentavos > 0 ? 'font-medium text-critical' : 'text-muted'}`}>
                  {b.ownerType === 'coop_owned' ? '' : b.balanceCentavos > 0 ? formatPHP(b.balanceCentavos) : 'Paid'}
                  {b.planStatus && <span className="ml-2"><PlanBadge status={b.planStatus} /></span>}
                </Td>
                <Td><BatchStatusBadge batch={b} /></Td>
              </tr>
            ))}
          </Table>
        )}

        {data && data.batches.length === 0 && (filtered ? (
          <EmptyState icon={Search} title="No deliveries match" detail="Try a different name or number, or clear the filters." />
        ) : (
          <EmptyState icon={Package} title="No deliveries yet" detail="Receive your first delivery to start tracking sacks." />
        ))}

        {data && data.total > data.pageSize && (
          <div className="mt-4 flex items-center justify-between text-sm text-muted">
            <span>Page {data.page} of {number(pages)} · {number(data.total)} deliveries</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={data.page <= 1} onClick={() => setFilters({ ...filters, page: data.page - 1 })}>Previous</Button>
              <Button variant="secondary" disabled={data.page >= pages} onClick={() => setFilters({ ...filters, page: data.page + 1 })}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      {receiving && s && (
        <IntakeForm summary={s} onClose={() => setReceiving(false)} onDone={(batch) => navigate(`/inventory/${batch.id}/receive`)} />
      )}
    </>
  );
}

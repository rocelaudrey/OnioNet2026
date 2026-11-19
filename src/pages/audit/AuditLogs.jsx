import { useEffect, useState } from 'react';
import { ClipboardList, Search } from 'lucide-react';
import { Card, EmptyState } from '../../components/Card.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Badge, Button, Notice, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { dateTime, formatPHP, number } from '../../lib/format.js';
import { useLoad } from '../../lib/useLoad.js';

const ACTIONS = {
  create: ['Added', 'green'], update: ['Changed', 'purple'], delete: ['Deleted', 'red'], void: ['Voided', 'red'],
  login: ['Signed in', 'gray'], login_failed: ['Sign-in failed', 'amber'], export: ['Printed', 'orange'], password_reset: ['Password reset', 'amber'],
};
const TYPES = {
  Batch: 'Delivery', Member: 'Farmer', Transaction: 'Payment record', Fee: 'Fee', Fees: 'Fees', PaymentPlan: 'Installment plan',
  Quadrant: 'Quadrant', Sack: 'Sack', Tag: 'Tag', TagCount: 'Tag count', TagLot: 'Tag lot', User: 'User', Cooperative: 'Cooperative profile', Report: 'Report',
};
const ROLE_VALUES = { coop_admin: 'Cooperative Admin', coop_staff: 'Cooperative Staff', member: 'Farmer', super_admin: 'Super Admin' };

// "storageFeeCentavos" -> "Storage fee"; "address.barangay" -> "Barangay".
function fieldLabel(field) {
  const last = field.split('.').pop().replace(/Centavos$/, '').replace(/Ha$/, ' (ha)');
  const words = last.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function value(field, v) {
  if (v === null || v === undefined || v === '') return <span className="text-muted">empty</span>;
  if (/Centavos$/.test(field) && Number.isInteger(v)) return formatPHP(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return dateTime(v);
  if (ROLE_VALUES[v]) return ROLE_VALUES[v];
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return Object.values(v).filter(Boolean).join(', ');
  return String(v);
}

export default function AuditLogs() {
  const options = useLoad('/audit-logs/filters');
  const [filters, setFilters] = useState({ q: '', actorName: '', entityType: '', action: '', from: '', to: '', page: 1 });
  const [state, setState] = useState({ data: null, error: '', loading: true });

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      api('/audit-logs/search', { method: 'POST', body: filters })
        .then((data) => current && setState({ data, error: '', loading: false }))
        .catch((err) => current && setState((s) => ({ ...s, error: err.message, loading: false })));
    }, filters.q ? 300 : 0);
    return () => { current = false; clearTimeout(timer); };
  }, [filters]);

  const set = (field) => (e) => setFilters({ ...filters, [field]: e.target.value, page: 1 });
  const { data, error, loading } = state;
  const o = options.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Audit Logs" subtitle="Who changed what, and when. Entries cannot be edited or deleted." />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="relative sm:col-span-2 lg:col-span-1">
            <span className="sr-only">Search</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" value={filters.q} onChange={set('q')} placeholder="Search by record or person" className={`${inputClass} mt-0 pl-9`} />
          </label>
          <select aria-label="Person" value={filters.actorName} onChange={set('actorName')} className={`${inputClass} mt-0`}>
            <option value="">Anyone</option>
            {o?.people.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select aria-label="Record type" value={filters.entityType} onChange={set('entityType')} className={`${inputClass} mt-0`}>
            <option value="">Any record</option>
            {o?.types.map((t) => <option key={t} value={t}>{TYPES[t] ?? t}</option>)}
          </select>
          <select aria-label="Action" value={filters.action} onChange={set('action')} className={`${inputClass} mt-0`}>
            <option value="">Any action</option>
            {Object.entries(ACTIONS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs text-muted">From<input type="date" value={filters.from} onChange={set('from')} className={`${inputClass} mt-0 flex-1`} /></label>
          <label className="flex items-center gap-2 text-xs text-muted">To<input type="date" value={filters.to} onChange={set('to')} className={`${inputClass} mt-0 flex-1`} /></label>
        </div>

        <Notice>{error || options.error}</Notice>
        {loading && <p className="py-6 text-center text-sm text-muted">Loading…</p>}
        {data && data.entries.length === 0 && <EmptyState icon={ClipboardList} title="No entries match" detail="Try different filters." />}

        {data && data.entries.length > 0 && (
          <ul className="divide-y divide-line">
            {data.entries.map((e) => {
              const [label, color] = ACTIONS[e.action] ?? [e.action, 'gray'];
              return (
                <li key={e.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                  <time className="shrink-0 text-xs text-muted sm:w-40" dateTime={e.occurredAt}>{dateTime(e.occurredAt)}</time>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <Badge color={color}>{label}</Badge>{' '}
                      <span className="text-muted">{TYPES[e.entityType] ?? e.entityType}:</span> <span className="font-medium">{e.entityLabel}</span>
                    </p>
                    {e.changes.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {e.changes.map((c) => (
                          <li key={c.field}><span className="text-muted">{fieldLabel(c.field)}:</span> {value(c.field, c.from)} → {value(c.field, c.to)}</li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-0.5 text-xs text-muted">by {e.actorName}{e.actorRole && ` (${e.actorRole})`}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

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
    </>
  );
}

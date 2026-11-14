import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, UserCheck, UserPlus, Users, UserX } from 'lucide-react';
import { Card, EmptyState } from '../../components/Card.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { Button, Notice, Table, Td, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { number } from '../../lib/format.js';
import FarmerForm from './FarmerForm.jsx';
import { StatusBadge, TierBadge } from './badges.jsx';

const place = (a) => [a.barangay, a.municipality].filter(Boolean).join(', ');

export default function Farmers() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ q: '', tier: '', status: '', page: 1 });
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const [adding, setAdding] = useState(false);

  // Search text is sent in the request body, never in the address.
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      api('/members/search', { method: 'POST', body: filters })
        .then((data) => current && setState({ data, error: '', loading: false }))
        .catch((err) => current && setState((s) => ({ ...s, error: err.message, loading: false })));
    }, filters.q ? 300 : 0);
    return () => { current = false; clearTimeout(timer); };
  }, [filters]);

  const set = (field) => (e) => setFilters({ ...filters, [field]: e.target.value, page: 1 });
  const { data, error, loading } = state;
  const totals = data?.totals;
  const show = (n) => (totals ? number(n) : '—');
  const filtered = Boolean(filters.q || filters.tier || filters.status);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Farmers"
        subtitle="Members and guests who store onions here"
        action={<Button onClick={() => setAdding(true)}><Plus size={16} /> Add Farmer</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="All Farmers" value={show(totals?.all)} icon={Users} color="green" />
        <StatCard label="Members" value={show(totals?.members)} icon={UserCheck} color="purple" />
        <StatCard label="Guests" value={show(totals?.guests)} icon={UserPlus} color="orange" />
        <StatCard label="Inactive" value={show(totals?.inactive)} icon={UserX} color="gray" />
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search farmers</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search" value={filters.q} onChange={set('q')}
              placeholder="Search by name or member number"
              className={`${inputClass} mt-0 pl-9`}
            />
          </label>
          <select aria-label="Type" value={filters.tier} onChange={set('tier')} className={`${inputClass} mt-0 sm:w-40`}>
            <option value="">All types</option>
            <option value="member">Members</option>
            <option value="guest">Guests</option>
          </select>
          <select aria-label="Status" value={filters.status} onChange={set('status')} className={`${inputClass} mt-0 sm:w-40`}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <Notice>{error}</Notice>
        {loading && <p className="py-6 text-center text-sm text-muted">Loading…</p>}

        {data && data.members.length > 0 && (
          <Table minWidth={680} columns={['Member No.', 'Name', 'Type', 'Mobile', 'Location', 'Status']}>
            {data.members.map((m) => (
              <tr
                key={m.id}
                tabIndex={0}
                role="link"
                aria-label={`Open ${m.fullName}`}
                onClick={() => navigate(`/farmers/${m.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/farmers/${m.id}`)}
                className="cursor-pointer hover:bg-page focus:bg-page focus:outline-none"
              >
                <Td className="whitespace-nowrap text-muted">{m.memberNo}</Td>
                <Td className="font-medium">{m.lastName}, {m.firstName}</Td>
                <Td><TierBadge tier={m.tier} /></Td>
                <Td className="whitespace-nowrap">{m.phone || <span className="text-muted">None</span>}</Td>
                <Td>{place(m.address) || <span className="text-muted">Not set</span>}</Td>
                <Td><StatusBadge status={m.status} /></Td>
              </tr>
            ))}
          </Table>
        )}

        {data && data.members.length === 0 && (filtered ? (
          <EmptyState icon={Search} title="No farmers match" detail="Try a different name, or clear the filters." />
        ) : (
          <EmptyState icon={Users} title="No farmers yet" detail="Add your first farmer to start receiving deliveries." />
        ))}

        {data && data.total > data.pageSize && (
          <div className="mt-4 flex items-center justify-between text-sm text-muted">
            <span>Page {data.page} of {pages} · {number(data.total)} farmers</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={data.page <= 1} onClick={() => setFilters({ ...filters, page: data.page - 1 })}>Previous</Button>
              <Button variant="secondary" disabled={data.page >= pages} onClick={() => setFilters({ ...filters, page: data.page + 1 })}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      {adding && (
        <FarmerForm
          onClose={() => setAdding(false)}
          onDone={(member) => navigate(`/farmers/${member.id}`)}
        />
      )}
    </>
  );
}

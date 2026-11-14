import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QrCode, ScanLine, Search } from 'lucide-react';
import { Card, EmptyState } from '../../components/Card.jsx';
import Scanner from '../../components/Scanner.jsx';
import { Button, Modal, Notice, Table, Td, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { dateTime, number } from '../../lib/format.js';
import { STATUS_OPTIONS, TagStatusBadge } from './labels.jsx';

export default function TagList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ q: '', status: '', page: 1 });
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const [finding, setFinding] = useState(false);

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ page: String(filters.page) });
      if (filters.q) query.set('q', filters.q);
      if (filters.status) query.set('status', filters.status);
      api(`/tags?${query}`)
        .then((data) => current && setState({ data, error: '', loading: false }))
        .catch((err) => current && setState((s) => ({ ...s, error: err.message, loading: false })));
    }, filters.q ? 300 : 0);
    return () => { current = false; clearTimeout(timer); };
  }, [filters]);

  const set = (field) => (e) => setFilters({ ...filters, [field]: e.target.value, page: 1 });
  const { data, error, loading } = state;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Boolean(filters.q || filters.status);

  // Scan or type a tag to jump straight to it.
  const onFind = async (text) => {
    const { tag } = await api('/tags/lookup', { method: 'POST', body: { text } });
    navigate(`/qr-tags/${tag.id}`);
    return null;
  };

  return (
    <Card>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Search tags</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input type="search" value={filters.q} onChange={set('q')} placeholder="Search by tag code" className={`${inputClass} mt-0 pl-9`} />
        </label>
        <select aria-label="Status" value={filters.status} onChange={set('status')} className={`${inputClass} mt-0 sm:w-44`}>
          <option value="">Any status</option>
          {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <Button variant="secondary" onClick={() => setFinding(true)}><ScanLine size={16} /> Scan a Tag</Button>
      </div>

      <Notice>{error}</Notice>
      {loading && <p className="py-6 text-center text-sm text-muted">Loading…</p>}

      {data && data.tags.length > 0 && (
        <Table minWidth={620} columns={['Tag Code', 'Status', 'Lot', 'Times used', 'Last scanned']}>
          {data.tags.map((tag) => (
            <tr
              key={tag.id} tabIndex={0} role="link" aria-label={`Open tag ${tag.code}`}
              onClick={() => navigate(`/qr-tags/${tag.id}`)}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/qr-tags/${tag.id}`)}
              className="cursor-pointer hover:bg-page focus:bg-page focus:outline-none"
            >
              <Td className="whitespace-nowrap font-mono font-medium">{tag.code}</Td>
              <Td><TagStatusBadge status={tag.status} /></Td>
              <Td>{tag.lotNo ? `Lot ${tag.lotNo}` : ''}</Td>
              <Td>{number(tag.useCount)}</Td>
              <Td className="whitespace-nowrap">{dateTime(tag.lastScannedAt)}</Td>
            </tr>
          ))}
        </Table>
      )}

      {data && data.tags.length === 0 && (filtered ? (
        <EmptyState icon={Search} title="No tags match" detail="Try a different code, or clear the filters." />
      ) : (
        <EmptyState icon={QrCode} title="No tags yet" detail="Open Tag Lots to make your first set of tags." />
      ))}

      {data && data.total > data.pageSize && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>Page {data.page} of {number(pages)} · {number(data.total)} tags</span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={data.page <= 1} onClick={() => setFilters({ ...filters, page: data.page - 1 })}>Previous</Button>
            <Button variant="secondary" disabled={data.page >= pages} onClick={() => setFilters({ ...filters, page: data.page + 1 })}>Next</Button>
          </div>
        </div>
      )}

      {finding && (
        <Modal title="Scan a Tag" onClose={() => setFinding(false)}>
          <Scanner onScan={onFind} />
        </Modal>
      )}
    </Card>
  );
}

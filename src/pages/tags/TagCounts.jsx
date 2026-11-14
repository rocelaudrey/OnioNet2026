import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, Plus } from 'lucide-react';
import { Card, EmptyState } from '../../components/Card.jsx';
import { Badge, Button, Notice, Table, Td } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { dateTime, number } from '../../lib/format.js';
import { useLoad, useSave } from '../../lib/useLoad.js';

export default function TagCounts() {
  const navigate = useNavigate();
  const { data, error, loading } = useLoad('/tags/reconciliation');
  const save = useSave();

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (error) return <Notice>{error}</Notice>;
  const open = data.counts.find((c) => c.status === 'open');

  const start = () => save.run(async () => {
    const { count } = await api('/tags/reconciliation', { method: 'POST' });
    navigate(`/qr-tags/counts/${count.id}`);
  });

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base">Tag Count</h2>
          <p className="text-xs text-muted">Scan every tag you have on hand. OnioNet then lists tags that are missing, unexpected, or in the wrong state.</p>
        </div>
        <Button onClick={start} disabled={save.busy} className="shrink-0">
          <Plus size={16} /> {open ? 'Continue Count' : 'Start a Count'}
        </Button>
      </div>
      <Notice>{save.error}</Notice>

      {data.counts.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No counts yet" detail="Start a count when you want to check your tags on hand against the records." />
      ) : (
        <Table minWidth={560} columns={['Count', 'Status', 'Started', 'Finished', 'Tags scanned']}>
          {data.counts.map((count) => (
            <tr
              key={count.id} tabIndex={0} role="link" aria-label={`Open count ${count.countNo}`}
              onClick={() => navigate(`/qr-tags/counts/${count.id}`)}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/qr-tags/counts/${count.id}`)}
              className="cursor-pointer hover:bg-page focus:bg-page focus:outline-none"
            >
              <Td className="font-medium">Count {count.countNo}</Td>
              <Td>{count.status === 'open' ? <Badge color="amber">In progress</Badge> : <Badge color="green">Finished</Badge>}</Td>
              <Td className="whitespace-nowrap">{dateTime(count.startedAt)}<span className="block text-xs text-muted">{count.startedByName}</span></Td>
              <Td className="whitespace-nowrap">{count.finishedAt ? dateTime(count.finishedAt) : ''}</Td>
              <Td>{number(count.scanned)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

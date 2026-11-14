import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CircleCheck, Printer } from 'lucide-react';
import { Card } from '../../components/Card.jsx';
import Scanner from '../../components/Scanner.jsx';
import { Badge, Button, Modal, Notice } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { dateTime, number } from '../../lib/format.js';
import { useLoad, useSave } from '../../lib/useLoad.js';
import { TAG_STATUS } from './labels.jsx';

function Tally({ label, value, color = 'text-ink' }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm print:border print:border-line print:shadow-none">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{number(value)}</p>
    </div>
  );
}

function CodeList({ title, detail, codes, empty }) {
  return (
    <Card title={`${title} (${number(codes.length)})`} className="print:break-inside-avoid print:shadow-none">
      <p className="-mt-2 mb-3 text-xs text-muted">{detail}</p>
      {codes.length === 0 ? <p className="text-sm text-muted">{empty}</p> : (
        <ul className="grid max-h-72 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto font-mono text-xs sm:grid-cols-3 print:max-h-none print:grid-cols-4">
          {codes.map((c) => <li key={c.code ?? c}>{c.code ?? c}{c.status && <span className="ml-1 font-sans text-muted">({TAG_STATUS[c.status]?.[0]})</span>}</li>)}
        </ul>
      )}
    </Card>
  );
}

export default function TagCountPage() {
  const { id } = useParams();
  const { data, error, loading, reload, setData } = useLoad(`/tags/reconciliation/${id}`);
  const finish = useSave();
  const [confirming, setConfirming] = useState(false);

  const back = (
    <Link to="/qr-tags?tab=count" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink print:hidden">
      <ArrowLeft size={16} /> Tag counts
    </Link>
  );
  if (loading) return <>{back}<p className="text-sm text-muted">Loading…</p></>;
  if (error) return <>{back}<Notice>{error}</Notice></>;
  const { count, result } = data;
  const isOpen = count.status === 'open';

  const onScan = async (text) => {
    const res = await api(`/tags/reconciliation/${id}/scans`, { method: 'POST', body: { text } });
    reload();
    if (res.repeat) return { kind: 'warning', message: `${res.code} was already counted.` };
    if (res.outcome === 'ok') return { kind: 'ok', message: `${res.code} counted.` };
    if (res.outcome === 'wrong_state') {
      return { kind: 'warning', message: `${res.code} counted, but the records say it is ${TAG_STATUS[res.status][0].toLowerCase()}.` };
    }
    return { kind: 'warning', message: `${res.code} is not a registered tag. Noted as unexpected.` };
  };

  const onFinish = () => finish.run(async () => {
    setData(await api(`/tags/reconciliation/${id}/finish`, { method: 'POST' }));
    setConfirming(false);
  });

  return (
    <>
      {back}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl">Tag Count {count.countNo}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            {isOpen ? <Badge color="amber">In progress</Badge> : <Badge color="green">Finished</Badge>}
            <span>Started {dateTime(count.startedAt)} by {count.startedByName}</span>
            {count.finishedAt && <span>· Finished {dateTime(count.finishedAt)}</span>}
          </div>
        </div>
        <div className="flex gap-2 print:hidden">
          {isOpen
            ? <Button onClick={() => setConfirming(true)}><CircleCheck size={16} /> Finish Count</Button>
            : <Button variant="secondary" onClick={() => window.print()}><Printer size={16} /> Print Report</Button>}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tally label="Tags scanned" value={result.scanned + result.unexpected.length} />
        <Tally label="Expected on hand" value={result.expected} />
        <Tally label={isOpen ? 'Not scanned yet' : 'Missing'} value={result.missing.length} color={!isOpen && result.missing.length ? 'text-critical' : 'text-ink'} />
        <Tally label="Needs checking" value={result.wrongState.length + result.unexpected.length} color={result.wrongState.length + result.unexpected.length ? 'text-brand-orange' : 'text-ink'} />
      </div>

      {isOpen && (
        <Card title="Scan Tags on Hand" className="mb-4">
          <Scanner onScan={onScan} />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <CodeList
          title={isOpen ? 'Not Scanned Yet' : 'Missing'}
          detail="Recorded as Available, but not scanned in this count."
          codes={result.missing} empty={isOpen ? 'Every available tag has been scanned.' : 'No tags are missing.'}
        />
        <div className="space-y-4">
          <CodeList
            title="Wrong State"
            detail="Scanned on hand, but the records say assigned, lost, or retired."
            codes={result.wrongState} empty="None."
          />
          <CodeList
            title="Unexpected"
            detail="Scanned codes that are not registered tags of this cooperative."
            codes={result.unexpected} empty="None."
          />
        </div>
      </div>

      {confirming && (
        <Modal title="Finish Count" onClose={() => setConfirming(false)}>
          <p className="text-sm">
            Finish this count? {number(result.missing.length)} available {result.missing.length === 1 ? 'tag has' : 'tags have'} not been scanned and will be listed as missing. A finished count cannot be reopened.
          </p>
          <div className="mt-3"><Notice>{finish.error}</Notice></div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>Keep Counting</Button>
            <Button onClick={onFinish} disabled={finish.busy}>{finish.busy ? 'Finishing…' : 'Finish Count'}</Button>
          </div>
        </Modal>
      )}
    </>
  );
}

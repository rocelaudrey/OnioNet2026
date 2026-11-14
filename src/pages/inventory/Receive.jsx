import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CircleCheck } from 'lucide-react';
import { Card } from '../../components/Card.jsx';
import Scanner from '../../components/Scanner.jsx';
import { Button, Modal, Notice, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { number } from '../../lib/format.js';
import RangePanel from './RangePanel.jsx';
import { useLoad, useSave } from '../../lib/useLoad.js';

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// Gate-in: a full-width phone screen. Each scan puts one tag on one sack.
export default function Receive() {
  const { id } = useParams();
  const navigate = useNavigate();
  const batchLoad = useLoad(`/batches/${id}`);
  const summary = useLoad('/batches/summary');
  const finish = useSave();
  const [quadrantId, setQuadrantId] = useState('');
  const [progress, setProgress] = useState(null); // { received, declared } from the latest scan
  const [recent, setRecent] = useState([]);
  const [shortfall, setShortfall] = useState(null);
  const [mode, setMode] = useState('single'); // 'single' | 'range'
  // One ID per tag text, reused if the same scan is retried after a lost connection.
  const eventIds = useRef(new Map());

  const back = (
    <Link to={`/inventory/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <ArrowLeft size={16} /> Delivery details
    </Link>
  );
  if (batchLoad.loading || summary.loading) return <>{back}<p className="text-sm text-muted">Loading…</p></>;
  if (batchLoad.error || summary.error) return <>{back}<Notice>{batchLoad.error || summary.error}</Notice></>;

  const { batch } = batchLoad.data;
  const quadrants = summary.data.quadrants.filter((q) => q.active);
  const chosen = quadrants.find((q) => String(q.id) === (quadrantId || String(summary.data.suggestedQuadrantId ?? '')));
  const received = progress?.received ?? batch.sacksReceived;
  const declared = progress?.declared ?? batch.declaredSackCount;
  const complete = received >= declared;

  if (batch.status !== 'receiving') {
    return (
      <>
        {back}
        <Notice kind="warning">This delivery is no longer being received, so sacks cannot be added to it.</Notice>
      </>
    );
  }

  const onScan = async (text) => {
    if (!chosen) return { kind: 'error', message: 'Choose where to store the sacks first.' };
    if (!eventIds.current.has(text)) eventIds.current.set(text, newId());
    try {
      const res = await api('/custody/gate-in', {
        method: 'POST',
        body: { batchId: id, text, quadrantId: chosen.id, clientEventId: eventIds.current.get(text) },
      });
      setProgress({ received: res.received, declared: res.declared });
      if (!res.repeat) setRecent((list) => [{ sackNo: res.sack.sackNo, code: res.tag.code, quadrant: res.quadrant.code }, ...list].slice(0, 8));
      summary.reload(); // refresh free space, and move on when a quadrant fills up
      if (res.quadrant.free === 0) setQuadrantId('');
      return res.repeat
        ? { kind: 'warning', message: `Sack ${res.sack.sackNo} was already recorded with this tag.` }
        : { kind: 'ok', message: `Sack ${res.sack.sackNo} tagged ${res.tag.code} → ${res.quadrant.code}` };
    } catch (err) {
      if (err.status !== 0) eventIds.current.delete(text); // a real refusal; a new try is a new scan
      throw err;
    }
  };

  const onRangeAssigned = (res) => {
    setProgress({ received: res.received, declared: res.declared });
    if (!res.repeat) {
      setRecent((list) => [{ sackNo: `${res.firstSackNo} to ${res.lastSackNo}`, code: `${res.firstCode} to ${res.lastCode}`, quadrant: res.quadrant.code }, ...list].slice(0, 8));
    }
    summary.reload();
    if (res.quadrant?.free === 0) setQuadrantId('');
  };

  const onFinish = (acceptShortfall) => finish.run(async () => {
    try {
      await api(`/batches/${id}/finish-receiving`, { method: 'POST', body: { acceptShortfall } });
      navigate(`/inventory/${id}`);
    } catch (err) {
      if (err.details?.shortfall) { setShortfall(err.details); return; }
      throw err;
    }
  });

  return (
    <div className="mx-auto max-w-xl">
      {back}
      <div className="mb-4">
        <h1 className="text-2xl">Scan Sacks In</h1>
        <p className="text-sm text-muted">{batch.ownerName} · {batch.batchNo}</p>
      </div>

      <div className="mb-4 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-end justify-between">
          <p className="text-4xl font-bold">{number(received)}<span className="text-xl font-normal text-muted"> of {number(declared)}</span></p>
          <p className="text-sm text-muted">sacks tagged</p>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-brand-green transition-all" style={{ width: `${Math.min(100, (received / declared) * 100)}%` }} />
        </div>
      </div>

      {complete ? (
        <Card className="mb-4 text-center">
          <CircleCheck size={40} className="mx-auto mb-2 text-brand-green" />
          <p className="font-medium">All {number(declared)} sacks are tagged.</p>
          <p className="mt-1 text-sm text-muted">If there are more sacks, change the sack count on the delivery page.</p>
        </Card>
      ) : (
        <Card className="mb-4">
          <label className="mb-4 block text-xs text-muted">
            Store in
            <select
              value={chosen ? String(chosen.id) : ''} onChange={(e) => setQuadrantId(e.target.value)}
              className={`${inputClass} py-3 text-base`}
            >
              {!chosen && <option value="">Choose a quadrant</option>}
              {quadrants.map((q) => (
                <option key={q.id} value={String(q.id)} disabled={q.free === 0}>
                  {q.code}: {q.free === 0 ? 'full' : `room for ${number(q.free)}`}
                </option>
              ))}
            </select>
          </label>
          <div className="mb-4 flex gap-1 rounded-xl bg-page p-1" role="tablist" aria-label="How to tag the sacks">
            {[['single', 'One by one'], ['range', 'By range']].map(([key, label]) => (
              <button
                key={key} type="button" role="tab" aria-selected={mode === key} onClick={() => setMode(key)}
                className={`flex-1 rounded-lg px-3 py-2.5 text-sm ${mode === key ? 'bg-white font-medium text-ink shadow-sm' : 'text-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === 'single' ? (
            <>
              <Scanner onScan={onScan} allowTyping={false} />
              <p className="text-xs text-muted">Clip a tag on the sack, then scan it. Single codes cannot be typed here.</p>
            </>
          ) : (
            <RangePanel batchId={id} quadrant={chosen} remaining={declared - received} onAssigned={onRangeAssigned} />
          )}
        </Card>
      )}

      <Notice>{finish.error}</Notice>
      <Button className="mt-2 w-full py-4 text-base" variant={complete ? 'primary' : 'secondary'} disabled={finish.busy || received === 0} onClick={() => onFinish(false)}>
        {finish.busy ? 'Finishing…' : 'Finish Receiving'}
      </Button>

      {recent.length > 0 && (
        <Card title="Just Tagged" className="mt-4">
          <ul className="divide-y divide-line">
            {recent.map((r) => (
              <li key={r.sackNo} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="whitespace-nowrap font-medium">{String(r.sackNo).includes('to') ? 'Sacks' : 'Sack'} {r.sackNo}</span>
                <span className="font-mono text-xs">{r.code}</span>
                <span className="text-muted">{r.quadrant}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {shortfall && (
        <Modal title="Fewer Sacks Than Declared" onClose={() => setShortfall(null)}>
          <p className="text-sm">
            Only {number(shortfall.received)} of {number(shortfall.declared)} sacks were scanned in. Finish anyway? The delivery will be recorded with {number(shortfall.received)} sacks, and no more can be added.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShortfall(null)}>Keep Scanning</Button>
            <Button onClick={() => { setShortfall(null); onFinish(true); }}>Finish with {number(shortfall.received)}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

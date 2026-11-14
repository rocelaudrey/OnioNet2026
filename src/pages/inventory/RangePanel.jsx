import { useRef, useState } from 'react';
import Scanner from '../../components/Scanner.jsx';
import { Button, Notice, TextField } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { number } from '../../lib/format.js';
import { useSave } from '../../lib/useLoad.js';

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const codeOf = (text) => text.split('.')[0].toUpperCase();

// Gate-in for many sacks at once: give the first and the last tag of a run of
// tags, and every tag in between is put on a new sack. Scanning the two tags
// is the normal way; typing their numbers is the fallback.
export default function RangePanel({ batchId, quadrant, remaining, onAssigned }) {
  const [method, setMethod] = useState('range_scan');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [preview, setPreview] = useState(null);
  const [problems, setProblems] = useState([]);
  const check = useSave();
  const assign = useSave();
  const eventId = useRef(newId());

  const reset = (nextMethod = method) => {
    setMethod(nextMethod); setFirst(''); setLast(''); setPreview(null); setProblems([]);
    eventId.current = newId();
  };

  const send = (dryRun) => api('/custody/gate-in-range', {
    method: 'POST',
    body: { batchId, quadrantId: quadrant?.id, first, last, method, dryRun, clientEventId: eventId.current },
  });

  const run = (save, dryRun) => save.run(async () => {
    setProblems([]);
    if (!quadrant) throw new Error('Choose where to store the sacks first.');
    try {
      const result = await send(dryRun);
      if (dryRun) setPreview(result);
      else { onAssigned(result); reset(); }
    } catch (err) {
      setPreview(null);
      setProblems(Array.isArray(err.details) ? err.details : []);
      throw err;
    }
  });

  const onScan = (text) => {
    setPreview(null); setProblems([]);
    if (!first) { setFirst(text); return { kind: 'ok', message: `First tag: ${codeOf(text)}. Now scan the last tag.` }; }
    if (!last) { setLast(text); return { kind: 'ok', message: `Last tag: ${codeOf(text)}. Check the range below.` }; }
    return { kind: 'warning', message: 'Both tags are scanned. Check the range, or start over.' };
  };

  const ready = Boolean(first && last);
  const tab = (key, label) => (
    <button
      type="button" role="tab" aria-selected={method === key} onClick={() => reset(key)}
      className={`flex-1 rounded-lg px-3 py-2 text-sm ${method === key ? 'bg-white font-medium text-ink shadow-sm' : 'text-muted'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        For sacks tagged with a run of tags in number order. Give the first and the last tag, and every tag in between goes on a new sack.
        Up to {number(Math.min(remaining, 1000))} at once.
      </p>
      <div className="flex gap-1 rounded-xl bg-page p-1" role="tablist" aria-label="How to enter the range">
        {tab('range_scan', 'Scan first and last')}
        {tab('range_typed', 'Type the numbers')}
      </div>

      {method === 'range_scan' ? (
        <>
          <ol className="grid grid-cols-2 gap-3 text-sm">
            <li className={`rounded-lg border px-3 py-2 ${first ? 'border-brand-green bg-brand-green-tint' : 'border-line'}`}>
              <span className="block text-xs text-muted">1. First tag</span>
              <span className="font-mono font-medium">{first ? codeOf(first) : 'Not scanned'}</span>
            </li>
            <li className={`rounded-lg border px-3 py-2 ${last ? 'border-brand-green bg-brand-green-tint' : 'border-line'}`}>
              <span className="block text-xs text-muted">2. Last tag</span>
              <span className="font-mono font-medium">{last ? codeOf(last) : 'Not scanned'}</span>
            </li>
          </ol>
          {!ready && <Scanner onScan={onScan} allowTyping={false} />}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="First tag number" inputMode="numeric" value={first} onChange={(e) => { setFirst(e.target.value); setPreview(null); }} placeholder="1" />
            <TextField label="Last tag number" inputMode="numeric" value={last} onChange={(e) => { setLast(e.target.value); setPreview(null); }} placeholder="100" />
          </div>
          <Notice kind="warning">Typed ranges are recorded as "typed, not scanned". Scan the first and last tag when you can.</Notice>
        </>
      )}

      <Notice>{check.error || assign.error}</Notice>
      {problems.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-3 text-xs">
          {problems.map((p) => <li key={p.code}><span className="font-mono">{p.code}</span>: {p.problem}</li>)}
        </ul>
      )}

      {preview && (
        <div className="rounded-lg bg-brand-green-tint px-4 py-3 text-sm text-brand-green-dark">
          <p className="text-base font-semibold">{number(preview.assigned)} tags → {number(preview.assigned)} sacks in {preview.quadrant.code}</p>
          <p className="font-mono text-xs">{preview.firstCode} to {preview.lastCode}</p>
          <p className="mt-1">All of these tags are available. After this, {number(preview.received + preview.assigned)} of {number(preview.declared)} sacks will be tagged.</p>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {!preview && (
          <Button className="flex-1 py-3.5 text-base" disabled={!ready || check.busy} onClick={() => run(check, true)}>
            {check.busy ? 'Checking…' : 'Check Range'}
          </Button>
        )}
        {preview && (
          <Button className="flex-1 py-3.5 text-base" disabled={assign.busy} onClick={() => run(assign, false)}>
            {assign.busy ? 'Assigning…' : `Assign ${number(preview.assigned)} Tags`}
          </Button>
        )}
        {(first || last) && <Button variant="secondary" className="py-3.5" onClick={() => reset()}>Start Over</Button>}
      </div>
    </div>
  );
}

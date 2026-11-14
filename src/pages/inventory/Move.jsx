import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Card } from '../../components/Card.jsx';
import Scanner from '../../components/Scanner.jsx';
import { Notice, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { number } from '../../lib/format.js';
import { useLoad } from '../../lib/useLoad.js';

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// Move: pick where the sacks are going, then scan each sack as it is moved.
export default function Move() {
  const summary = useLoad('/batches/summary');
  const [toId, setToId] = useState('');
  const [recent, setRecent] = useState([]);
  const eventIds = useRef(new Map());

  const back = (
    <Link to="/inventory" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <ArrowLeft size={16} /> Inventory
    </Link>
  );
  if (summary.loading) return <>{back}<p className="text-sm text-muted">Loading…</p></>;
  if (summary.error) return <>{back}<Notice>{summary.error}</Notice></>;
  const quadrants = summary.data.quadrants.filter((q) => q.active);
  const to = quadrants.find((q) => String(q.id) === toId);

  const onScan = async (text) => {
    if (!to) return { kind: 'error', message: 'Choose where the sacks are going first.' };
    const key = `${text}>${to.id}`;
    if (!eventIds.current.has(key)) eventIds.current.set(key, newId());
    try {
      const res = await api('/custody/move', { method: 'POST', body: { text, toQuadrantId: to.id, clientEventId: eventIds.current.get(key) } });
      if (!res.repeat) setRecent((list) => [{ key: newId(), sackNo: res.sack.sackNo, code: res.tag.code, from: res.from.code, to: res.to.code }, ...list].slice(0, 8));
      summary.reload();
      return res.repeat
        ? { kind: 'warning', message: `That sack is already recorded in ${res.to.code}.` }
        : { kind: 'ok', message: `Sack ${res.sack.sackNo} moved from ${res.from.code} to ${res.to.code}.` };
    } catch (err) {
      if (err.status !== 0) eventIds.current.delete(key);
      throw err;
    }
  };

  return (
    <div className="mx-auto max-w-xl">
      {back}
      <div className="mb-4">
        <h1 className="text-2xl">Move Sacks</h1>
        <p className="text-sm text-muted">Record sacks moved from one quadrant to another</p>
      </div>
      <Card className="mb-4">
        <label className="mb-4 block text-xs text-muted">
          Moving sacks to
          <select value={toId} onChange={(e) => setToId(e.target.value)} className={`${inputClass} py-3 text-base`}>
            <option value="">Choose a quadrant</option>
            {quadrants.map((q) => (
              <option key={q.id} value={String(q.id)} disabled={q.free === 0}>
                {q.code}: {q.free === 0 ? 'full' : `room for ${number(q.free)}`}
              </option>
            ))}
          </select>
        </label>
        <Scanner onScan={onScan} allowTyping={false} />
        <p className="text-xs text-muted">Scan the tag on each sack as you put it in its new place. Codes cannot be typed here.</p>
      </Card>

      {recent.length > 0 && (
        <Card title="Just Moved">
          <ul className="divide-y divide-line">
            {recent.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-medium">Sack {r.sackNo}</span>
                <span className="font-mono text-xs">{r.code}</span>
                <span className="whitespace-nowrap text-muted">{r.from} → {r.to}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

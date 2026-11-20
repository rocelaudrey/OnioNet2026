import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { inputClass } from './ui.jsx';
import { api } from '../lib/api.js';
import { TIER_LABELS } from '../../shared/statuses.js';

// Finds an active farmer by name or member number (sent in the request body).
export default function FarmerPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);

  useEffect(() => {
    if (!q.trim()) { setResults(null); return undefined; }
    let current = true;
    const timer = setTimeout(() => {
      api('/members/search', { method: 'POST', body: { q, status: 'active' } })
        .then((data) => current && setResults(data.members.slice(0, 6)))
        .catch(() => current && setResults([]));
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [q]);

  if (value) {
    return (
      <div className="mt-1 flex items-center justify-between rounded-lg border border-brand-green bg-brand-green-tint px-3 py-2.5">
        <div>
          <p className="text-sm font-medium text-ink">{value.fullName}</p>
          <p className="text-xs text-muted">{value.memberNo} · {TIER_LABELS[value.tier]}</p>
        </div>
        <button type="button" onClick={() => onChange(null)} aria-label="Choose a different farmer" className="rounded-lg p-1.5 text-muted hover:bg-white">
          <X size={16} />
        </button>
      </div>
    );
  }
  return (
    <div>
      <span className="relative mt-1 block">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
          placeholder="Type a name or member number" className={`${inputClass} mt-0 pl-9`}
        />
      </span>
      {results && (
        <ul className="mt-1 divide-y divide-line overflow-hidden rounded-lg border border-line">
          {results.length === 0 && <li className="px-3 py-2.5 text-sm text-muted">No active farmer matches. Add them on the Farmers page first.</li>}
          {results.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => { onChange(m); setQ(''); }} className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-page">
                <span className="text-sm font-medium text-ink">{m.fullName}</span>
                <span className="text-xs text-muted">{m.memberNo} · {TIER_LABELS[m.tier]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

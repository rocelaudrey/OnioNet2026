import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Button, Field, Modal, Notice, SelectField, TextField, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatPHP, number } from '../../lib/format.js';
import { useSave } from '../../lib/useLoad.js';
import { CHARGED_PER } from './labels.jsx';

// Finds an active farmer by name or member number (sent in the request body).
function FarmerPicker({ value, onChange }) {
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
          <p className="text-xs text-muted">{value.memberNo} · {value.tier === 'guest' ? 'Guest' : 'Member'}</p>
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
                <span className="text-xs text-muted">{m.memberNo} · {m.tier === 'guest' ? 'Guest' : 'Member'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChoiceField({ label, options, value, onChange }) {
  if (!options.length) return <TextField label={label} value={value} onChange={onChange} />;
  return <SelectField label={label} value={value} onChange={onChange} options={[['', 'Not set'], ...options.map((o) => [o, o])]} />;
}

export default function IntakeForm({ summary, onDone, onClose }) {
  const save = useSave();
  const { intake, available } = summary;
  const [farmer, setFarmer] = useState(null);
  const [coopOwned, setCoopOwned] = useState(false);
  const [form, setForm] = useState({ declaredSackCount: '', variety: '', sizeClass: '', grade: '', totalWeightKg: '', notes: '' });
  const [optional, setOptional] = useState([]);
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const toggle = (id) => setOptional(optional.includes(id) ? optional.filter((x) => x !== id) : [...optional, id]);

  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => {
      if (!coopOwned && !farmer) throw new Error('Choose the farmer who delivered the sacks.');
      const { batch } = await api('/batches', {
        method: 'POST',
        body: {
          coopOwned, memberId: coopOwned ? undefined : farmer.id,
          declaredSackCount: Number(form.declaredSackCount),
          variety: form.variety, sizeClass: form.sizeClass, grade: form.grade,
          totalWeightKg: form.totalWeightKg, notes: form.notes,
          optionalFeeIds: coopOwned ? [] : optional,
        },
      });
      onDone(batch);
    });
  };

  return (
    <Modal title="Receive Delivery" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {!coopOwned && (
          <Field label="Farmer">
            <FarmerPicker value={farmer} onChange={setFarmer} />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={coopOwned} onChange={(e) => setCoopOwned(e.target.checked)} className="h-4 w-4 accent-brand-green" />
          This is the cooperative's own stock (no farmer, no fees)
        </label>

        <TextField
          label="Number of sacks" type="number" min="1" max={available} step="1" required inputMode="numeric"
          value={form.declaredSackCount} onChange={set('declaredSackCount')}
          hint={`There is room for ${number(available)} more sacks.`}
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Variety" value={form.variety} onChange={set('variety')} placeholder="e.g. Red Creole" />
          <TextField label="Total weight (kg)" type="number" min="0" step="0.1" value={form.totalWeightKg} onChange={set('totalWeightKg')} />
          <ChoiceField label="Size class" options={intake.sizeClasses} value={form.sizeClass} onChange={set('sizeClass')} />
          <ChoiceField label="Grade" options={intake.grades} value={form.grade} onChange={set('grade')} />
        </div>

        {!coopOwned && intake.optionalFees.length > 0 && (
          <fieldset>
            <legend className="text-xs text-muted">Other fees for this delivery</legend>
            <div className="mt-1 space-y-2">
              {intake.optionalFees.map((fee) => (
                <label key={fee.id} className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={optional.includes(fee.id)} onChange={() => toggle(fee.id)} className="h-4 w-4 accent-brand-green" />
                  {fee.name} <span className="text-muted">({formatPHP(fee.amountCentavos)} {CHARGED_PER[fee.chargedPer]})</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <Field label="Notes">
          <textarea rows={2} className={inputClass} value={form.notes} onChange={set('notes')} />
        </Field>

        {!coopOwned && intake.storageFeeCentavos === 0 && (
          <Notice kind="warning">The storage fee is ₱0.00, so this delivery will be stored at no charge. An admin can set it in Settings &gt; Fees.</Notice>
        )}
        <p className="text-xs text-muted">The contract runs for {intake.contractMonths} months from today. Next, you will scan a tag onto each sack.</p>
        <Notice>{save.error}</Notice>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.busy}>{save.busy ? 'Saving…' : 'Start Scanning'}</Button>
        </div>
      </form>
    </Modal>
  );
}

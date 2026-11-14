import { useState } from 'react';
import FarmerPicker from '../../components/FarmerPicker.jsx';
import { Button, Field, Modal, Notice, SelectField, TextField, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatPHP, number } from '../../lib/format.js';
import { useSave } from '../../lib/useLoad.js';
import { CHARGED_PER } from './labels.jsx';

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

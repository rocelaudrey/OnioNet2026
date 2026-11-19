import { useState } from 'react';
import { Badge, Button, Field, Modal, Notice, SelectField, TextField, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useSave } from '../../lib/useLoad.js';

export const FEATURE_LABELS = {
  farmer_portal: 'Farmer portal',
  tag_reconciliation: 'Tag counts',
  tag_import: 'Import pre-printed tags',
  pdf_reports: 'Print reports',
};
export const SUB_STATUS = { trial: ['Trial', 'purple'], active: ['Active', 'green'], past_due: ['Past due', 'red'], canceled: ['Canceled', 'gray'] };

export function SubscriptionBadge({ sub }) {
  const [label, color] = SUB_STATUS[sub.status] ?? [sub.status, 'gray'];
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge color={color}>{label}</Badge>
      {sub.ended && sub.status !== 'canceled' && <Badge color="red">Ended</Badge>}
      {sub.endingSoon && <Badge color="amber">Ends in {sub.daysLeft} {sub.daysLeft === 1 ? 'day' : 'days'}</Badge>}
    </span>
  );
}

export const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export function TemporaryPassword({ name, password, onClose }) {
  return (
    <Modal title="Temporary Password" onClose={onClose}>
      <p className="text-sm">Give this password to <span className="font-medium">{name}</span>. They will choose their own when they sign in.</p>
      <p className="my-4 select-all rounded-lg bg-page px-4 py-3 text-center font-mono text-xl tracking-wider">{password}</p>
      <Notice kind="warning">This is shown only once. If it is lost, reset the password again.</Notice>
      <div className="mt-4 flex justify-end"><Button onClick={onClose}>Done</Button></div>
    </Modal>
  );
}

// Plan, status, dates, sack limit, and features. Used when onboarding and when editing.
export function SubscriptionFields({ value, onChange }) {
  const set = (field) => (e) => onChange({ ...value, [field]: e.target.value });
  const toggle = (f) => onChange({ ...value, enabledFeatures: value.enabledFeatures.includes(f) ? value.enabledFeatures.filter((x) => x !== f) : [...value.enabledFeatures, f] });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <TextField label="Plan name" value={value.plan} onChange={set('plan')} placeholder="e.g. Starter" />
        <SelectField label="Status" value={value.status} onChange={set('status')} options={Object.entries(SUB_STATUS).map(([k, [l]]) => [k, l])} />
        <TextField label="Starts" type="date" value={value.startedAt} onChange={set('startedAt')} />
        <TextField label="Ends" type="date" value={value.endsAt} onChange={set('endsAt')} hint="Leave empty for no end date." />
        <TextField label="Most sacks allowed" type="number" min="1" step="1" required value={value.capacityLimit} onChange={set('capacityLimit')} className="col-span-2" />
      </div>
      <fieldset>
        <legend className="text-xs text-muted">Features</legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {Object.entries(FEATURE_LABELS).map(([f, label]) => (
            <label key={f} className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" className="h-4 w-4 accent-brand-green" checked={value.enabledFeatures.includes(f)} onChange={() => toggle(f)} /> {label}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Notes (optional)">
        <textarea rows={2} className={inputClass} value={value.notes ?? ''} onChange={set('notes')} />
      </Field>
    </div>
  );
}

export const subscriptionBody = (v) => ({
  plan: v.plan, status: v.status, startedAt: v.startedAt || null, endsAt: v.endsAt || null,
  capacityLimit: Number(v.capacityLimit), enabledFeatures: v.enabledFeatures, notes: v.notes,
});

export function EditSubscription({ coop, onDone, onClose }) {
  const save = useSave();
  const s = coop.subscription;
  const [value, setValue] = useState({
    plan: s.plan, status: s.status, startedAt: ymd(s.startedAt), endsAt: ymd(s.endsAt),
    capacityLimit: String(s.capacityLimit), enabledFeatures: s.enabledFeatures, notes: s.notes,
  });
  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => onDone(await api(`/admin/cooperatives/${coop.id}/subscription`, { method: 'PATCH', body: subscriptionBody(value) })));
  };
  return (
    <Modal title={`${coop.name} Subscription`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <SubscriptionFields value={value} onChange={setValue} />
        <p className="text-xs text-muted">The cooperative's admins see this change in their audit log.</p>
        <Notice>{save.error}</Notice>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.busy}>{save.busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

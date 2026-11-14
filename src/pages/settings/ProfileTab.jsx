import { useEffect, useState } from 'react';
import { Card } from '../../components/Card.jsx';
import { Badge, Button, Notice, TextField } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { date, number } from '../../lib/format.js';
import { useLoad, useSave } from '../../lib/useLoad.js';

const PLAN_STATUS = { trial: ['Trial', 'purple'], active: ['Active', 'green'], past_due: ['Past Due', 'red'], canceled: ['Canceled', 'gray'] };
const toList = (text) => text.split(',').map((s) => s.trim()).filter(Boolean);

export default function ProfileTab() {
  const { data, error, loading, setData } = useLoad('/cooperative');
  const save = useSave();
  const [form, setForm] = useState(null);
  const coop = data?.cooperative;

  useEffect(() => {
    if (!coop) return;
    setForm({
      facilityName: coop.facilityName, address: coop.address,
      personName: coop.contact.personName, phone: coop.contact.phone, email: coop.contact.email,
      contractMonths: String(coop.contractMonths),
      sizeClasses: coop.sizeClasses.join(', '), grades: coop.grades.join(', '),
    });
  }, [coop]);

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (error) return <Notice>{error}</Notice>;
  if (!form) return null;

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const [statusLabel, statusColor] = PLAN_STATUS[coop.subscription.status] ?? ['Unknown', 'gray'];

  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => {
      const result = await api('/cooperative', {
        method: 'PATCH',
        body: {
          facilityName: form.facilityName, address: form.address,
          contact: { personName: form.personName, phone: form.phone, email: form.email },
          contractMonths: Number(form.contractMonths),
          sizeClasses: toList(form.sizeClasses), grades: toList(form.grades),
        },
      });
      setData(result);
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Cooperative Profile" className="lg:col-span-2">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Cooperative name" value={coop.name} disabled hint="Managed by OnioNet." />
            <TextField label="Tag prefix" value={coop.tagPrefix} disabled hint="Printed on every tag. Cannot be changed." />
            <TextField label="Facility name" value={form.facilityName} onChange={set('facilityName')} />
            <TextField label="Address" value={form.address} onChange={set('address')} />
            <TextField label="Contact person" value={form.personName} onChange={set('personName')} />
            <TextField label="Contact mobile number" value={form.phone} onChange={set('phone')} inputMode="tel" />
            <TextField label="Contact email" type="email" value={form.email} onChange={set('email')} className="sm:col-span-2" />
          </div>
          <h3 className="pt-2 text-sm">Intake options</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Standard contract (months)" type="number" min="1" max="24" required
              value={form.contractMonths} onChange={set('contractMonths')}
              hint="Used for new deliveries only."
            />
            <span className="hidden sm:block" />
            <TextField label="Size classes" value={form.sizeClasses} onChange={set('sizeClasses')} hint="Separate with commas, e.g. Large, Medium, Small." />
            <TextField label="Grades" value={form.grades} onChange={set('grades')} hint="Separate with commas, e.g. A, B, C." />
          </div>
          <Notice>{save.error}</Notice>
          {save.saved && <Notice kind="success">Saved.</Notice>}
          <Button type="submit" disabled={save.busy}>{save.busy ? 'Saving…' : 'Save Changes'}</Button>
        </form>
      </Card>

      <Card title="Plan">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted">Plan</dt><dd className="font-medium capitalize">{coop.subscription.plan}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Status</dt><dd><Badge color={statusColor}>{statusLabel}</Badge></dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Ends</dt><dd className="font-medium">{date(coop.subscription.endsAt)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Capacity limit</dt><dd className="font-medium">{number(coop.subscription.capacityLimit)} sacks</dd></div>
        </dl>
        <p className="mt-4 text-xs text-muted">Your plan is managed by OnioNet. Contact us to change it.</p>
      </Card>
    </div>
  );
}

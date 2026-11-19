import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Plus } from 'lucide-react';
import { Card, EmptyState } from '../../components/Card.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Button, CapacityBar, Modal, Notice, Table, Td, TextField } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { date, number } from '../../lib/format.js';
import { useLoad, useSave } from '../../lib/useLoad.js';
import { FEATURE_LABELS, SubscriptionBadge, SubscriptionFields, TemporaryPassword, subscriptionBody } from './shared.jsx';

function Onboard({ onDone, onClose }) {
  const save = useSave();
  const [form, setForm] = useState({ name: '', facilityName: '', address: '', tagPrefix: '', contractMonths: '3', floors: '2', perFloor: '4', capacityEach: '1250', withLayout: true, adminName: '', adminEmail: '', adminPhone: '' });
  const [sub, setSub] = useState({ plan: 'Starter', status: 'trial', startedAt: '', endsAt: '', capacityLimit: '10000', enabledFeatures: Object.keys(FEATURE_LABELS), notes: '' });
  const set = (f) => (e) => setForm({ ...form, [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const total = Number(form.floors) * Number(form.perFloor) * Number(form.capacityEach) || 0;

  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => onDone(await api('/admin/cooperatives', {
      method: 'POST',
      body: {
        name: form.name, facilityName: form.facilityName, address: form.address, tagPrefix: form.tagPrefix, contractMonths: Number(form.contractMonths),
        subscription: subscriptionBody(sub),
        layout: form.withLayout ? { floors: Number(form.floors), perFloor: Number(form.perFloor), capacityEach: Number(form.capacityEach) } : undefined,
        admin: { name: form.adminName, email: form.adminEmail, phone: form.adminPhone },
      },
    })));
  };

  return (
    <Modal title="Add Cooperative" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-5">
        <section className="space-y-4">
          <h3 className="text-sm">Cooperative</h3>
          <TextField label="Cooperative name" required value={form.name} onChange={set('name')} />
          <div className="grid grid-cols-2 gap-4">
            <TextField label="Facility name" value={form.facilityName} onChange={set('facilityName')} placeholder="e.g. … Cold Storage" />
            <TextField label="Address" value={form.address} onChange={set('address')} />
            <TextField label="Tag prefix" required value={form.tagPrefix} onChange={set('tagPrefix')} placeholder="FAF" hint="2 to 6 letters or numbers. Printed on every tag; cannot be changed later." />
            <TextField label="Standard contract (months)" type="number" min="1" max="24" required value={form.contractMonths} onChange={set('contractMonths')} />
          </div>
        </section>

        <section className="space-y-4 border-t border-line pt-4">
          <h3 className="text-sm">Subscription</h3>
          <SubscriptionFields value={sub} onChange={setSub} />
        </section>

        <section className="space-y-4 border-t border-line pt-4">
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <input type="checkbox" className="h-4 w-4 accent-brand-green" checked={form.withLayout} onChange={set('withLayout')} /> Set up a storage layout now
          </label>
          {form.withLayout && (
            <>
              <div className="grid grid-cols-3 gap-4">
                <TextField label="Floors" type="number" min="1" max="10" value={form.floors} onChange={set('floors')} />
                <TextField label="Quadrants per floor" type="number" min="1" max="26" value={form.perFloor} onChange={set('perFloor')} />
                <TextField label="Sacks each" type="number" min="1" value={form.capacityEach} onChange={set('capacityEach')} />
              </div>
              <p className="text-xs text-muted">Quadrants are named 1-A, 1-B, 2-A, and so on: {number(total)} sacks in all. The cooperative admin can change it later in Settings.</p>
            </>
          )}
        </section>

        <section className="space-y-4 border-t border-line pt-4">
          <h3 className="text-sm">First Cooperative Admin</h3>
          <TextField label="Full name" required value={form.adminName} onChange={set('adminName')} />
          <div className="grid grid-cols-2 gap-4">
            <TextField label="Email" type="email" value={form.adminEmail} onChange={set('adminEmail')} />
            <TextField label="Mobile number" inputMode="tel" value={form.adminPhone} onChange={set('adminPhone')} />
          </div>
        </section>

        <Notice>{save.error}</Notice>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.busy}>{save.busy ? 'Saving…' : 'Add Cooperative'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Cooperatives() {
  const navigate = useNavigate();
  const { data, error } = useLoad('/admin/cooperatives');
  const [adding, setAdding] = useState(false);
  const [made, setMade] = useState(null);

  return (
    <>
      <PageHeader title="Cooperatives" subtitle="Onboard and manage cooperatives" action={<Button onClick={() => setAdding(true)}><Plus size={16} /> Add Cooperative</Button>} />
      <Notice>{error}</Notice>
      {!data && !error && <p className="text-sm text-muted">Loading…</p>}
      {data && (
        <Card>
          {data.cooperatives.length === 0 ? <EmptyState icon={Building2} title="No cooperatives yet" detail="Add the first cooperative." /> : (
            <Table minWidth={760} columns={['Cooperative', 'Tag prefix', 'Plan', 'Storage used', 'Team', 'Since']}>
              {data.cooperatives.map((c) => (
                <tr
                  key={c.id} tabIndex={0} role="link" aria-label={`Open ${c.name}`}
                  onClick={() => navigate(`/cooperatives/${c.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/cooperatives/${c.id}`)}
                  className="cursor-pointer hover:bg-page focus:bg-page focus:outline-none"
                >
                  <Td><span className="font-medium">{c.name}</span><span className="block text-xs text-muted">{c.facilityName}{c.status === 'suspended' && ' · suspended'}</span></Td>
                  <Td className="font-mono text-xs">{c.tagPrefix}</Td>
                  <Td><span className="block text-sm capitalize">{c.subscription.plan}</span><SubscriptionBadge sub={c.subscription} /></Td>
                  <Td className="min-w-[180px]">{c.capacity ? <CapacityBar used={c.sacksStored} capacity={c.capacity} unit="" /> : <span className="text-xs text-muted">No layout yet</span>}</Td>
                  <Td>{number(c.activeTeam)}</Td>
                  <Td className="whitespace-nowrap">{date(c.createdAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      {adding && <Onboard onClose={() => setAdding(false)} onDone={(r) => { setAdding(false); setMade(r); }} />}
      {made && (
        <TemporaryPassword
          name={`${made.admin.name} (${made.cooperative.name})`} password={made.temporaryPassword}
          onClose={() => navigate(`/cooperatives/${made.cooperative.id}`)}
        />
      )}
    </>
  );
}

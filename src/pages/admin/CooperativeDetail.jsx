import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import { Card } from '../../components/Card.jsx';
import { Badge, Button, CapacityBar, Modal, Notice, Table, Td, TextField } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { date, dateTime, number } from '../../lib/format.js';
import { useLoad, useSave } from '../../lib/useLoad.js';
import { EditSubscription, FEATURE_LABELS, SubscriptionBadge, TemporaryPassword } from './shared.jsx';

function Row({ label, children }) {
  return <div className="flex justify-between gap-4 py-1.5 text-sm"><dt className="text-muted">{label}</dt><dd className="text-right font-medium">{children || <span className="font-normal text-muted">Not set</span>}</dd></div>;
}

function EditProfile({ coop, onDone, onClose }) {
  const save = useSave();
  const [f, setF] = useState({ name: coop.name, facilityName: coop.facilityName, address: coop.address, personName: coop.contact.personName, phone: coop.contact.phone, email: coop.contact.email });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => onDone(await api(`/admin/cooperatives/${coop.id}`, { method: 'PATCH', body: { name: f.name, facilityName: f.facilityName, address: f.address, contact: { personName: f.personName, phone: f.phone, email: f.email } } })));
  };
  return (
    <Modal title="Edit Cooperative" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField label="Cooperative name" required value={f.name} onChange={set('name')} />
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Facility name" value={f.facilityName} onChange={set('facilityName')} />
          <TextField label="Address" value={f.address} onChange={set('address')} />
          <TextField label="Contact person" value={f.personName} onChange={set('personName')} />
          <TextField label="Contact mobile" value={f.phone} onChange={set('phone')} />
          <TextField label="Contact email" type="email" value={f.email} onChange={set('email')} className="col-span-2" />
        </div>
        <Notice>{save.error}</Notice>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={save.busy}>Save</Button></div>
      </form>
    </Modal>
  );
}

function AddAdmin({ coopId, onDone, onClose }) {
  const save = useSave();
  const [f, setF] = useState({ name: '', email: '', phone: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const onSubmit = (e) => { e.preventDefault(); save.run(async () => onDone(await api(`/admin/cooperatives/${coopId}/admins`, { method: 'POST', body: f }))); };
  return (
    <Modal title="Add Cooperative Admin" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField label="Full name" required value={f.name} onChange={set('name')} />
        <TextField label="Email" type="email" value={f.email} onChange={set('email')} />
        <TextField label="Mobile number" inputMode="tel" value={f.phone} onChange={set('phone')} hint="They sign in with their email or mobile number." />
        <Notice>{save.error}</Notice>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={save.busy}>Add Admin</Button></div>
      </form>
    </Modal>
  );
}

function Confirm({ title, message, label, danger, action, onDone, onClose }) {
  const save = useSave();
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm">{message}</p>
      <div className="mt-3"><Notice>{save.error}</Notice></div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} disabled={save.busy} onClick={() => save.run(async () => onDone(await action()))}>{label}</Button>
      </div>
    </Modal>
  );
}

export default function CooperativeDetail() {
  const { id } = useParams();
  const { data, error, setData, reload } = useLoad(`/admin/cooperatives/${id}`);
  const [dialog, setDialog] = useState(null);
  const [temp, setTemp] = useState(null);
  useEffect(() => { setDialog(null); }, [id]);

  const back = <Link to="/cooperatives" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={16} /> All cooperatives</Link>;
  if (error) return <>{back}<Notice>{error}</Notice></>;
  if (!data) return <>{back}<p className="text-sm text-muted">Loading…</p></>;
  const { cooperative: c, admins } = data;
  const s = c.subscription;
  const done = (result) => { setDialog(null); if (result?.cooperative) setData(result); else reload(); if (result?.temporaryPassword) setTemp(result); };
  const suspended = c.status === 'suspended';

  return (
    <>
      {back}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl">{c.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="font-mono">{c.tagPrefix}</span>
            {suspended ? <Badge color="red">Suspended</Badge> : <Badge color="green">Active</Badge>}
            <span>Since {date(c.createdAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDialog('profile')}><Pencil size={16} /> Edit</Button>
          <Button variant={suspended ? 'primary' : 'danger'} onClick={() => setDialog('status')}>{suspended ? 'Reactivate' : 'Suspend'}</Button>
        </div>
      </div>
      {suspended && <div className="mb-4"><Notice>This cooperative is suspended. Its admins, staff, and farmers cannot sign in.</Notice></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Cooperative">
          <dl>
            <Row label="Facility">{c.facilityName}</Row>
            <Row label="Address">{c.address}</Row>
            <Row label="Contact person">{c.contact.personName}</Row>
            <Row label="Contact mobile">{c.contact.phone}</Row>
            <Row label="Contact email">{c.contact.email}</Row>
            <Row label="Standard contract">{c.contractMonths} months</Row>
          </dl>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base">Subscription</h2>
            <Button variant="secondary" onClick={() => setDialog('subscription')}><Pencil size={16} /> Edit</Button>
          </div>
          <dl>
            <Row label="Plan"><span className="capitalize">{s.plan}</span></Row>
            <Row label="Status"><SubscriptionBadge sub={s} /></Row>
            <Row label="Starts">{s.startedAt && date(s.startedAt)}</Row>
            <Row label="Ends">{s.endsAt ? date(s.endsAt) : 'No end date'}</Row>
            <Row label="Most sacks allowed">{number(s.capacityLimit)}</Row>
            <Row label="Features">{s.enabledFeatures.length ? s.enabledFeatures.map((f) => FEATURE_LABELS[f]).join(', ') : 'None'}</Row>
          </dl>
          {s.notes && <p className="mt-2 text-xs text-muted">{s.notes}</p>}
        </Card>

        <Card title="Use">
          {c.capacity ? <CapacityBar used={c.sacksStored} capacity={c.capacity} /> : <p className="text-sm text-muted">No storage layout yet. The cooperative admin sets it up in Settings.</p>}
          <dl className="mt-3">
            <Row label="Quadrants">{number(c.quadrants)}</Row>
            <Row label="Layout capacity">{number(c.capacity)} of {number(s.capacityLimit)} allowed</Row>
            <Row label="Active farmers">{number(c.activeFarmers)}</Row>
            <Row label="Active admins and staff">{number(c.activeTeam)}</Row>
            <Row label="Last scan">{c.lastActivityAt ? dateTime(c.lastActivityAt) : 'None yet'}</Row>
          </dl>
          <p className="mt-2 text-xs text-muted">Counts only. Farmer details stay with the cooperative.</p>
        </Card>

        <Card className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base">Cooperative Admins</h2>
              <p className="text-xs text-muted">Admins manage their own staff and farmers. Reset a password here if an admin is locked out.</p>
            </div>
            <Button onClick={() => setDialog('admin')} className="shrink-0"><Plus size={16} /> Add Admin</Button>
          </div>
          <Table minWidth={640} columns={['Name', 'Signs in with', 'Status', 'Last sign-in', '']}>
            {admins.map((a) => (
              <tr key={a.id}>
                <Td className="font-medium">{a.name}</Td>
                <Td>{[a.email, a.phone].filter(Boolean).join(' · ')}</Td>
                <Td>{!a.active ? <Badge>Turned off</Badge> : a.mustChangePassword ? <Badge color="amber">Temporary password</Badge> : <Badge color="green">Active</Badge>}</Td>
                <Td className="whitespace-nowrap">{dateTime(a.lastLoginAt)}</Td>
                <Td className="text-right"><Button variant="secondary" onClick={() => setDialog({ reset: a })}>Reset Password</Button></Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      {dialog === 'profile' && <EditProfile coop={c} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'subscription' && <EditSubscription coop={c} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'admin' && <AddAdmin coopId={c.id} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'status' && (
        <Confirm
          title={suspended ? 'Reactivate Cooperative' : 'Suspend Cooperative'} label={suspended ? 'Reactivate' : 'Suspend'} danger={!suspended}
          message={suspended ? `${c.name}'s users will be able to sign in again.` : `Everyone at ${c.name} (admins, staff, and farmers) will be unable to sign in until you reactivate it. Their records are kept.`}
          action={() => api(`/admin/cooperatives/${c.id}`, { method: 'PATCH', body: { status: suspended ? 'active' : 'suspended' } })}
          onClose={() => setDialog(null)} onDone={done}
        />
      )}
      {dialog?.reset && (
        <Confirm
          title="Reset Password" label="Reset Password" danger
          message={`Reset the password for ${dialog.reset.name}? Their current password will stop working, and their account will be turned on if it was off.`}
          action={() => api(`/admin/cooperatives/${c.id}/admins/${dialog.reset.id}/reset-password`, { method: 'POST' })}
          onClose={() => setDialog(null)} onDone={done}
        />
      )}
      {temp && <TemporaryPassword name={temp.admin.name} password={temp.temporaryPassword} onClose={() => setTemp(null)} />}
    </>
  );
}

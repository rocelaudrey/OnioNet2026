import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Package, Pencil, Plus } from 'lucide-react';
import { Card, EmptyState } from '../../components/Card.jsx';
import { Badge, Button, Modal, Notice, Table, Td, TextField } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { date, dateTime, formatPHP, number } from '../../lib/format.js';
import { useLoad, useSave } from '../../lib/useLoad.js';
import FarmerForm from './FarmerForm.jsx';
import { StatusBadge, TierBadge } from './badges.jsx';
import { BatchStatusBadge } from '../inventory/labels.jsx';
import RecordPayment from '../transactions/RecordPayment.jsx';
import { BalanceText, PlanBadge } from '../transactions/labels.jsx';

function Row({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm">{children || <span className="text-muted">Not set</span>}</dd>
    </div>
  );
}

// Shown once after a login is created or its password is reset.
function TemporaryPassword({ name, password, onClose }) {
  return (
    <Modal title="Temporary Password" onClose={onClose}>
      <p className="text-sm">Give this password to <span className="font-medium">{name}</span>. They will be asked to choose their own when they sign in.</p>
      <p className="my-4 select-all rounded-lg bg-page px-4 py-3 text-center font-mono text-xl tracking-wider">{password}</p>
      <Notice kind="warning">This is shown only once. If it is lost, reset the password again.</Notice>
      <div className="mt-4 flex justify-end"><Button onClick={onClose}>Done</Button></div>
    </Modal>
  );
}

function EnableLogin({ member, portal, onDone, onClose }) {
  const save = useSave();
  const [phone, setPhone] = useState(portal.phone || member.phone);
  const [email, setEmail] = useState(portal.email || '');
  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => onDone(await api(`/members/${member.id}/portal-access`, { method: 'POST', body: { action: 'enable', phone, email } })));
  };
  return (
    <Modal title="Farmer Login" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm">{member.fullName} will be able to sign in and see their own sacks, batches, and fees. They cannot change anything.</p>
        <TextField label="Mobile number" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <TextField label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} hint="The farmer signs in with their mobile number or email." />
        <Notice>{save.error}</Notice>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.busy}>{save.busy ? 'Saving…' : 'Turn On Login'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function Confirm({ title, message, confirmLabel, action, onDone, onClose }) {
  const save = useSave();
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm">{message}</p>
      <div className="mt-3"><Notice>{save.error}</Notice></div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={save.busy} onClick={() => save.run(async () => onDone(await action()))}>
          {save.busy ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

function LoginCard({ member, portal, onChange }) {
  const [dialog, setDialog] = useState(null); // 'enable' | 'disable' | 'reset'
  const [temp, setTemp] = useState(null);
  const call = (action) => () => api(`/members/${member.id}/portal-access`, { method: 'POST', body: { action } });
  const done = (result) => {
    setDialog(null);
    if (result.temporaryPassword) setTemp(result.temporaryPassword);
    onChange();
  };
  const on = portal.hasLogin && portal.active;

  return (
    <Card title="Farmer Login">
      {!portal.hasLogin && <p className="text-sm text-muted">This farmer cannot sign in yet. Turn on a login so they can see their own sacks and fees.</p>}
      {portal.hasLogin && (
        <dl className="space-y-3">
          <Row label="Status">
            {!portal.active ? <Badge>Turned off</Badge>
              : portal.mustChangePassword ? <Badge color="amber">Temporary password</Badge>
                : <Badge color="green">Active</Badge>}
          </Row>
          <Row label="Signs in with">{[portal.phone, portal.email].filter(Boolean).join(' · ')}</Row>
          <Row label="Last sign-in">{dateTime(portal.lastLoginAt)}</Row>
        </dl>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {!on && <Button onClick={() => setDialog('enable')} disabled={member.status !== 'active'}>Turn On Login</Button>}
        {on && <Button variant="secondary" onClick={() => setDialog('reset')}>Reset Password</Button>}
        {on && <Button variant="danger" onClick={() => setDialog('disable')}>Turn Off Login</Button>}
      </div>
      {!on && member.status !== 'active' && <p className="mt-2 text-xs text-muted">Make this farmer active to turn on their login.</p>}

      {dialog === 'enable' && <EnableLogin member={member} portal={portal} onDone={done} onClose={() => setDialog(null)} />}
      {dialog === 'reset' && (
        <Confirm
          title="Reset Password" confirmLabel="Reset Password" action={call('reset')} onDone={done} onClose={() => setDialog(null)}
          message={`Reset the password for ${member.fullName}? Their current password will stop working.`}
        />
      )}
      {dialog === 'disable' && (
        <Confirm
          title="Turn Off Login" confirmLabel="Turn Off Login" action={call('disable')} onDone={done} onClose={() => setDialog(null)}
          message={`${member.fullName} will be signed out and will not be able to sign in. Their records are kept.`}
        />
      )}
      {temp && <TemporaryPassword name={member.fullName} password={temp} onClose={() => setTemp(null)} />}
    </Card>
  );
}

export default function FarmerDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useLoad(`/members/${id}`);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const navigate = useNavigate();

  const back = (
    <Link to="/farmers" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <ArrowLeft size={16} /> All farmers
    </Link>
  );
  if (loading) return <>{back}<p className="text-sm text-muted">Loading…</p></>;
  if (error) return <>{back}<Notice>{error}</Notice></>;

  const { member, portal, storage, deliveries = [], account } = data;
  const address = [member.address.barangay, member.address.municipality, member.address.province].filter(Boolean).join(', ');

  return (
    <>
      {back}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl">{member.fullName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{member.memberNo}</span>
            <TierBadge tier={member.tier} />
            <StatusBadge status={member.status} />
          </div>
        </div>
        <Button onClick={() => setEditing(true)}><Pencil size={16} /> Edit</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Row label="Mobile number">{member.phone}</Row>
            <Row label="Address">{address}</Row>
            <Row label="Birth date">{member.birthDate && date(member.birthDate)}</Row>
            <Row label="Farm area">{member.farmAreaHa != null && `${number(member.farmAreaHa)} ha`}</Row>
            <Row label="RSBSA number">{member.rsbsaNo}</Row>
            <Row label="Date joined">{member.joinedAt && date(member.joinedAt)}</Row>
            <div className="sm:col-span-2"><Row label="Notes">{member.notes}</Row></div>
          </dl>
        </Card>

        <LoginCard member={member} portal={portal} onChange={reload} />

        <Card className="lg:col-span-3">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base">Deliveries and Balance</h2>
              <p className="text-xs text-muted">{number(storage.sacksStored)} sacks in storage across {number(storage.batches)} {storage.batches === 1 ? 'delivery' : 'deliveries'}</p>
            </div>
            {deliveries.length > 0 && <Button onClick={() => setPaying(true)}><Plus size={16} /> Record Payment</Button>}
          </div>
          {deliveries.length === 0 ? (
            <EmptyState icon={Package} title="No deliveries yet" detail="This farmer's deliveries, sacks, and fees will appear here once a delivery is received." />
          ) : (
            <>
              <Table minWidth={720} columns={['Delivery No.', 'Received', 'Sacks stored', 'Status', 'Charges', 'Balance']}>
                {deliveries.map((d) => (
                  <tr
                    key={d.id} tabIndex={0} role="link" aria-label={`Open delivery ${d.batchNo}`}
                    onClick={() => navigate(`/inventory/${d.id}`)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/inventory/${d.id}`)}
                    className="cursor-pointer hover:bg-page focus:bg-page focus:outline-none"
                  >
                    <Td className="whitespace-nowrap text-muted">{d.batchNo}</Td>
                    <Td className="whitespace-nowrap">{date(d.receivedAt)}</Td>
                    <Td>{number(d.sacksStored)}</Td>
                    <Td><BatchStatusBadge batch={{ status: d.status, overdue: d.sacksStored > 0 && new Date(d.contractEnd) < new Date() }} /></Td>
                    <Td className="whitespace-nowrap">{formatPHP(d.totalCentavos)}</Td>
                    <Td className="whitespace-nowrap"><BalanceText centavos={d.balanceCentavos} format={formatPHP} />{d.planStatus && <span className="ml-2"><PlanBadge status={d.planStatus} /></span>}</Td>
                  </tr>
                ))}
              </Table>
              <p className="mt-4 text-right text-sm">Total balance: <BalanceText centavos={account.balanceCentavos} format={formatPHP} /></p>
            </>
          )}
        </Card>
      </div>

      {paying && <RecordPayment farmer={member} onClose={() => setPaying(false)} onDone={(t) => navigate(`/transactions/${t.id}`)} />}
      {editing && <FarmerForm farmer={member} onClose={() => setEditing(false)} onDone={() => { setEditing(false); reload(); }} />}
    </>
  );
}

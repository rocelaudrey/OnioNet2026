import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck, FileText, LogOut, Package, Pencil, ScanLine } from 'lucide-react';
import { Card, EmptyState } from '../../components/Card.jsx';
import { Badge, Button, Field, Modal, Notice, SelectField, Table, Td, TextField, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { date, dateTime, formatPHP, number } from '../../lib/format.js';
import { useLoad, useSave } from '../../lib/useLoad.js';
import { BatchStatusBadge, CHARGED_PER, SACK_STATUS } from './labels.jsx';
import AccountCard from '../transactions/AccountCard.jsx';
import { PlanBadge } from '../transactions/labels.jsx';
import { CONDITION_LABELS } from '../../../shared/statuses.js';

export const CONDITION_COLORS = { good: 'green', fair: 'amber', poor: 'red' };
export const CONDITION_OPTIONS = [['good', 'Good'], ['fair', 'Fair'], ['poor', 'Poor']];

// Records how the onions look now. Each check is kept in the audit log.
function ConditionForm({ batch, onDone, onClose }) {
  const save = useSave();
  const [form, setForm] = useState({ rating: batch.condition?.rating ?? 'good', notes: '' });
  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => onDone(await api(`/batches/${batch.id}`, { method: 'PATCH', body: { condition: form } })));
  };
  return (
    <Modal title="Check Condition" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <SelectField label="Condition of the onions" value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })} options={CONDITION_OPTIONS} />
        <TextField
          label="What did you see? (optional)" value={form.notes} maxLength={300}
          onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. A few sacks sprouting near the door"
        />
        <p className="text-xs text-muted">This is a record only. Damaged sacks can be marked one by one from their tag.</p>
        <Notice>{save.error}</Notice>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.busy}>{save.busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function Row({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm">{children || <span className="text-muted">Not set</span>}</dd>
    </div>
  );
}

function EditForm({ batch, onDone, onClose }) {
  const save = useSave();
  const [form, setForm] = useState({
    declaredSackCount: String(batch.declaredSackCount), variety: batch.variety, sizeClass: batch.sizeClass,
    grade: batch.grade, totalWeightKg: batch.totalWeightKg ?? '', notes: batch.notes,
    farmId: batch.farm?.id ?? '',
  });
  const farms = [...batch.ownerFarms];
  if (batch.farm && !farms.some((f) => String(f.id) === String(batch.farm.id))) farms.push({ id: batch.farm.id, name: batch.farm.name });
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const receiving = batch.status === 'receiving';
  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => {
      const body = { ...form };
      if (receiving) body.declaredSackCount = Number(form.declaredSackCount);
      else delete body.declaredSackCount;
      onDone(await api(`/batches/${batch.id}`, { method: 'PATCH', body }));
    });
  };
  return (
    <Modal title="Edit Delivery" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField
          label="Number of sacks" type="number" min={Math.max(1, batch.sacksReceived)} step="1" required disabled={!receiving}
          value={form.declaredSackCount} onChange={set('declaredSackCount')}
          hint={receiving ? `${number(batch.sacksReceived)} scanned in so far.` : 'Can only be changed while the delivery is being received.'}
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Variety" value={form.variety} onChange={set('variety')} />
          <TextField label="Total weight (kg)" type="number" min="0" step="0.1" value={form.totalWeightKg} onChange={set('totalWeightKg')} />
          <TextField label="Size class" value={form.sizeClass} onChange={set('sizeClass')} />
          <TextField label="Grade" value={form.grade} onChange={set('grade')} />
        </div>
        {batch.memberId && (
          <SelectField
            label="From farm" value={String(form.farmId)} onChange={set('farmId')}
            options={[['', farms.length ? 'Not recorded' : 'This farmer has no farms yet'], ...farms.map((f) => [String(f.id), f.name])]}
          />
        )}
        <Field label="Notes"><textarea rows={2} className={inputClass} value={form.notes} onChange={set('notes')} /></Field>
        <p className="text-xs text-muted">The owner and the fee rates of a delivery cannot be changed.</p>
        <Notice>{save.error}</Notice>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.busy}>{save.busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function BatchDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, setData } = useLoad(`/batches/${id}`);
  const cancel = useSave();
  const release = useSave();
  const [dialog, setDialog] = useState(null); // 'edit' | 'cancel' | 'condition'

  const back = (
    <Link to="/inventory" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <ArrowLeft size={16} /> Inventory
    </Link>
  );
  if (loading) return <>{back}<p className="text-sm text-muted">Loading…</p></>;
  if (error) return <>{back}<Notice>{error}</Notice></>;

  const { batch, sacks, releases = [], account, transactions = [] } = data;
  const canRelease = ['stored', 'partly_released'].includes(batch.status) && batch.sacksStored > 0;
  const onRelease = () => release.run(async () => {
    const { releaseNo } = await api('/custody/releases', { method: 'POST', body: { batchId: id } });
    navigate(`/inventory/${id}/release/${releaseNo}`);
  });
  const terms = batch.feeTerms;
  const receiving = batch.status === 'receiving';
  const onCancel = () => cancel.run(async () => {
    setData(await api(`/batches/${id}/cancel`, { method: 'POST' }));
    setDialog(null);
  });

  return (
    <>
      {back}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl">{batch.ownerName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{batch.batchNo}</span>
            <BatchStatusBadge batch={batch} />
            {account?.plan && <PlanBadge status={account.plan.status} />}
            {batch.ownerType === 'guest' && <Badge color="orange">Guest</Badge>}
            {batch.ownerType === 'trader' && <Badge>Trader</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {receiving && <Button onClick={() => navigate(`/inventory/${id}/receive`)}><ScanLine size={16} /> Scan Sacks In</Button>}
          {canRelease && <Button onClick={onRelease} disabled={release.busy}><LogOut size={16} /> Release Sacks</Button>}
          {['stored', 'partly_released', 'receiving'].includes(batch.status) && <Button variant="secondary" onClick={() => setDialog('condition')}><ClipboardCheck size={16} /> Check Condition</Button>}
          {batch.status !== 'cancelled' && <Button variant="secondary" onClick={() => setDialog('edit')}><Pencil size={16} /> Edit</Button>}
          {receiving && batch.sacksReceived === 0 && <Button variant="danger" onClick={() => setDialog('cancel')}>Cancel Delivery</Button>}
        </div>
      </div>

      <Notice>{release.error}</Notice>
      {receiving && (
        <div className="mb-4">
          <Notice kind="warning">
            This delivery is still being received: {number(batch.sacksReceived)} of {number(batch.declaredSackCount)} sacks are scanned in.
          </Notice>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Delivery" className="lg:col-span-2">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Row label="Owner">
              {batch.memberId ? <Link className="font-medium text-brand-green hover:underline" to={`/farmers/${batch.memberId}`}>{batch.ownerName}</Link> : batch.ownerName}
            </Row>
            <Row label="Received">{dateTime(batch.receivedAt)}</Row>
            <Row label="Received by">{batch.receivedByName}</Row>
            <Row label="Sacks in storage">{number(batch.sacksStored)} of {number(batch.sacksReceived)} received</Row>
            <Row label="Contract ends">{date(batch.contractEnd)}</Row>
            <Row label="Total weight">{batch.totalWeightKg != null && `${number(batch.totalWeightKg)} kg`}</Row>
            <Row label="Variety">{batch.variety}</Row>
            <Row label="Size class">{batch.sizeClass}</Row>
            <Row label="Grade">{batch.grade}</Row>
            {batch.ownerType !== 'coop_owned' && <Row label="From farm">{batch.farm && <>{batch.farm.name}{batch.farm.location && <span className="block text-xs text-muted">{batch.farm.location}</span>}</>}</Row>}
            <div className={batch.ownerType === 'coop_owned' ? 'sm:col-span-3' : 'sm:col-span-2'}>
              <Row label="Condition">
                {batch.condition && (
                  <>
                    <Badge color={CONDITION_COLORS[batch.condition.rating]}>{CONDITION_LABELS[batch.condition.rating]}</Badge>
                    {batch.condition.notes && <span> {batch.condition.notes}</span>}
                    <span className="block text-xs text-muted">Checked {dateTime(batch.condition.checkedAt)} by {batch.condition.checkedByName}</span>
                  </>
                )}
              </Row>
            </div>
            <div className="sm:col-span-3"><Row label="Notes">{batch.notes}</Row></div>
          </dl>
        </Card>

        <Card title="Fee Rates">
          {batch.ownerType === 'coop_owned' ? <p className="text-sm text-muted">Cooperative stock is stored at no charge.</p> : (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">Storage fee, per sack</dt><dd className="font-medium">{formatPHP(terms.storageFeeCentavos)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Overdue fee, per sack per day</dt><dd className="font-medium">{formatPHP(terms.overdueFeePerDayCentavos)}</dd></div>
              {terms.added.map((fee) => (
                <div key={fee.name} className="flex justify-between gap-3"><dt className="text-muted">{fee.name}, {CHARGED_PER[fee.chargedPer]}</dt><dd className="font-medium">{formatPHP(fee.amountCentavos)}</dd></div>
              ))}
              {terms.memberDiscountPercent > 0 && (
                <div className="flex justify-between gap-3"><dt className="text-muted">Member discount</dt><dd className="font-medium">{terms.memberDiscountPercent}%</dd></div>
              )}
            </dl>
          )}
          <p className="mt-3 text-xs text-muted">These are the rates in force when the delivery was received. Later changes in Settings do not affect it.</p>
        </Card>

        {account && <AccountCard batch={batch} account={account} transactions={transactions} onChanged={setData} />}

        {releases.length > 0 && (
          <Card title="Releases" className="lg:col-span-3">
            <Table minWidth={520} columns={['Release No.', 'Sacks released', 'Date', 'Released by', '']}>
              {releases.map((r) => (
                <tr key={r.releaseNo}>
                  <Td className="whitespace-nowrap font-mono text-xs">{r.releaseNo}</Td>
                  <Td>{number(r.sacks)}</Td>
                  <Td className="whitespace-nowrap">{dateTime(r.at)}</Td>
                  <Td>{r.staff.join(', ')}</Td>
                  <Td className="text-right">
                    <Link to={`/inventory/releases/${r.releaseNo}`} className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-medium hover:bg-page">
                      <FileText size={16} /> Release Slip
                    </Link>
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        )}

        <Card title={`Sacks (${number(sacks.length)})`} className="lg:col-span-3">
          {sacks.length === 0 ? (
            <EmptyState icon={Package} title="No sacks scanned in yet" detail={receiving ? 'Tap "Scan Sacks In" to put a tag on each sack.' : undefined} />
          ) : (
            <Table minWidth={640} columns={['Sack', 'Tag', 'Location', 'Status', 'Scanned in', 'Released']}>
              {sacks.map((s) => {
                const [label, color] = SACK_STATUS[s.status] ?? [s.status, 'gray'];
                return (
                  <tr key={s.id}>
                    <Td className="whitespace-nowrap font-medium">Sack {s.sackNo}</Td>
                    <Td>{s.tagId ? <Link className="whitespace-nowrap font-mono text-xs text-brand-green hover:underline" to={`/qr-tags/${s.tagId}`}>{s.tagCode}</Link> : <span className="text-muted">None</span>}</Td>
                    <Td>{s.status === 'stored' ? s.quadrantCode : ''}</Td>
                    <Td><Badge color={color}>{label}</Badge></Td>
                    <Td className="whitespace-nowrap">{dateTime(s.gateInAt)}</Td>
                    <Td className="whitespace-nowrap">{s.gateOutAt ? dateTime(s.gateOutAt) : ''}</Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      </div>

      {dialog === 'condition' && <ConditionForm batch={batch} onClose={() => setDialog(null)} onDone={(result) => { setData(result); setDialog(null); }} />}
      {dialog === 'edit' && <EditForm batch={batch} onClose={() => setDialog(null)} onDone={(result) => { setData(result); setDialog(null); }} />}
      {dialog === 'cancel' && (
        <Modal title="Cancel Delivery" onClose={() => setDialog(null)}>
          <p className="text-sm">Cancel delivery {batch.batchNo}? No sacks have been scanned in. The record is kept but marked cancelled.</p>
          <div className="mt-3"><Notice>{cancel.error}</Notice></div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>Keep It</Button>
            <Button variant="danger" disabled={cancel.busy} onClick={onCancel}>{cancel.busy ? 'Cancelling…' : 'Cancel Delivery'}</Button>
          </div>
        </Modal>
      )}
    </>
  );
}

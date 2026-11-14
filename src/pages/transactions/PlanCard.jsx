import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Printer } from 'lucide-react';
import { Badge, Button, Field, Modal, Notice, SelectField, Table, Td, TextField, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { date, formatPHP } from '../../lib/format.js';
import { useAuth } from '../../lib/auth.jsx';
import { useSave } from '../../lib/useLoad.js';
import { FREQUENCY_LABELS, INSTALLMENT_STATUS, PlanBadge } from './labels.jsx';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function Schedule({ installments, preview = false }) {
  return (
    <Table minWidth={preview ? 300 : 460} columns={preview ? ['#', 'Due date', 'Amount'] : ['#', 'Due date', 'Amount', 'Paid', 'Status']}>
      {installments.map((row) => {
        // A preview has no paid amounts or status yet.
        const [label, color] = INSTALLMENT_STATUS[row.status] ?? [];
        return (
          <tr key={row.number}>
            <Td>{row.number}</Td>
            <Td className="whitespace-nowrap">{date(row.dueDate)}</Td>
            <Td className="whitespace-nowrap">{formatPHP(row.amountCentavos)}</Td>
            {!preview && <Td className="whitespace-nowrap">{formatPHP(row.paidCentavos)}</Td>}
            {!preview && <Td>{label && <Badge color={color}>{label}</Badge>}</Td>}
          </tr>
        );
      })}
    </Table>
  );
}

function SetupPlan({ batchId, balance, onDone, onClose }) {
  const preview = useSave();
  const save = useSave();
  const [form, setForm] = useState({ count: '3', frequency: 'monthly', firstDueDate: today(), notes: '' });
  const [schedule, setSchedule] = useState(null);
  const set = (field) => (e) => { setForm({ ...form, [field]: e.target.value }); setSchedule(null); };
  const body = (dryRun) => ({ count: Number(form.count), frequency: form.frequency, firstDueDate: form.firstDueDate, notes: form.notes, dryRun });

  const onPreview = (e) => {
    e.preventDefault();
    preview.run(async () => setSchedule(await api(`/batches/${batchId}/payment-plan`, { method: 'POST', body: body(true) })));
  };
  const onSave = () => save.run(async () => onDone(await api(`/batches/${batchId}/payment-plan`, { method: 'POST', body: body(false) })));

  return (
    <Modal title="Set Up Installment Plan" onClose={onClose}>
      <form onSubmit={onPreview} className="space-y-4">
        <p className="text-sm">Split the balance of <span className="font-semibold">{formatPHP(balance)}</span> into installments. The farmer can still pay any amount at any time.</p>
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Number of installments" value={form.count} onChange={set('count')} options={Array.from({ length: 11 }, (_, i) => [String(i + 2), String(i + 2)])} />
          <SelectField label="How often" value={form.frequency} onChange={set('frequency')} options={Object.entries(FREQUENCY_LABELS)} />
        </div>
        <TextField label="First due date" type="date" min={today()} required value={form.firstDueDate} onChange={set('firstDueDate')} />
        <Field label="Notes (optional)">
          <textarea rows={2} className={inputClass} value={form.notes} onChange={set('notes')} placeholder="e.g. Agreed with the farmer at the office" />
        </Field>
        <Notice>{preview.error || save.error}</Notice>
        {schedule && <Schedule preview installments={schedule.installments.map((r, i) => ({ ...r, number: i + 1 }))} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {!schedule
            ? <Button type="submit" disabled={preview.busy}>{preview.busy ? 'Working…' : 'Show Schedule'}</Button>
            : <Button onClick={onSave} disabled={save.busy}>{save.busy ? 'Saving…' : 'Save Plan'}</Button>}
        </div>
      </form>
    </Modal>
  );
}

function CancelPlan({ batchId, onDone, onClose }) {
  const save = useSave();
  const [reason, setReason] = useState('');
  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => onDone(await api(`/batches/${batchId}/payment-plan/cancel`, { method: 'POST', body: { reason } })));
  };
  return (
    <Modal title="Cancel Installment Plan" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm">The schedule is removed. Payments already made stay on the delivery, and you can set up a new plan afterwards.</p>
        <Field label="Reason"><textarea rows={2} required className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Notice>{save.error}</Notice>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Keep Plan</Button>
          <Button type="submit" variant="danger" disabled={save.busy}>{save.busy ? 'Cancelling…' : 'Cancel Plan'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// Installment ("layaway") plan for one delivery. Progress comes from the server.
export default function PlanCard({ batch, account, onChanged }) {
  const { user } = useAuth();
  const isAdmin = user.role === 'coop_admin';
  const [dialog, setDialog] = useState(null);
  const { plan } = account;
  const done = (detail) => { setDialog(null); onChanged(detail); };

  if (!plan) {
    if (!isAdmin || account.balanceCentavos <= 0 || batch.status === 'cancelled') return null;
    return (
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-line p-4">
        <p className="text-sm text-muted">The farmer can pay any amount at any time. To agree on fixed payments with due dates, set up an installment plan.</p>
        <Button variant="secondary" onClick={() => setDialog('setup')}><CalendarClock size={16} /> Set Up Installment Plan</Button>
        {dialog === 'setup' && <SetupPlan batchId={batch.id} balance={account.balanceCentavos} onDone={done} onClose={() => setDialog(null)} />}
      </div>
    );
  }

  return (
    <div className="mt-6 border-t border-line pt-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm">Installment Plan <PlanBadge status={plan.status} showCompleted /></h3>
          <p className="text-xs text-muted">
            {plan.installments.length} payments, {FREQUENCY_LABELS[plan.frequency].toLowerCase()} · set up {date(plan.createdAt)} by {plan.createdByName}
            {plan.notes && ` · ${plan.notes}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`/inventory/${batch.id}/plan`} className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-medium hover:bg-page">
            <Printer size={16} /> Print Schedule
          </Link>
          {isAdmin && plan.status !== 'completed' && <Button variant="danger" onClick={() => setDialog('cancel')}>Cancel Plan</Button>}
        </div>
      </div>

      {plan.status === 'late' && <div className="mb-3"><Notice>{plan.lateCount} {plan.lateCount === 1 ? 'installment is' : 'installments are'} late: {formatPHP(plan.lateCentavos)} overdue on the plan.</Notice></div>}
      {plan.next && plan.status !== 'late' && <p className="mb-3 text-sm">Next: <span className="font-semibold">{formatPHP(plan.next.amountCentavos - plan.next.paidCentavos)}</span> due {date(plan.next.dueDate)}</p>}
      <Schedule installments={plan.installments} />
      <p className="mt-3 text-xs text-muted">
        Paid toward the plan: {formatPHP(plan.paidCentavos)} of {formatPHP(plan.totalCentavos)}.
        {plan.notCoveredCentavos > 0 && <span className="text-critical"> {formatPHP(plan.notCoveredCentavos)} owed since the plan was set up (such as new overdue fees) is not part of it.</span>}
      </p>
      {dialog === 'cancel' && <CancelPlan batchId={batch.id} onDone={done} onClose={() => setDialog(null)} />}
    </div>
  );
}

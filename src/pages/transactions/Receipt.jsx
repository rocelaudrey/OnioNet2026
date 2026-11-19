import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Printer } from 'lucide-react';
import { Button, Field, Modal, Notice, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { date, dateTime, formatPHP } from '../../lib/format.js';
import { useAuth } from '../../lib/auth.jsx';
import { useLoad, useSave } from '../../lib/useLoad.js';
import { CHARGE_KIND_LABELS, METHOD_LABELS, TYPE_LABELS } from './labels.jsx';

const TITLES = { payment: 'Payment Receipt', adjustment: 'Fee Adjustment', refund: 'Refund Slip', charge: 'Charge Slip' };

function Line({ label, children }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function VoidDialog({ id, onDone, onClose }) {
  const save = useSave();
  const [reason, setReason] = useState('');
  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => { await api(`/transactions/${id}/void`, { method: 'POST', body: { reason } }); onDone(); });
  };
  return (
    <Modal title="Void Entry" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm">Voiding cancels this entry and puts the delivery's balance back. The entry is kept and marked voided. This cannot be undone.</p>
        <Field label="Reason">
          <textarea rows={2} required className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Recorded on the wrong delivery" />
        </Field>
        <Notice>{save.error}</Notice>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" disabled={save.busy}>{save.busy ? 'Voiding…' : 'Void Entry'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// Printed in the browser (the print dialog can also save a PDF).
export default function Receipt() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(`/transactions/${id}`);
  const [voiding, setVoiding] = useState(false);

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (error) return <Notice>{error}</Notice>;
  const { transaction: t, cooperative, delivery } = data;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to={`/inventory/${t.batchId}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft size={16} /> Delivery details
        </Link>
        <div className="flex gap-2">
          {user.role === 'coop_admin' && !t.voided && <Button variant="danger" onClick={() => setVoiding(true)}><Ban size={16} /> Void</Button>}
          <Button onClick={() => window.print()}><Printer size={16} /> Print or Save as PDF</Button>
        </div>
      </div>

      {t.voided && (
        <div className="mb-4 print:mb-2">
          <Notice>Voided on {dateTime(t.voidedAt)}{t.voidedByName && ` by ${t.voidedByName}`}: {t.voidReason}</Notice>
        </div>
      )}

      <article className="relative overflow-hidden rounded-xl bg-white p-6 shadow-sm print:rounded-none print:p-0 print:shadow-none">
        {t.voided && (
          <p aria-hidden="true" className="pointer-events-none absolute inset-0 flex -rotate-12 items-center justify-center text-7xl font-bold text-critical/15">VOID</p>
        )}
        <header className="flex items-start justify-between gap-4 border-b-2 border-ink pb-4">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="" className="h-12 w-12" />
            <div>
              <p className="text-lg font-semibold leading-tight">{cooperative.facilityName || cooperative.name}</p>
              <p className="text-xs text-muted">{cooperative.address}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold leading-tight">{TITLES[t.type]}</p>
            <p className="font-mono text-sm">{t.receiptNo}</p>
          </div>
        </header>

        <p className="my-6 text-center">
          <span className="block text-xs text-muted">{{ refund: 'Amount refunded', adjustment: 'Amount waived or discounted', charge: 'Amount charged' }[t.type] ?? 'Amount received'}</span>
          <span className="text-4xl font-bold">{formatPHP(t.amountCentavos)}</span>
        </p>

        <dl>
          <Line label={{ refund: 'Refunded to', charge: 'Charged to' }[t.type] ?? 'Received from'}>{t.ownerName}</Line>
          {t.memberNo && <Line label="Member No.">{t.memberNo}</Line>}
          <Line label="Delivery No.">{t.batchNo}</Line>
          <Line label="Date">{dateTime(t.paidAt)}</Line>
          <Line label="Type">{t.type === 'charge' ? CHARGE_KIND_LABELS[t.chargeKind] ?? 'Charge' : TYPE_LABELS[t.type]}</Line>
          {t.method && <Line label={t.type === 'refund' ? 'Refunded by' : 'Paid by'}>{METHOD_LABELS[t.method]}</Line>}
          {t.referenceNo && <Line label="Reference No.">{t.referenceNo}</Line>}
          {t.notes && <Line label={{ adjustment: 'Reason', charge: 'Details' }[t.type] ?? 'Notes'}>{t.notes}</Line>}
          <Line label="Recorded by">{t.recordedByName}</Line>
          <Line label={`Delivery balance as of ${dateTime(new Date())}`}>{formatPHP(Math.max(0, delivery.balanceCentavos))}</Line>
          {delivery.plan && (
            <Line label="Installment plan">
              {delivery.plan.status === 'completed' ? 'Fully paid'
                : `${formatPHP(delivery.plan.paidCentavos)} of ${formatPHP(delivery.plan.totalCentavos)} paid${delivery.plan.next ? `; next due ${date(delivery.plan.next.dueDate)}` : ''}`}
            </Line>
          )}
        </dl>

        <div className="mt-12 grid grid-cols-2 gap-10 text-center text-xs text-muted">
          <div><div className="border-t border-ink pt-1">Received by (name and signature)</div></div>
          <div><div className="border-t border-ink pt-1">Farmer (name and signature)</div></div>
        </div>
        <p className="mt-6 text-center text-[11px] text-muted">This is an acknowledgment from the cooperative, not an official receipt for tax purposes. Generated by OnioNet.</p>
      </article>

      {voiding && <VoidDialog id={id} onClose={() => setVoiding(false)} onDone={() => { setVoiding(false); reload(); }} />}
    </div>
  );
}

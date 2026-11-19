import { useEffect, useRef, useState } from 'react';
import FarmerPicker from '../../components/FarmerPicker.jsx';
import { Button, Field, Modal, MoneyField, Notice, SelectField, TextField, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatPHP, pesosInput, readPesos } from '../../lib/format.js';
import { useAuth } from '../../lib/auth.jsx';
import { useSave } from '../../lib/useLoad.js';
import { CHARGE_KIND_LABELS, METHOD_LABELS, TYPE_LABELS } from './labels.jsx';

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Record money for one delivery: a payment, a manual charge (hauling, overdue,
// other), or, for admins, a waiver or refund. Pass `delivery` ({ id, batchNo,
// ownerName, balanceCentavos }) to skip choosing, or `farmer` to start from
// their list. initialType opens the form on a given type.
export default function RecordPayment({ delivery, farmer: presetFarmer, initialType = 'payment', onDone, onClose }) {
  const { user } = useAuth();
  const isAdmin = user.role === 'coop_admin';
  const save = useSave();
  const requestId = useRef(newId());
  const [farmer, setFarmer] = useState(presetFarmer ?? null);
  const [deliveries, setDeliveries] = useState(null);
  const [batchId, setBatchId] = useState(delivery?.id ?? '');
  const [form, setForm] = useState({
    type: initialType,
    amount: initialType === 'payment' && delivery && delivery.balanceCentavos > 0 ? pesosInput(delivery.balanceCentavos) : '',
    method: 'cash', referenceNo: '', paidAt: today(), notes: '', chargeKind: 'hauling',
  });
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  // A payment starts at the balance; anything else starts empty.
  const setType = (e) => {
    const type = e.target.value;
    const bal = (delivery ?? deliveries?.find((d) => String(d.id) === batchId))?.balanceCentavos ?? 0;
    setForm({ ...form, type, amount: type === 'payment' && bal > 0 ? pesosInput(bal) : '' });
  };

  // The farmer's deliveries with their balances, from the fee service.
  useEffect(() => {
    if (delivery || !farmer) { setDeliveries(null); return; }
    let current = true;
    api(`/members/${farmer.id}`).then((data) => {
      if (!current) return;
      const owing = data.deliveries;
      setDeliveries(owing);
      const first = owing.find((d) => d.balanceCentavos > 0) ?? owing[0];
      setBatchId(first ? String(first.id) : '');
      if (first) setForm((f) => (f.type === 'payment' ? { ...f, amount: first.balanceCentavos > 0 ? pesosInput(first.balanceCentavos) : '' } : f));
    }).catch(() => current && setDeliveries([]));
    return () => { current = false; };
  }, [delivery, farmer]);

  const chosen = delivery ?? deliveries?.find((d) => String(d.id) === batchId);
  const balance = chosen?.balanceCentavos ?? 0;
  const pickDelivery = (e) => {
    setBatchId(e.target.value);
    const d = deliveries.find((x) => String(x.id) === e.target.value);
    if (d && form.type === 'payment') setForm({ ...form, amount: d.balanceCentavos > 0 ? pesosInput(d.balanceCentavos) : '' });
  };

  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => {
      if (!chosen) throw new Error('Choose the delivery this is for.');
      const result = await api('/transactions', {
        method: 'POST',
        body: {
          batchId: chosen.id, type: form.type, amountCentavos: readPesos(form.amount, 'Amount'),
          method: ['payment', 'refund'].includes(form.type) ? form.method : undefined, referenceNo: form.referenceNo,
          chargeKind: form.type === 'charge' ? form.chargeKind : undefined,
          paidAt: form.paidAt, notes: form.notes, clientRequestId: requestId.current,
        },
      });
      onDone(result.transaction);
    });
  };

  const types = Object.entries(TYPE_LABELS).filter(([t]) => isAdmin || t === 'payment' || t === 'charge');
  const titles = { payment: 'Record Payment', charge: 'Add Charge' };
  return (
    <Modal title={titles[form.type] ?? TYPE_LABELS[form.type]} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {delivery ? (
          <div className="rounded-lg bg-page px-3 py-2.5 text-sm">
            <p className="font-medium">{delivery.ownerName}</p>
            <p className="text-xs text-muted">{delivery.batchNo}</p>
          </div>
        ) : (
          <>
            {!presetFarmer && <Field label="Farmer"><FarmerPicker value={farmer} onChange={setFarmer} /></Field>}
            {deliveries && deliveries.length === 0 && <Notice kind="warning">This farmer has no deliveries.</Notice>}
            {deliveries && deliveries.length > 0 && (
              <SelectField
                label="Delivery" value={batchId} onChange={pickDelivery}
                options={deliveries.map((d) => [String(d.id), `${d.batchNo} · ${d.balanceCentavos > 0 ? `owes ${formatPHP(d.balanceCentavos)}` : 'paid'}`])}
              />
            )}
          </>
        )}

        {chosen && (
          <p className="text-sm">
            Balance: <span className={`font-semibold ${balance > 0 ? 'text-critical' : 'text-brand-green'}`}>{formatPHP(Math.max(0, balance))}</span>
            {balance < 0 && <span className="text-muted"> ({formatPHP(-balance)} credit)</span>}
          </p>
        )}

        <SelectField label="Type" value={form.type} onChange={setType} options={types} />
        {form.type === 'charge' && (
          <SelectField label="Charge for" value={form.chargeKind} onChange={set('chargeKind')} options={Object.entries(CHARGE_KIND_LABELS)} />
        )}
        <MoneyField label="Amount" required value={form.amount} onChange={set('amount')} placeholder="0.00" />
        {['payment', 'refund'].includes(form.type) && (
          <div className="grid grid-cols-2 gap-4">
            <SelectField label={form.type === 'refund' ? 'Refunded by' : 'Paid by'} value={form.method} onChange={set('method')} options={Object.entries(METHOD_LABELS)} />
            <TextField
              label="Reference number" value={form.referenceNo} onChange={set('referenceNo')}
              required={form.method !== 'cash'} disabled={form.method === 'cash'} placeholder={form.method === 'cash' ? 'Not needed' : ''}
            />
          </div>
        )}
        <TextField label="Date" type="date" max={today()} required value={form.paidAt} onChange={set('paidAt')} />
        <Field label={form.type === 'adjustment' ? 'Reason' : form.type === 'charge' && form.chargeKind === 'other' ? 'What is it for?' : form.type === 'charge' ? 'Details (optional)' : 'Notes (optional)'}>
          <textarea
            rows={2} className={inputClass} value={form.notes} onChange={set('notes')}
            required={form.type === 'adjustment' || (form.type === 'charge' && form.chargeKind === 'other')}
            placeholder={form.type === 'charge' ? (form.chargeKind === 'hauling' ? 'e.g. ₱20 × 85 sacks' : form.chargeKind === 'overdue' ? 'e.g. 2 months past the contract, 40 sacks' : '') : ''}
          />
        </Field>
        <Notice>{save.error}</Notice>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.busy || !chosen}>{save.busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

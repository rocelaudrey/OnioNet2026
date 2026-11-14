import { useEffect, useRef, useState } from 'react';
import FarmerPicker from '../../components/FarmerPicker.jsx';
import { Button, Field, Modal, MoneyField, Notice, SelectField, TextField, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatPHP, pesosInput, readPesos } from '../../lib/format.js';
import { useAuth } from '../../lib/auth.jsx';
import { useSave } from '../../lib/useLoad.js';
import { METHOD_LABELS, TYPE_LABELS } from './labels.jsx';

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Record money for one delivery. Pass `delivery` ({ id, batchNo, ownerName,
// balanceCentavos }) to skip choosing, or `farmer` to start from their list.
export default function RecordPayment({ delivery, farmer: presetFarmer, onDone, onClose }) {
  const { user } = useAuth();
  const isAdmin = user.role === 'coop_admin';
  const save = useSave();
  const requestId = useRef(newId());
  const [farmer, setFarmer] = useState(presetFarmer ?? null);
  const [deliveries, setDeliveries] = useState(null);
  const [batchId, setBatchId] = useState(delivery?.id ?? '');
  const [form, setForm] = useState({
    type: 'payment', amount: delivery && delivery.balanceCentavos > 0 ? pesosInput(delivery.balanceCentavos) : '',
    method: 'cash', referenceNo: '', paidAt: today(), notes: '',
  });
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

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
      if (first) setForm((f) => ({ ...f, amount: first.balanceCentavos > 0 ? pesosInput(first.balanceCentavos) : '' }));
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
          method: form.type === 'adjustment' ? undefined : form.method, referenceNo: form.referenceNo,
          paidAt: form.paidAt, notes: form.notes, clientRequestId: requestId.current,
        },
      });
      onDone(result.transaction);
    });
  };

  const types = isAdmin ? Object.entries(TYPE_LABELS) : [['payment', 'Payment']];
  return (
    <Modal title={form.type === 'payment' ? 'Record Payment' : TYPE_LABELS[form.type]} onClose={onClose}>
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

        {types.length > 1 && <SelectField label="Type" value={form.type} onChange={set('type')} options={types} />}
        <MoneyField label="Amount" required value={form.amount} onChange={set('amount')} placeholder="0.00" />
        {form.type !== 'adjustment' && (
          <div className="grid grid-cols-2 gap-4">
            <SelectField label={form.type === 'refund' ? 'Refunded by' : 'Paid by'} value={form.method} onChange={set('method')} options={Object.entries(METHOD_LABELS)} />
            <TextField
              label="Reference number" value={form.referenceNo} onChange={set('referenceNo')}
              required={form.method !== 'cash'} disabled={form.method === 'cash'} placeholder={form.method === 'cash' ? 'Not needed' : ''}
            />
          </div>
        )}
        <TextField label="Date" type="date" max={today()} required value={form.paidAt} onChange={set('paidAt')} />
        <Field label={form.type === 'adjustment' ? 'Reason' : 'Notes (optional)'}>
          <textarea rows={2} required={form.type === 'adjustment'} className={inputClass} value={form.notes} onChange={set('notes')} />
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

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Card } from '../../components/Card.jsx';
import { Badge, Button, Modal, MoneyField, Notice, SelectField, Table, Td, TextField } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatPHP, pesosInput, readPesos } from '../../lib/format.js';
import { useLoad, useSave } from '../../lib/useLoad.js';

const CHARGED_PER = [
  ['sack', 'Once per sack'],
  ['batch', 'Once per delivery'],
  ['sack_per_month', 'Per sack, every month in storage'],
];
const APPLIES_TO = [
  ['every_batch', 'Every delivery'],
  ['optional', 'Only when selected at intake'],
];
const labelOf = (options, value) => options.find(([v]) => v === value)?.[1] ?? value;

function AddedFeeForm({ fee, onDone, onClose }) {
  const save = useSave();
  const [form, setForm] = useState({
    name: fee?.name ?? '', amount: fee ? pesosInput(fee.amountCentavos) : '',
    chargedPer: fee?.chargedPer ?? 'sack', appliesTo: fee?.appliesTo ?? 'every_batch',
    active: fee ? String(fee.active) : 'true',
  });
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => {
      const body = {
        name: form.name.trim(), amountCentavos: readPesos(form.amount, 'Amount'),
        chargedPer: form.chargedPer, appliesTo: form.appliesTo,
      };
      const result = fee
        ? await api(`/cooperative/fees/added/${fee.id}`, { method: 'PATCH', body: { ...body, active: form.active === 'true' } })
        : await api('/cooperative/fees/added', { method: 'POST', body });
      onDone(result);
    });
  };

  return (
    <Modal title={fee ? 'Edit Fee' : 'Add Fee'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField label="Fee name" required value={form.name} onChange={set('name')} placeholder="Handling Fee" />
        <MoneyField label="Amount" required value={form.amount} onChange={set('amount')} placeholder="0.00" />
        <SelectField label="How it is charged" value={form.chargedPer} onChange={set('chargedPer')} options={CHARGED_PER} />
        <SelectField label="Applies to" value={form.appliesTo} onChange={set('appliesTo')} options={APPLIES_TO} />
        {fee && (
          <SelectField
            label="Status" value={form.active} onChange={set('active')}
            options={[['true', 'On'], ['false', 'Off']]}
            hint="Turning a fee off stops it for new deliveries. Past deliveries keep it."
          />
        )}
        <Notice>{save.error}</Notice>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.busy}>{save.busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function FeesTab() {
  const { data, error, loading, setData } = useLoad('/cooperative/fees');
  const save = useSave();
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(null); // fee, 'new', or null
  const fees = data?.fees;

  useEffect(() => {
    if (!fees) return;
    setForm({
      storage: pesosInput(fees.storageFeeCentavos),
      overdue: pesosInput(fees.overdueFeePerDayCentavos),
      discount: String(fees.memberDiscountPercent),
    });
  }, [fees]);

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (error) return <Notice>{error}</Notice>;
  if (!form) return null;

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => {
      const discount = Number(form.discount);
      if (form.discount.trim() === '' || !Number.isFinite(discount) || discount < 0 || discount > 100) {
        throw new Error('Member discount: enter a number from 0 to 100.');
      }
      setData(await api('/cooperative/fees', {
        method: 'PATCH',
        body: {
          storageFeeCentavos: readPesos(form.storage, 'Storage fee'),
          overdueFeePerDayCentavos: readPesos(form.overdue, 'Overdue fee'),
          memberDiscountPercent: discount,
        },
      }));
    });
  };

  return (
    <div className="space-y-4">
      {fees.storageFeeCentavos === 0 && (
        <Notice kind="warning">The storage fee is ₱0.00. Set it before receiving deliveries, or sacks will be stored at no charge.</Notice>
      )}

      <Card title="Standard Fees">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <MoneyField label="Storage fee" required value={form.storage} onChange={set('storage')} hint="Per sack, for the contract period." />
            <MoneyField label="Overdue fee" required value={form.overdue} onChange={set('overdue')} hint="Per sack, per day after the contract ends. Can be 0." />
            <TextField
              label="Member discount (%)" inputMode="decimal" required value={form.discount} onChange={set('discount')}
              hint="For members only, not guests."
            />
          </div>
          <p className="text-xs text-muted">Changes apply to new deliveries only. Deliveries already received keep the fees they came in with.</p>
          <Notice>{save.error}</Notice>
          {save.saved && <Notice kind="success">Saved.</Notice>}
          <Button type="submit" disabled={save.busy}>{save.busy ? 'Saving…' : 'Save Fees'}</Button>
        </form>
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base">Other Fees</h2>
          <Button onClick={() => setEditing('new')}><Plus size={16} /> Add Fee</Button>
        </div>
        {fees.added.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No other fees. Add one if your cooperative charges for anything else, such as handling.</p>
        ) : (
          <Table minWidth={720} columns={['Fee', 'Amount', 'How it is charged', 'Applies to', 'Status', '']}>
            {fees.added.map((fee) => (
              <tr key={fee.id}>
                <Td className="font-medium">{fee.name}</Td>
                <Td>{formatPHP(fee.amountCentavos)}</Td>
                <Td>{labelOf(CHARGED_PER, fee.chargedPer)}</Td>
                <Td>{labelOf(APPLIES_TO, fee.appliesTo)}</Td>
                <Td>{fee.active ? <Badge color="green">On</Badge> : <Badge>Off</Badge>}</Td>
                <Td className="text-right"><Button variant="secondary" onClick={() => setEditing(fee)}>Edit</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {editing && (
        <AddedFeeForm
          fee={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(result) => { setEditing(null); setData(result); }}
        />
      )}
    </div>
  );
}

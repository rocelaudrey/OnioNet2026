import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Card } from '../../components/Card.jsx';
import { Badge, Button, CapacityBar, Modal, Notice, SelectField, Table, Td, TextField } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { number } from '../../lib/format.js';
import { useLoad, useSave } from '../../lib/useLoad.js';

function QuadrantForm({ quadrant, nextOrder, onDone, onClose }) {
  const save = useSave();
  const [form, setForm] = useState({
    code: quadrant?.code ?? '', floor: String(quadrant?.floor ?? 1),
    capacity: String(quadrant?.capacity ?? ''), fillOrder: String(quadrant?.fillOrder ?? nextOrder),
    active: quadrant ? String(quadrant.active) : 'true',
  });
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => {
      await api(quadrant ? `/quadrants/${quadrant.id}` : '/quadrants', {
        method: quadrant ? 'PATCH' : 'POST',
        body: {
          code: form.code, floor: Number(form.floor), capacity: Number(form.capacity),
          fillOrder: Number(form.fillOrder), active: form.active === 'true',
        },
      });
      onDone();
    });
  };

  return (
    <Modal title={quadrant ? `Edit ${quadrant.code}` : 'Add Quadrant'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Code" required value={form.code} onChange={set('code')} placeholder="1-A" />
          <TextField label="Floor" type="number" min="1" required value={form.floor} onChange={set('floor')} />
          <TextField label="Capacity (sacks)" type="number" min="0" step="1" required value={form.capacity} onChange={set('capacity')} />
          <TextField label="Fill order" type="number" min="1" step="1" required value={form.fillOrder} onChange={set('fillOrder')} hint="1 is filled first." />
        </div>
        {quadrant && (
          <SelectField label="Status" value={form.active} onChange={set('active')} options={[['true', 'In use'], ['false', 'Turned off']]} />
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

export default function LayoutTab() {
  const { data, error, loading, reload } = useLoad('/quadrants');
  const [editing, setEditing] = useState(null); // quadrant, 'new', or null

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (error) return <Notice>{error}</Notice>;

  const { quadrants, capacityLimit } = data;
  const active = quadrants.filter((q) => q.active);
  const totalCapacity = active.reduce((sum, q) => sum + q.capacity, 0);
  const nextOrder = Math.max(0, ...quadrants.map((q) => q.fillOrder)) + 1;

  return (
    <div className="space-y-4">
      <Card title="Total Capacity">
        <CapacityBar used={totalCapacity} capacity={capacityLimit} unit="sacks allowed by your plan" neutral remainingLabel="more can be added" />
        <p className="mt-3 text-xs text-muted">
          Your {active.length} quadrants in use hold {number(totalCapacity)} sacks in total.
        </p>
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base">Quadrants</h2>
          <Button onClick={() => setEditing('new')}><Plus size={16} /> Add Quadrant</Button>
        </div>
        <Table columns={['Fill order', 'Code', 'Floor', 'Sacks stored', 'Status', '']}>
          {quadrants.map((q) => (
            <tr key={q.id}>
              <Td>{q.fillOrder}</Td>
              <Td className="font-medium">{q.code}</Td>
              <Td>{q.floor}</Td>
              <Td className="min-w-[200px]"><CapacityBar used={q.used} capacity={q.capacity} /></Td>
              <Td>{q.active ? <Badge color="green">In use</Badge> : <Badge>Turned off</Badge>}</Td>
              <Td className="text-right"><Button variant="secondary" onClick={() => setEditing(q)}>Edit</Button></Td>
            </tr>
          ))}
        </Table>
        {quadrants.length === 0 && <p className="py-6 text-center text-sm text-muted">No quadrants yet. Add your first one.</p>}
      </Card>

      {editing && (
        <QuadrantForm
          quadrant={editing === 'new' ? null : editing}
          nextOrder={nextOrder}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

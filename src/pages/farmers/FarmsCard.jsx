import { useCallback, useState } from 'react';
import { MapPin, Pencil, Plus } from 'lucide-react';
import { Card, EmptyState } from '../../components/Card.jsx';
import AddressPicker, { addressBody, addressValue } from '../../components/AddressPicker.jsx';
import { Badge, Button, Modal, Notice, TextField } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { number } from '../../lib/format.js';
import { useSave } from '../../lib/useLoad.js';

// Add (farm = null) or edit one of a farmer's farms.
function FarmForm({ member, farm, onDone, onClose }) {
  const save = useSave();
  const [form, setForm] = useState({ name: farm?.name ?? '', areaHa: farm?.areaHa ?? '', notes: farm?.notes ?? '' });
  // A new farm starts in the farmer's own town, since most farms are nearby.
  const [place, setPlace] = useState(() => addressValue(farm ? farm.location : { ...member.address, barangayCode: '', street: '' }));
  const [placeTouched, setPlaceTouched] = useState(!farm);
  const onPlace = useCallback((next) => { setPlace(next); setPlaceTouched(true); }, []);
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const send = (body) => (farm
    ? api(`/members/${member.id}/farms/${farm.id}`, { method: 'PATCH', body })
    : api(`/members/${member.id}/farms`, { method: 'POST', body }));
  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => {
      const body = { name: form.name, areaHa: form.areaHa, notes: form.notes, ...(placeTouched ? { location: addressBody(place) } : {}) };
      onDone(await send(body));
    });
  };
  const setActive = (active) => save.run(async () => onDone(await send({ active })));

  return (
    <Modal title={farm ? 'Edit Farm' : 'Add Farm'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Farm name" required maxLength={80} value={form.name} onChange={set('name')} placeholder="e.g. Riverside lot" />
          <TextField label="Area (hectares)" type="number" min="0" step="0.01" value={form.areaHa} onChange={set('areaHa')} />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-ink">Where the farm is</legend>
          <AddressPicker value={place} onChange={onPlace} />
        </fieldset>
        <TextField label="Notes (optional)" maxLength={300} value={form.notes} onChange={set('notes')} />
        <Notice>{save.error}</Notice>
        <div className="flex flex-wrap justify-between gap-2">
          {farm ? (
            <Button variant="secondary" onClick={() => setActive(!farm.active)} disabled={save.busy}>
              {farm.active ? 'No Longer Used' : 'Use Again'}
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.busy}>{save.busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// The farms where a farmer grows the onions they store here.
export default function FarmsCard({ member, onChange }) {
  const [editing, setEditing] = useState(null); // null | 'new' | farm
  const farms = [...member.farms].sort((a, b) => Number(b.active) - Number(a.active));
  return (
    <Card className="lg:col-span-3">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base">Farms</h2>
          <p className="text-xs text-muted">Where this farmer grows their onions. Each delivery can record which farm it came from.</p>
        </div>
        <Button variant="secondary" onClick={() => setEditing('new')}><Plus size={16} /> Add Farm</Button>
      </div>
      {farms.length === 0 ? (
        <EmptyState icon={MapPin} title="No farms yet" detail="Add the farms this farmer delivers from." />
      ) : (
        <ul className="divide-y divide-line">
          {farms.map((f) => (
            <li key={f.id} className={`flex items-start justify-between gap-3 py-3 ${f.active ? '' : 'text-muted'}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {f.name}{f.areaHa != null && <span className="font-normal text-muted"> · {number(f.areaHa)} ha</span>}
                  {!f.active && <span className="ml-2"><Badge>No longer used</Badge></span>}
                </p>
                <p className="text-xs text-muted">{f.locationLine}{f.notes && ` · ${f.notes}`}</p>
              </div>
              <button type="button" onClick={() => setEditing(f)} aria-label={`Edit ${f.name}`} className="rounded-lg p-2 text-muted hover:bg-page hover:text-ink">
                <Pencil size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <FarmForm
          member={member} farm={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onDone={() => { setEditing(null); onChange(); }}
        />
      )}
    </Card>
  );
}

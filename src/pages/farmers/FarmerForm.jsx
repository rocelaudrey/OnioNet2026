import { useState } from 'react';
import { Button, Field, Modal, Notice, SelectField, TextField, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useSave } from '../../lib/useLoad.js';

const TIERS = [['member', 'Member'], ['guest', 'Guest']];
const dateInput = (value) => (value ? String(value).slice(0, 10) : '');
const today = () => new Date().toISOString().slice(0, 10);

// Add (farmer = null) or edit a farmer. defaults pre-fills a new farmer's address.
export default function FarmerForm({ farmer, defaults, onDone, onClose }) {
  const save = useSave();
  const [form, setForm] = useState({
    tier: farmer?.tier ?? 'member',
    firstName: farmer?.firstName ?? '', lastName: farmer?.lastName ?? '',
    phone: farmer?.phone ?? '',
    barangay: farmer?.address.barangay ?? '',
    municipality: farmer?.address.municipality ?? defaults?.municipality ?? '',
    province: farmer?.address.province ?? defaults?.province ?? '',
    birthDate: dateInput(farmer?.birthDate),
    farmAreaHa: farmer?.farmAreaHa ?? '',
    rsbsaNo: farmer?.rsbsaNo ?? '',
    joinedAt: dateInput(farmer?.joinedAt),
    notes: farmer?.notes ?? '',
    status: farmer?.status ?? 'active',
  });
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => {
      const body = {
        tier: form.tier, firstName: form.firstName, lastName: form.lastName, phone: form.phone,
        address: { barangay: form.barangay, municipality: form.municipality, province: form.province },
        birthDate: form.birthDate, farmAreaHa: form.farmAreaHa, rsbsaNo: form.rsbsaNo,
        joinedAt: form.joinedAt, notes: form.notes,
      };
      const result = farmer
        ? await api(`/members/${farmer.id}`, { method: 'PATCH', body: { ...body, status: form.status } })
        : await api('/members', { method: 'POST', body });
      onDone(result.member);
    });
  };

  return (
    <Modal title={farmer ? 'Edit Farmer' : 'Add Farmer'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <SelectField
          label="Type" value={form.tier} onChange={set('tier')} options={TIERS}
          hint="Members get the member discount. Guests can store onions but pay the full fee."
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField label="First name" required value={form.firstName} onChange={set('firstName')} />
          <TextField label="Last name" required value={form.lastName} onChange={set('lastName')} />
        </div>
        <TextField label="Mobile number" inputMode="tel" value={form.phone} onChange={set('phone')} />
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Barangay" value={form.barangay} onChange={set('barangay')} />
          <TextField label="Municipality" value={form.municipality} onChange={set('municipality')} />
          <TextField label="Province" value={form.province} onChange={set('province')} className="col-span-2" />
        </div>
        <p className="pt-1 text-xs font-medium text-ink">Optional details</p>
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Birth date" type="date" max={today()} value={form.birthDate} onChange={set('birthDate')} />
          <TextField label="Farm area (hectares)" type="number" min="0" step="0.01" value={form.farmAreaHa} onChange={set('farmAreaHa')} />
          <TextField label="RSBSA number" value={form.rsbsaNo} onChange={set('rsbsaNo')} />
          <TextField label="Date joined" type="date" max={today()} value={form.joinedAt} onChange={set('joinedAt')} />
        </div>
        <Field label="Notes">
          <textarea rows={2} className={inputClass} value={form.notes} onChange={set('notes')} />
        </Field>
        {farmer && (
          <SelectField
            label="Status" value={form.status} onChange={set('status')}
            options={[['active', 'Active'], ['inactive', 'Inactive']]}
            hint="Making a farmer inactive also turns off their login. Their records are kept."
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

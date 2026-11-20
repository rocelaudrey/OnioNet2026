import { useCallback, useState } from 'react';
import AddressPicker, { addressBody, addressValue } from '../../components/AddressPicker.jsx';
import { Button, Field, Modal, Notice, SelectField, TextField, inputClass } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useSave } from '../../lib/useLoad.js';

const TIERS = [['member', 'Member'], ['guest', 'Guest'], ['trader', 'Trader']];
const dateInput = (value) => (value ? String(value).slice(0, 10) : '');
const today = () => new Date().toISOString().slice(0, 10);

// New farmers start with the region, province, and town last used on this
// device, since most farmers of a cooperative live nearby.
const LAST_PLACE = 'onionet:lastPlace';
function lastPlace() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_PLACE) ?? 'null');
    return saved ? { ...saved, barangayCode: '', street: '' } : null;
  } catch {
    return null;
  }
}
function rememberPlace(v) {
  try {
    localStorage.setItem(LAST_PLACE, JSON.stringify({ regionCode: v.regionCode, area: v.area, municipalityCode: v.municipalityCode }));
  } catch { /* storage may be blocked; nothing to do */ }
}

// Add (farmer = null) or edit a farmer.
export default function FarmerForm({ farmer, onDone, onClose }) {
  const save = useSave();
  const [form, setForm] = useState({
    tier: farmer?.tier ?? 'member',
    firstName: farmer?.firstName ?? '', lastName: farmer?.lastName ?? '',
    phone: farmer?.phone ?? '',
    birthDate: dateInput(farmer?.birthDate),
    farmAreaHa: farmer?.farmAreaHa ?? '',
    rsbsaNo: farmer?.rsbsaNo ?? '',
    joinedAt: dateInput(farmer?.joinedAt),
    notes: farmer?.notes ?? '',
    status: farmer?.status ?? 'active',
  });
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const [address, setAddress] = useState(() => (farmer ? addressValue(farmer.address) : lastPlace() ?? addressValue(null)));
  // Older farmers may have a typed address with no codes. It is kept unless
  // someone picks a new one, so editing a name never erases it.
  const [addressTouched, setAddressTouched] = useState(false);
  const oldTypedAddress = farmer && !farmer.address.regionCode ? farmer.addressLine : '';
  const onAddress = useCallback((next) => { setAddress(next); setAddressTouched(true); }, []);

  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => {
      const body = {
        tier: form.tier, firstName: form.firstName, lastName: form.lastName, phone: form.phone,
        ...(!farmer || addressTouched ? { address: addressBody(address) } : {}),
        birthDate: form.birthDate, farmAreaHa: form.farmAreaHa, rsbsaNo: form.rsbsaNo,
        joinedAt: form.joinedAt, notes: form.notes,
      };
      const result = farmer
        ? await api(`/members/${farmer.id}`, { method: 'PATCH', body: { ...body, status: form.status } })
        : await api('/members', { method: 'POST', body });
      if (address.municipalityCode) rememberPlace(address);
      onDone(result.member);
    });
  };

  return (
    <Modal title={farmer ? 'Edit Farmer' : 'Add Farmer'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <SelectField
          label="Type" value={form.tier} onChange={set('tier')} options={TIERS}
          hint="Members get the member discount. Guests (non-member farmers) and traders can store onions but pay the full fee."
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField label="First name" required value={form.firstName} onChange={set('firstName')} />
          <TextField label="Last name" required value={form.lastName} onChange={set('lastName')} />
        </div>
        <TextField label="Mobile number" inputMode="tel" value={form.phone} onChange={set('phone')} />
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-ink">Address</legend>
          {oldTypedAddress && !addressTouched && (
            <p className="text-xs text-muted">Saved address: <span className="text-ink">{oldTypedAddress}</span>. Choose it from the lists below to update it.</p>
          )}
          <AddressPicker value={address} onChange={onAddress} />
        </fieldset>
        <p className="pt-1 text-xs font-medium text-ink">Optional details</p>
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Birth date" type="date" max={today()} value={form.birthDate} onChange={set('birthDate')} />
          <TextField label="Total farm area (hectares)" type="number" min="0" step="0.01" value={form.farmAreaHa} onChange={set('farmAreaHa')} />
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

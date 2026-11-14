import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Card } from '../../components/Card.jsx';
import { Badge, Button, Modal, Notice, SelectField, Table, Td, TextField } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';
import { useLoad, useSave } from '../../lib/useLoad.js';

const ROLES = [['coop_staff', 'Cooperative Staff'], ['coop_admin', 'Cooperative Admin']];

function UserForm({ user, onDone, onClose }) {
  const save = useSave();
  const [form, setForm] = useState({
    name: user?.name ?? '', email: user?.email ?? '', phone: user?.phone ?? '',
    role: user?.role ?? 'coop_staff', active: user ? String(user.active) : 'true',
  });
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => {
      if (!form.email.trim() && !form.phone.trim()) throw new Error('Enter an email or a mobile number. The user signs in with it.');
      const body = { name: form.name, email: form.email, phone: form.phone, role: form.role };
      const result = user
        ? await api(`/users/${user.id}`, { method: 'PATCH', body: user.isYou ? { name: form.name, email: form.email, phone: form.phone } : { ...body, active: form.active === 'true' } })
        : await api('/users', { method: 'POST', body });
      onDone(result);
    });
  };

  return (
    <Modal title={user ? 'Edit User' : 'Add User'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField label="Full name" required value={form.name} onChange={set('name')} />
        <TextField label="Email" type="email" value={form.email} onChange={set('email')} />
        <TextField label="Mobile number" inputMode="tel" value={form.phone} onChange={set('phone')} hint="The user signs in with their email or mobile number." />
        <SelectField
          label="Role" value={form.role} onChange={set('role')} options={ROLES} disabled={user?.isYou}
          hint={user?.isYou ? 'You cannot change your own role.' : 'Admins can change settings, fees, and users. Staff cannot.'}
        />
        {user && !user.isYou && (
          <SelectField label="Status" value={form.active} onChange={set('active')} options={[['true', 'Active'], ['false', 'Turned off']]} hint="Turning a user off signs them out right away." />
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

// Shown once after creating a user or resetting a password.
function TemporaryPassword({ name, password, onClose }) {
  return (
    <Modal title="Temporary Password" onClose={onClose}>
      <p className="text-sm">Give this password to <span className="font-medium">{name}</span>. They will be asked to choose their own when they sign in.</p>
      <p className="my-4 select-all rounded-lg bg-page px-4 py-3 text-center font-mono text-xl tracking-wider">{password}</p>
      <Notice kind="warning">This is shown only once. If it is lost, reset the password again.</Notice>
      <div className="mt-4 flex justify-end"><Button onClick={onClose}>Done</Button></div>
    </Modal>
  );
}

function ResetConfirm({ user, onDone, onClose }) {
  const save = useSave();
  const onConfirm = () => save.run(async () => onDone(await api(`/users/${user.id}/reset-password`, { method: 'POST' })));
  return (
    <Modal title="Reset Password" onClose={onClose}>
      <p className="text-sm">Reset the password for <span className="font-medium">{user.name}</span>? Their current password will stop working.</p>
      <div className="mt-3"><Notice>{save.error}</Notice></div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm} disabled={save.busy}>{save.busy ? 'Resetting…' : 'Reset Password'}</Button>
      </div>
    </Modal>
  );
}

export default function UsersTab() {
  const { data, error, loading, reload } = useLoad('/users');
  const [editing, setEditing] = useState(null); // user, 'new', or null
  const [resetting, setResetting] = useState(null);
  const [temp, setTemp] = useState(null); // { name, password }

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (error) return <Notice>{error}</Notice>;

  const showTemp = (result) => {
    reload();
    if (result?.temporaryPassword) setTemp({ name: result.user.name, password: result.temporaryPassword });
  };

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base">Users</h2>
          <p className="text-xs text-muted">Staff and admins who can sign in. Farmer logins are managed on the Farmers page.</p>
        </div>
        <Button onClick={() => setEditing('new')} className="shrink-0"><Plus size={16} /> Add User</Button>
      </div>
      <Table minWidth={860} columns={['Name', 'Signs in with', 'Role', 'Status', 'Last sign-in', '']}>
        {data.users.map((user) => (
          <tr key={user.id}>
            <Td className="font-medium">{user.name}{user.isYou && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}</Td>
            <Td>{[user.email, user.phone].filter(Boolean).join(' · ')}</Td>
            <Td className="whitespace-nowrap">{user.roleLabel}</Td>
            <Td>
              {!user.active ? <Badge>Turned off</Badge>
                : user.mustChangePassword ? <Badge color="amber">Temporary password</Badge>
                  : <Badge color="green">Active</Badge>}
            </Td>
            <Td className="whitespace-nowrap">{dateTime(user.lastLoginAt)}</Td>
            <Td>
              <div className="flex justify-end gap-2">
                {!user.isYou && user.active && <Button variant="secondary" onClick={() => setResetting(user)}>Reset Password</Button>}
                <Button variant="secondary" onClick={() => setEditing(user)}>Edit</Button>
              </div>
            </Td>
          </tr>
        ))}
      </Table>

      {editing && (
        <UserForm
          user={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(result) => { setEditing(null); showTemp(result); }}
        />
      )}
      {resetting && (
        <ResetConfirm user={resetting} onClose={() => setResetting(null)} onDone={(result) => { setResetting(null); showTemp(result); }} />
      )}
      {temp && <TemporaryPassword {...temp} onClose={() => setTemp(null)} />}
    </Card>
  );
}

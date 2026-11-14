import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/Card.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button, Notice, TextField } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useSave } from '../lib/useLoad.js';

// Used two ways: from the menu, and as a required step when a user signs in
// with a temporary password (forced = true).
export default function ChangePassword({ forced = false }) {
  const { refresh, logout } = useAuth();
  const navigate = useNavigate();
  const save = useSave();
  const [form, setForm] = useState({ current: '', next: '', again: '' });
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const onSubmit = (e) => {
    e.preventDefault();
    save.run(async () => {
      if (form.next !== form.again) throw new Error('The two new passwords do not match.');
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: form.current, newPassword: form.next } });
      setForm({ current: '', next: '', again: '' });
      await refresh();
      if (forced) navigate('/', { replace: true });
    });
  };

  const body = (
    <Card className="max-w-md">
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField label={forced ? 'Temporary password' : 'Current password'} type="password" autoComplete="current-password" required value={form.current} onChange={set('current')} />
        <TextField label="New password" type="password" autoComplete="new-password" required minLength={8} value={form.next} onChange={set('next')} hint="At least 8 characters." />
        <TextField label="New password again" type="password" autoComplete="new-password" required minLength={8} value={form.again} onChange={set('again')} />
        <Notice>{save.error}</Notice>
        {save.saved && !forced && <Notice kind="success">Your password was changed.</Notice>}
        <div className="flex gap-2">
          <Button type="submit" disabled={save.busy}>{save.busy ? 'Saving…' : 'Change Password'}</Button>
          {forced && <Button variant="secondary" onClick={logout}>Sign out</Button>}
        </div>
      </form>
    </Card>
  );

  if (!forced) return <><PageHeader title="Change Password" subtitle="Choose a new password for your account" />{body}</>;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl">Choose your password</h1>
        <p className="mb-5 text-sm text-muted">You signed in with a temporary password. Choose your own to continue.</p>
        {body}
      </div>
    </div>
  );
}

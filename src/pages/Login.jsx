import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(loginName, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'mt-1 w-full rounded-lg border border-line px-3 py-3 text-base outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20';

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="bg-gradient-to-r from-brand-green to-brand-purple px-6 py-6 text-white">
          <p className="text-2xl font-semibold">OnioNet</p>
          <p className="text-sm opacity-90">Cold Storage</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 p-6">
          <h1 className="text-base">Sign in</h1>
          <label className="block text-xs text-muted">
            Email or mobile number
            <input
              type="text"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              required
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs text-muted">
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </label>
          {error && <p role="alert" className="text-sm text-critical">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand-green py-3 font-medium text-white hover:bg-brand-green-dark disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

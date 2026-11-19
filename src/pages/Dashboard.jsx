import { useAuth } from '../lib/auth.jsx';
import MemberHome from './portal/MemberHome.jsx';
import PlatformOverview from './admin/Overview.jsx';
import { Suspense, lazy } from 'react';

// Loaded on its own, so the chart library is not downloaded by phones that
// only scan tags at the gate.
const CoopDashboard = lazy(() => import('./dashboard/CoopDashboard.jsx'));

// Cooperative users get the full dashboard, farmers their own storage, and
// the Super Admin the overview across cooperatives.
export default function Dashboard() {
  const { user } = useAuth();
  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-gradient-to-r from-brand-green to-brand-purple p-6 text-white">
        <h1 className="text-2xl">Welcome back, {user.name}</h1>
        <p className="mt-1 text-sm opacity-90">{user.facilityName || user.cooperativeName || 'OnioNet Platform'}</p>
      </div>

      {user.role === 'super_admin' && <PlatformOverview />}
      {user.role === 'member' && <MemberHome />}
      {(user.role === 'coop_admin' || user.role === 'coop_staff') && (
        <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}><CoopDashboard /></Suspense>
      )}
    </div>
  );
}

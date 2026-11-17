import {
  Package, Warehouse, Building2, CalendarClock, Receipt,
} from 'lucide-react';
import { StatCard } from '../components/StatCard.jsx';
import { useAuth } from '../lib/auth.jsx';
import { Suspense, lazy } from 'react';

// Loaded on its own, so the chart library is not downloaded by phones that
// only scan tags at the gate.
const CoopDashboard = lazy(() => import('./dashboard/CoopDashboard.jsx'));

// Cooperative users get the full dashboard. The farmer and Super Admin cards
// fill in with the farmer portal and Super Admin phases.
export default function Dashboard() {
  const { user } = useAuth();
  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-gradient-to-r from-brand-green to-brand-purple p-6 text-white">
        <h1 className="text-2xl">Welcome back, {user.name}</h1>
        <p className="mt-1 text-sm opacity-90">{user.facilityName || user.cooperativeName || 'OnioNet Platform'}</p>
      </div>

      {user.role === 'super_admin' && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Cooperatives" value="—" icon={Building2} color="green" />
          <StatCard label="Total Capacity" value="—" icon={Warehouse} color="purple" />
          <StatCard label="Sacks in Storage" value="—" icon={Package} color="orange" />
          <StatCard label="Plans Ending Soon" value="—" icon={CalendarClock} color="green" />
        </div>
      )}
      {user.role === 'member' && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="My Sacks in Storage" value="—" icon={Package} color="green" />
          <StatCard label="My Batches" value="—" icon={Warehouse} color="purple" />
          <StatCard label="Balance" value="—" icon={Receipt} color="orange" />
          <StatCard label="Contract Ends" value="—" icon={CalendarClock} color="green" />
        </div>
      )}
      {(user.role === 'coop_admin' || user.role === 'coop_staff') && (
        <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}><CoopDashboard /></Suspense>
      )}
    </div>
  );
}

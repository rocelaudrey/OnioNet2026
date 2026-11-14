import {
  Package, Warehouse, Users, QrCode, Activity, BarChart3, Building2, CalendarClock, Receipt,
} from 'lucide-react';
import { Card, EmptyState } from '../components/Card.jsx';
import { StatCard } from '../components/StatCard.jsx';
import { useAuth } from '../lib/auth.jsx';

// Numbers show "—" until the inventory, tag, and fee features are built.
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
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Sacks in Storage" value="—" icon={Package} color="green" />
            <StatCard label="Available Space" value="—" icon={Warehouse} color="purple" />
            <StatCard label="Farmers" value="—" icon={Users} color="orange" />
            <StatCard label="Tags in Use" value="—" icon={QrCode} color="green" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Entries and Releases">
              <EmptyState icon={BarChart3} title="No data yet" detail="Charts appear here once sacks are scanned in and out." />
            </Card>
            <Card title="Recent Activity">
              <EmptyState icon={Activity} title="No activity yet" detail="Scans, moves, and payments will be listed here." />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

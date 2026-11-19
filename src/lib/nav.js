import {
  LayoutDashboard, Package, QrCode, Users, ArrowLeftRight, FileText, ClipboardList, Settings,
  Building2, CreditCard, Receipt,
} from 'lucide-react';

// Each role has its own nav. Farm Locations is added in a later phase.
const COOP_NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/inventory', label: 'Inventory', icon: Package, subtitle: 'Sacks and batches in storage' },
  { to: '/qr-tags', label: 'QR Tags', icon: QrCode, subtitle: 'Reusable tags and their history' },
  { to: '/farmers', label: 'Farmers', icon: Users, subtitle: 'Members and guests' },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight, subtitle: 'Fees and payments' },
  { to: '/reports', label: 'Reports', icon: FileText, subtitle: 'Storage and fee reports' },
  { to: '/audit-logs', label: 'Audit Logs', icon: ClipboardList, subtitle: 'Record of all changes', adminOnly: true },
  { to: '/settings', label: 'Settings', icon: Settings, subtitle: 'Cooperative setup', adminOnly: true },
];

const MEMBER_NAV = [
  { to: '/', label: 'My Storage', icon: LayoutDashboard, end: true },
  { to: '/my-batches', label: 'My Batches', icon: Package, subtitle: 'Your deliveries and where they are stored' },
  { to: '/my-fees', label: 'My Fees', icon: Receipt, subtitle: 'Your charges and payments' },
  // Farmers are read-only: no actions, only their own records.
];

const SUPER_ADMIN_NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/cooperatives', label: 'Cooperatives', icon: Building2, subtitle: 'Onboard and manage cooperatives' },
  { to: '/subscriptions', label: 'Subscriptions', icon: CreditCard, subtitle: 'Plans and renewals' },
];

export function navFor(role) {
  if (role === 'super_admin') return SUPER_ADMIN_NAV;
  if (role === 'member') return MEMBER_NAV;
  if (role === 'coop_admin') return COOP_NAV;
  return COOP_NAV.filter((item) => !item.adminOnly);
}

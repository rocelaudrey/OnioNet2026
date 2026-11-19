import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, ClipboardCheck, FileText, Package, QrCode, Receipt, Truck, Users } from 'lucide-react';
import { Card } from '../../components/Card.jsx';
import FarmerPicker from '../../components/FarmerPicker.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Button } from '../../components/ui.jsx';

export const REPORTS = [
  { key: 'inventory', title: 'Inventory', icon: Package, detail: 'Sacks in storage by quadrant, farmer, and delivery.' },
  { key: 'movements', title: 'Movements', icon: Truck, detail: 'Sacks received, moved, and released over a period, by day and by staff.' },
  { key: 'fees', title: 'Fees and Collections', icon: Receipt, detail: 'Money collected over a period, and what each delivery still owes.' },
  { key: 'overdue', title: 'Overdue Deliveries', icon: CalendarClock, detail: 'Deliveries past their contract end with sacks still in storage.' },
  { key: 'tags', title: 'Tags', icon: QrCode, detail: 'Tags by status and lot, how often they are reused, and damaged or lost tags.' },
  { key: 'members', title: 'Farmer Masterlist', icon: Users, detail: 'Every farmer with contact details, deliveries, sacks, and balance.' },
];

export default function Reports() {
  const navigate = useNavigate();
  const [farmer, setFarmer] = useState(null);
  return (
    <>
      <PageHeader title="Reports" subtitle="View, print, or save as PDF" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Link key={r.key} to={`/reports/${r.key}`} className="group rounded-xl bg-white p-5 shadow-sm hover:ring-2 hover:ring-brand-green/30">
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint text-brand-green"><r.icon size={20} /></span>
            <p className="font-semibold group-hover:text-brand-green">{r.title}</p>
            <p className="mt-1 text-sm text-muted">{r.detail}</p>
          </Link>
        ))}
        <Card>
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-purple/10 text-brand-purple"><FileText size={20} /></span>
          <p className="font-semibold">Statement of Account</p>
          <p className="mb-3 mt-1 text-sm text-muted">One farmer's charges, payments, and balance for every delivery.</p>
          <FarmerPicker value={farmer} onChange={setFarmer} />
          <Button className="mt-3 w-full" disabled={!farmer} onClick={() => navigate(`/reports/statement/${farmer.id}`)}>Open Statement</Button>
        </Card>
        <Link to="/qr-tags?tab=count" className="group rounded-xl bg-white p-5 shadow-sm hover:ring-2 hover:ring-brand-green/30">
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-orange/15 text-brand-orange"><ClipboardCheck size={20} /></span>
          <p className="font-semibold group-hover:text-brand-green">Tag Count Results</p>
          <p className="mt-1 text-sm text-muted">Missing, unexpected, and wrong-state tags from each tag count. Opens in QR Tags.</p>
        </Link>
      </div>
    </>
  );
}

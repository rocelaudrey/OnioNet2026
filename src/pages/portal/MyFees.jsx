import { Printer } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Button, Notice } from '../../components/ui.jsx';
import { dateTime } from '../../lib/format.js';
import { useAuth } from '../../lib/auth.jsx';
import { useLoad } from '../../lib/useLoad.js';
import { StatementBody } from '../reports/ReportPages.jsx';

// The farmer's own statement: the same figures as the cooperative's Statement of Account.
export default function MyFees() {
  const { user } = useAuth();
  const { data, error } = useLoad('/me/ledger');
  return (
    <>
      <div className="print:hidden">
        <PageHeader title="My Fees" subtitle="Your charges and payments" action={data && <Button variant="secondary" onClick={() => window.print()}><Printer size={16} /> Print</Button>} />
      </div>
      <Notice>{error}</Notice>
      {!data && !error && <p className="text-sm text-muted">Loading…</p>}
      {data && (
        <article className="space-y-5 rounded-xl bg-white p-5 shadow-sm print:p-0 print:shadow-none">
          <header className="hidden items-center justify-between gap-4 border-b-2 border-ink pb-3 print:flex">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="" className="h-10 w-10" />
              <p className="font-semibold">{user.facilityName || user.cooperativeName}</p>
            </div>
            <p className="text-sm">My Fees · as of {dateTime(data.generatedAt)}</p>
          </header>
          <StatementBody data={data} signatures={false} />
          <p className="text-xs text-muted">Overdue fees grow each day sacks stay past the contract end. Pay at the cooperative office.</p>
        </article>
      )}
    </>
  );
}

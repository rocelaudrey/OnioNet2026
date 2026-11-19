import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/Card.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Button, Notice, Table, Td } from '../../components/ui.jsx';
import { date, number } from '../../lib/format.js';
import { useLoad } from '../../lib/useLoad.js';
import { EditSubscription, FEATURE_LABELS, SubscriptionBadge } from './shared.jsx';

// Every cooperative's plan, soonest to end first.
export default function Subscriptions() {
  const { data, error, reload } = useLoad('/admin/cooperatives');
  const [editing, setEditing] = useState(null);
  const [soonOnly, setSoonOnly] = useState(false);
  const rows = (data?.cooperatives ?? [])
    .filter((c) => !soonOnly || c.subscription.endingSoon || c.subscription.ended)
    .sort((a, b) => (a.subscription.endsAt ? new Date(a.subscription.endsAt) : Infinity) - (b.subscription.endsAt ? new Date(b.subscription.endsAt) : Infinity));

  return (
    <>
      <PageHeader title="Subscriptions" subtitle="Plans, sack limits, features, and renewals" />
      <Notice>{error}</Notice>
      {!data && !error && <p className="text-sm text-muted">Loading…</p>}
      {data && (
        <Card>
          <label className="mb-4 flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" className="h-4 w-4 accent-brand-green" checked={soonOnly} onChange={(e) => setSoonOnly(e.target.checked)} />
            Only plans ending within 30 days or already ended
          </label>
          {rows.length === 0 ? <p className="py-6 text-center text-sm text-muted">No plans to show.</p> : (
            <Table minWidth={820} columns={['Cooperative', 'Plan', 'Status', 'Ends', 'Sacks allowed', 'Features', '']}>
              {rows.map((c) => (
                <tr key={c.id}>
                  <Td><Link to={`/cooperatives/${c.id}`} className="font-medium text-ink hover:text-brand-green">{c.name}</Link></Td>
                  <Td className="capitalize">{c.subscription.plan}</Td>
                  <Td><SubscriptionBadge sub={c.subscription} /></Td>
                  <Td className="whitespace-nowrap">{c.subscription.endsAt ? date(c.subscription.endsAt) : 'No end date'}</Td>
                  <Td>{number(c.subscription.capacityLimit)}<span className="block text-xs text-muted">{number(c.capacity)} in layout</span></Td>
                  <Td className="text-xs">{c.subscription.enabledFeatures.map((f) => FEATURE_LABELS[f]).join(', ') || 'None'}</Td>
                  <Td className="text-right"><Button variant="secondary" onClick={() => setEditing(c)}>Edit</Button></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      {editing && <EditSubscription coop={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
    </>
  );
}

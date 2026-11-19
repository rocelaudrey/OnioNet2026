import { Link } from 'react-router-dom';
import { Building2, CalendarClock, Package, Warehouse } from 'lucide-react';
import { Card, EmptyState } from '../../components/Card.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { CapacityBar, Notice, Table, Td } from '../../components/ui.jsx';
import { date, number, timeAgo } from '../../lib/format.js';
import { useLoad } from '../../lib/useLoad.js';
import { SubscriptionBadge } from './shared.jsx';

const ACTION = { create: 'Added', update: 'Changed', password_reset: 'Password reset' };

// The Super Admin's view across every cooperative: counts only, no farmer details.
export default function Overview() {
  const { data, error } = useLoad('/admin/overview');
  if (error) return <Notice>{error}</Notice>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const { totals } = data;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Cooperatives" value={number(totals.active)} icon={Building2} color="green" trend={totals.suspended ? `${number(totals.suspended)} suspended` : 'all active'} />
        <StatCard label="Total Capacity" value={number(totals.capacity)} icon={Warehouse} color="purple" trend="sacks, in active cooperatives" />
        <StatCard label="Sacks in Storage" value={number(totals.sacksStored)} icon={Package} color="orange" trend={`${totals.percentUsed}% used · ${number(totals.activeFarmers)} farmers`} />
        <StatCard label="Plans Ending Soon" value={number(totals.endingSoon)} icon={CalendarClock} color={totals.endingSoon || totals.ended ? 'red' : 'green'} trend={totals.ended ? `${number(totals.ended)} already ended` : 'within 30 days'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Cooperatives" className="lg:col-span-2">
          {data.cooperatives.length === 0 ? <EmptyState icon={Building2} title="No cooperatives yet" detail="Add the first cooperative on the Cooperatives page." /> : (
            <Table minWidth={680} columns={['Cooperative', 'Plan', 'Storage used', 'Farmers', 'Last activity']}>
              {data.cooperatives.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link to={`/cooperatives/${c.id}`} className="font-medium text-ink hover:text-brand-green">{c.name}</Link>
                    <span className="block text-xs text-muted">{c.tagPrefix}{c.status === 'suspended' && ' · suspended'}</span>
                  </Td>
                  <Td><span className="block text-sm capitalize">{c.subscription.plan}</span><SubscriptionBadge sub={c.subscription} /></Td>
                  <Td className="min-w-[180px]">{c.capacity ? <CapacityBar used={c.sacksStored} capacity={c.capacity} unit="" /> : <span className="text-xs text-muted">No layout yet</span>}</Td>
                  <Td>{number(c.activeFarmers)}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{c.lastActivityAt ? timeAgo(c.lastActivityAt) : 'None yet'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Plans Ending">
            {data.endingSoon.length === 0 ? <p className="text-sm text-muted">No plans end in the next 30 days.</p> : (
              <ul className="divide-y divide-line">
                {data.endingSoon.map((c) => (
                  <li key={c.id}>
                    <Link to={`/cooperatives/${c.id}`} className="-mx-2 block rounded-lg px-2 py-2.5 hover:bg-page">
                      <span className="block text-sm font-medium">{c.name}</span>
                      <span className="block text-xs text-muted">{c.subscription.ended ? 'Ended' : 'Ends'} {date(c.subscription.endsAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Recent Platform Changes">
            {data.activity.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
              <ul className="divide-y divide-line">
                {data.activity.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                    <span><span className="font-medium">{ACTION[a.action] ?? a.action}</span> {a.entityLabel}<span className="block text-xs text-muted">by {a.actorName}</span></span>
                    <time className="shrink-0 text-xs text-muted">{timeAgo(a.occurredAt)}</time>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

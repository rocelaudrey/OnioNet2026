import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  ArrowLeftRight, Ban, CalendarClock, CircleCheck, CircleDollarSign, LogOut, Package, PackagePlus, QrCode,
  Receipt, TriangleAlert, Undo2, Wallet, Warehouse,
} from 'lucide-react';
import { Card, EmptyState } from '../../components/Card.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { Badge, Notice } from '../../components/ui.jsx';
import { formatPHP, number, timeAgo } from '../../lib/format.js';
import { useLoad } from '../../lib/useLoad.js';

const GREEN = '#6BA539';
const PURPLE = '#7B2D9E';
const TRACK = '#E5E7EB';
const LEVELS = { optimal: ['Optimal', 'green'], high: ['High', 'amber'], critical: ['Critical', 'red'] };
const shortDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium text-ink">{shortDay(label)}</p>
      <p className="flex items-center gap-2 text-ink"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: GREEN }} /> {number(point.entries)} sacks in</p>
      <p className="flex items-center gap-2 text-ink"><span className="h-0.5 w-2.5" style={{ background: PURPLE }} /> {number(point.releases)} sacks out</p>
    </div>
  );
}

// A dot only on days that had releases, so quiet days are not cluttered.
function ReleaseDot({ cx, cy, value, index }) {
  if (!value) return <g key={index} />;
  return <circle key={index} cx={cx} cy={cy} r={4} fill={PURPLE} stroke="#fff" strokeWidth={2} />;
}

function EntriesAndReleases({ chart, days, setDays }) {
  const [asTable, setAsTable] = useState(false);
  const totalIn = chart.points.reduce((s, p) => s + p.entries, 0);
  const totalOut = chart.points.reduce((s, p) => s + p.releases, 0);
  return (
    <Card className="lg:col-span-2">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base">Entries and Releases</h2>
          <p className="text-xs text-muted">Sacks scanned in and out per day · last {days} days: {number(totalIn)} in, {number(totalOut)} out</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-page p-1" role="group" aria-label="Time range">
          {[7, 14, 30].map((d) => (
            <button
              key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}
              className={`rounded-md px-3 py-1 text-xs ${days === d ? 'bg-white font-medium text-ink shadow-sm' : 'text-muted'}`}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>
      <div className="mb-2 flex items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: GREEN }} /> Sacks in</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3" style={{ background: PURPLE }} /> Sacks out</span>
        <button type="button" onClick={() => setAsTable(!asTable)} className="ml-auto text-xs font-medium text-brand-green hover:underline">
          {asTable ? 'View as chart' : 'View as table'}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-line text-xs text-muted"><th className="py-1.5 font-normal">Day</th><th className="py-1.5 text-right font-normal">Sacks in</th><th className="py-1.5 text-right font-normal">Sacks out</th></tr></thead>
            <tbody className="divide-y divide-line">
              {[...chart.points].reverse().map((p) => (
                <tr key={p.date}><td className="py-1.5">{shortDay(p.date)}</td><td className="py-1.5 text-right">{number(p.entries)}</td><td className="py-1.5 text-right">{number(p.releases)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-64" role="img" aria-label={`Bar and line chart: ${totalIn} sacks in and ${totalOut} sacks out over the last ${days} days`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart.points} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke={TRACK} />
              <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} minTickGap={16} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: '#F5F6F8' }} />
              <Bar dataKey="entries" name="Sacks in" fill={GREEN} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Line dataKey="releases" name="Sacks out" stroke={PURPLE} strokeWidth={2} dot={ReleaseDot} activeDot={{ r: 5, fill: PURPLE, stroke: '#fff', strokeWidth: 2 }} type="linear" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function Capacity({ storage }) {
  const [label, color] = LEVELS[storage.level];
  const slices = [
    { name: 'Stored', value: storage.stored, fill: GREEN },
    { name: 'Expected', value: storage.pending, fill: PURPLE },
    { name: 'Available', value: storage.available, fill: TRACK },
  ];
  return (
    <Card title="Storage Capacity">
      <div className="relative mx-auto h-44 w-44" role="img" aria-label={`${storage.percentUsed}% of capacity used`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" innerRadius="72%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="#fff" strokeWidth={2} isAnimationActive={false}>
              {slices.map((s) => <Cell key={s.name} fill={s.fill} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold">{storage.percentUsed}%</span>
          <span className="text-xs text-muted">used</span>
        </div>
      </div>
      <div className="mt-3 flex justify-center"><Badge color={color}>{label}</Badge></div>
      <dl className="mt-4 space-y-1.5 text-sm">
        {slices.map((s) => (
          <div key={s.name} className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-2 text-muted"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.fill }} /> {s.name}</dt>
            <dd className="font-medium">{number(s.value)} sacks</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t border-line pt-1.5"><dt className="text-muted">Total capacity</dt><dd className="font-medium">{number(storage.capacity)}</dd></div>
      </dl>
    </Card>
  );
}

function Attention({ attention }) {
  const items = [
    attention.overdueDeliveries > 0 && {
      icon: CalendarClock, tone: 'red', to: '/inventory',
      title: `${number(attention.overdueDeliveries)} overdue ${attention.overdueDeliveries === 1 ? 'delivery' : 'deliveries'}`,
      detail: `${number(attention.overdueSacks)} sacks past their contract end`,
    },
    attention.latePlans > 0 && {
      icon: CircleDollarSign, tone: 'red', to: '/transactions',
      title: `${number(attention.latePlans)} late on installments`,
      detail: `${formatPHP(attention.lateInstallmentsCentavos)} overdue on payment plans`,
    },
    attention.receiving > 0 && {
      icon: PackagePlus, tone: 'amber', to: '/inventory',
      title: `${number(attention.receiving)} ${attention.receiving === 1 ? 'delivery' : 'deliveries'} still being received`,
      detail: 'Finish receiving once every sack is scanned in',
    },
    attention.damagedOrLostTags > 0 && {
      icon: QrCode, tone: 'orange', to: '/qr-tags',
      title: `${number(attention.damagedOrLostTags)} damaged or lost ${attention.damagedOrLostTags === 1 ? 'tag' : 'tags'}`,
      detail: 'Retire them, or put found tags back in service',
    },
  ].filter(Boolean);
  const tones = { red: 'bg-critical/10 text-critical', amber: 'bg-warning/15 text-amber-700', orange: 'bg-brand-orange/15 text-brand-orange' };

  return (
    <Card title="Needs Attention">
      {items.length === 0 ? (
        <div className="flex items-center gap-3 py-2 text-sm">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-green-tint text-brand-green"><CircleCheck size={18} /></span>
          All clear. Nothing needs attention right now.
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.title}>
              <Link to={item.to} className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-page">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tones[item.tone]}`}><item.icon size={16} /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{item.title}</span>
                  <span className="block text-xs text-muted">{item.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const ACTIVITY = {
  gate_in: [PackagePlus, 'bg-brand-green-tint text-brand-green'],
  gate_out: [LogOut, 'bg-brand-purple/10 text-brand-purple'],
  move: [ArrowLeftRight, 'bg-brand-orange/15 text-brand-orange'],
  tag_replaced: [QrCode, 'bg-brand-orange/15 text-brand-orange'],
  payment: [Wallet, 'bg-brand-green-tint text-brand-green'],
  adjustment: [Receipt, 'bg-brand-purple/10 text-brand-purple'],
  refund: [Undo2, 'bg-brand-orange/15 text-brand-orange'],
  void: [Ban, 'bg-gray-100 text-muted'],
};

function RecentActivity({ activity }) {
  return (
    <Card title="Recent Activity" className="lg:col-span-2">
      {activity.length === 0 ? (
        <EmptyState icon={Package} title="No activity yet" detail="Scans, moves, and payments will be listed here." />
      ) : (
        <ul className="divide-y divide-line">
          {activity.map((a) => {
            const [Icon, tint] = ACTIVITY[a.kind] ?? [TriangleAlert, 'bg-critical/10 text-critical'];
            const to = a.transactionId ? `/transactions/${a.transactionId}` : a.batchId ? `/inventory/${a.batchId}` : a.tagId ? `/qr-tags/${a.tagId}` : null;
            const body = (
              <>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tint}`}><Icon size={16} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {a.title}{a.amountCentavos ? <span className="font-normal text-muted"> · {formatPHP(a.amountCentavos)}</span> : null}
                  </span>
                  <span className="block truncate text-xs text-muted">{a.detail}</span>
                </span>
                <time className="shrink-0 text-xs text-muted" dateTime={a.at}>{timeAgo(a.at)}</time>
              </>
            );
            return (
              <li key={`${a.kind}-${a.at}-${a.title}`}>
                {to ? <Link to={to} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-page">{body}</Link>
                  : <div className="flex items-center gap-3 py-2.5">{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default function CoopDashboard() {
  const [days, setDays] = useState(14);
  const { data, error, loading } = useLoad(`/dashboard?days=${days}`);
  const [last, setLast] = useState(null);
  if (data && data !== last) setLast(data);
  const d = data ?? last; // keep showing the old numbers while a new range loads

  if (error) return <Notice>{error}</Notice>;
  if (!d) return <p className="text-sm text-muted">{loading ? 'Loading…' : ''}</p>;
  const { storage, tags, money } = d;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Sacks in Storage" value={number(storage.stored)} icon={Package} color="green" trend={`${storage.percentUsed}% of capacity used`} />
        <StatCard label="Available Space" value={number(storage.available)} icon={Warehouse} color="purple" trend={storage.pending ? `${number(storage.pending)} more sacks expected` : 'sacks'} />
        <StatCard
          label="Unpaid Balances" value={formatPHP(money.outstandingCentavos)} icon={CircleDollarSign} color={money.outstandingCentavos ? 'orange' : 'gray'}
          trend={`${formatPHP(money.collectedThisMonthCentavos)} collected this month`}
        />
        <StatCard label="Tags Available" value={number(tags.available)} icon={QrCode} color="green" trend={`${number(tags.assigned)} on sacks`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <EntriesAndReleases chart={d.chart} days={days} setDays={setDays} />
        <Capacity storage={storage} />
        <RecentActivity activity={d.activity} />
        <Attention attention={d.attention} />
      </div>
    </>
  );
}

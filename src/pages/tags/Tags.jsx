import { useSearchParams } from 'react-router-dom';
import { CircleCheck, Link2, QrCode, TriangleAlert } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { number } from '../../lib/format.js';
import { useAuth } from '../../lib/auth.jsx';
import { useLoad } from '../../lib/useLoad.js';
import TagList from './TagList.jsx';
import TagLots from './TagLots.jsx';
import TagCounts from './TagCounts.jsx';

export default function Tags() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const totalsLoad = useLoad('/tags?page=1');
  const totals = totalsLoad.data?.totals;
  const show = (n) => (totals ? number(n) : '—');

  const tabs = [
    ['tags', 'Tags', TagList],
    ['lots', 'Tag Lots', TagLots],
    ...(user.features.includes('tag_reconciliation') ? [['count', 'Tag Count', TagCounts]] : []),
  ];
  const tab = tabs.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'tags';
  const Active = tabs.find(([key]) => key === tab)[2];

  return (
    <>
      <PageHeader title="QR Tags" subtitle="Reusable tags that track each sack" />
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="All Tags" value={show(totals?.all)} icon={QrCode} color="green" />
        <StatCard label="Available" value={show(totals?.available)} icon={CircleCheck} color="green" />
        <StatCard label="Assigned to Sacks" value={show(totals?.assigned)} icon={Link2} color="purple" />
        <StatCard label="Damaged or Lost" value={show(totals ? totals.damaged + totals.lost : 0)} icon={TriangleAlert} color="orange" />
      </div>

      <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm" role="tablist">
        {tabs.map(([key, label]) => (
          <button
            key={key} type="button" role="tab" aria-selected={tab === key}
            onClick={() => setParams(key === 'tags' ? {} : { tab: key })}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm ${
              tab === key ? 'bg-brand-green-tint font-medium text-brand-green' : 'text-muted hover:bg-page'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <Active onChanged={totalsLoad.reload} />
    </>
  );
}

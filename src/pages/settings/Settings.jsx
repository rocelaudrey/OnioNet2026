import { useState } from 'react';
import { PageHeader } from '../../components/PageHeader.jsx';
import ProfileTab from './ProfileTab.jsx';
import LayoutTab from './LayoutTab.jsx';
import FeesTab from './FeesTab.jsx';
import UsersTab from './UsersTab.jsx';

const TABS = [
  ['profile', 'Profile', ProfileTab],
  ['layout', 'Storage Layout', LayoutTab],
  ['fees', 'Fees', FeesTab],
  ['users', 'Users', UsersTab],
];

export default function Settings() {
  const [tab, setTab] = useState('profile');
  const Active = TABS.find(([key]) => key === tab)[2];
  return (
    <>
      <PageHeader title="Settings" subtitle="Cooperative setup" />
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm ${
              tab === key ? 'bg-brand-green-tint font-medium text-brand-green' : 'text-muted hover:bg-page'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <Active />
    </>
  );
}

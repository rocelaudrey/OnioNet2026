import { Package } from 'lucide-react';
import { Card, EmptyState } from '../../components/Card.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Notice } from '../../components/ui.jsx';
import { useLoad } from '../../lib/useLoad.js';
import { DeliveryCard } from './MemberHome.jsx';

export default function MyBatches() {
  const { data, error } = useLoad('/me/batches');
  return (
    <>
      <PageHeader title="My Batches" subtitle="Your deliveries and where they are stored" />
      <Notice>{error}</Notice>
      {!data && !error && <p className="text-sm text-muted">Loading…</p>}
      {data && (
        <Card>
          {data.deliveries.length === 0
            ? <EmptyState icon={Package} title="No deliveries yet" detail="Your deliveries will show here once the cooperative receives your onions." />
            : <div className="space-y-3">{data.deliveries.map((d) => <DeliveryCard key={d.id} d={d} />)}</div>}
        </Card>
      )}
    </>
  );
}

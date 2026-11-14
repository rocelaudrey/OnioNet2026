import { Card, EmptyState } from '../components/Card.jsx';
import { PageHeader } from '../components/PageHeader.jsx';

export default function ComingSoon({ title, subtitle, icon }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Card>
        <EmptyState icon={icon} title="Not built yet" detail={`The ${title} page is coming in a later phase.`} />
      </Card>
    </>
  );
}

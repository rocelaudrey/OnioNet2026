import { Badge } from '../../components/ui.jsx';

export const BATCH_STATUS = {
  receiving: ['Receiving', 'amber'],
  stored: ['Stored', 'green'],
  partly_released: ['Partly Released', 'purple'],
  released: ['Released', 'gray'],
  cancelled: ['Cancelled', 'gray'],
};

export function BatchStatusBadge({ batch }) {
  const [label, color] = BATCH_STATUS[batch.status] ?? [batch.status, 'gray'];
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge color={color}>{label}</Badge>
      {batch.overdue && <Badge color="red">Overdue</Badge>}
    </span>
  );
}

export const SACK_STATUS = {
  stored: ['Stored', 'green'],
  released: ['Released', 'gray'],
  damaged: ['Damaged', 'red'],
  lost: ['Lost', 'orange'],
};

export const CHARGED_PER = {
  sack: 'per sack',
  batch: 'per delivery',
  sack_per_month: 'per sack, every month in storage',
};

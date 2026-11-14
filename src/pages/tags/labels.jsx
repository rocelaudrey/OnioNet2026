import { Badge } from '../../components/ui.jsx';

// Style guide: Available green, Assigned purple, Damaged red, Lost orange, Retired gray.
export const TAG_STATUS = {
  available: ['Available', 'green'],
  assigned: ['Assigned', 'purple'],
  damaged: ['Damaged', 'red'],
  lost: ['Lost', 'orange'],
  retired: ['Retired', 'gray'],
};

export function TagStatusBadge({ status }) {
  const [label, color] = TAG_STATUS[status] ?? [status, 'gray'];
  return <Badge color={color}>{label}</Badge>;
}

export const STATUS_OPTIONS = Object.entries(TAG_STATUS).map(([value, [label]]) => [value, label]);

export const EVENT_LABELS = {
  gate_in: 'Attached to a sack (gate-in)',
  move: 'Sack moved',
  gate_out: 'Removed from a sack (gate-out)',
  tag_replaced: 'Tag replaced',
  tag_damaged: 'Marked damaged',
  tag_lost: 'Marked lost',
  tag_retired: 'Retired',
  tag_restored: 'Back in service',
  sack_damaged: 'Sack marked damaged',
  sack_lost: 'Sack marked lost',
};

// Shown next to a history entry when the tag itself was not scanned.
export const METHOD_LABELS = {
  range_scan: 'by range (first and last tag scanned)',
  range_typed: 'by range (typed, not scanned)',
};

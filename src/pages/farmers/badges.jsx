import { Badge } from '../../components/ui.jsx';
import { TIER_LABELS } from '../../../shared/statuses.js';

const TIER_COLORS = { member: 'purple', guest: 'orange', trader: 'gray' };

export const TierBadge = ({ tier }) => <Badge color={TIER_COLORS[tier] ?? 'purple'}>{TIER_LABELS[tier] ?? 'Member'}</Badge>;
export const StatusBadge = ({ status }) => (status === 'active' ? <Badge color="green">Active</Badge> : <Badge>Inactive</Badge>);

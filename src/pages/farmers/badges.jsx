import { Badge } from '../../components/ui.jsx';

export const TierBadge = ({ tier }) => (tier === 'guest' ? <Badge color="orange">Guest</Badge> : <Badge color="purple">Member</Badge>);
export const StatusBadge = ({ status }) => (status === 'active' ? <Badge color="green">Active</Badge> : <Badge>Inactive</Badge>);

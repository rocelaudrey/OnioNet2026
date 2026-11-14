// Status and option names used by both the API and the UI.
export const MEMBER_TIERS = ['member', 'guest'];
export const MEMBER_STATUSES = ['active', 'inactive'];
export const OWNER_TYPES = ['member', 'guest', 'coop_owned'];
export const BATCH_STATUSES = ['receiving', 'stored', 'partly_released', 'released'];
export const SACK_STATUSES = ['stored', 'released', 'damaged', 'lost'];
export const TAG_STATUSES = ['available', 'assigned', 'damaged', 'lost', 'retired'];
export const TAG_SOURCES = ['generated', 'imported'];
export const CUSTODY_EVENT_TYPES = [
  'gate_in', 'move', 'gate_out', 'tag_replaced', 'tag_damaged', 'tag_lost',
  'tag_retired', 'tag_restored', 'sack_damaged', 'sack_lost',
];
export const TRANSACTION_TYPES = ['payment', 'adjustment', 'refund'];
export const PAYMENT_METHODS = ['cash', 'gcash', 'bank'];
export const ADDED_FEE_CHARGED_PER = ['sack', 'batch', 'sack_per_month'];
export const ADDED_FEE_APPLIES_TO = ['every_batch', 'optional'];
export const SUBSCRIPTION_STATUSES = ['trial', 'active', 'past_due', 'canceled'];
export const FEATURES = ['farmer_portal', 'tag_reconciliation', 'tag_import', 'pdf_reports'];
export const AUDIT_ACTIONS = [
  'create', 'update', 'delete', 'void', 'login', 'login_failed', 'export', 'password_reset',
];

const TILE_COLORS = {
  green: 'bg-brand-green',
  purple: 'bg-brand-purple',
  orange: 'bg-brand-orange',
  red: 'bg-critical',
};

// Dashboard stat card: colored icon tile at top left, label, big number.
export function StatCard({ label, value, icon: Icon, color = 'green', trend }) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <span className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg text-white ${TILE_COLORS[color]}`}>
        <Icon size={20} />
      </span>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {trend && <p className="mt-1 text-xs text-muted">{trend}</p>}
    </div>
  );
}

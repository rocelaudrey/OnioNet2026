export function Card({ title, children, className = '' }) {
  return (
    <section className={`rounded-xl bg-white p-5 shadow-sm ${className}`}>
      {title && <h2 className="mb-4 text-base">{title}</h2>}
      {children}
    </section>
  );
}

export function EmptyState({ icon: Icon, title, detail }) {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      {Icon && (
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-green-tint text-brand-green">
          <Icon size={22} />
        </span>
      )}
      <p className="font-medium">{title}</p>
      {detail && <p className="mt-1 max-w-sm text-sm text-muted">{detail}</p>}
    </div>
  );
}

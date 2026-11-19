import { useEffect } from 'react';
import { X } from 'lucide-react';

const BUTTON_STYLES = {
  primary: 'bg-brand-green text-white hover:bg-brand-green-dark',
  secondary: 'border border-line bg-white text-ink hover:bg-page',
  danger: 'border border-critical/30 bg-white text-critical hover:bg-critical/5',
};

export function Button({ variant = 'primary', className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-60 ${BUTTON_STYLES[variant]} ${className}`}
      {...props}
    />
  );
}

export const inputClass =
  'mt-1 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20 disabled:bg-page disabled:text-muted';

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block text-xs text-muted ${className}`}>
      {label}
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function TextField({ label, hint, className, ...props }) {
  return (
    <Field label={label} hint={hint} className={className}>
      <input className={inputClass} {...props} />
    </Field>
  );
}

export function SelectField({ label, hint, options, className, ...props }) {
  return (
    <Field label={label} hint={hint} className={className}>
      <select className={inputClass} {...props}>
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </Field>
  );
}

// Peso amount typed as text, e.g. "150.00". Converted to centavos on save.
export function MoneyField({ label, hint, className, ...props }) {
  return (
    <Field label={label} hint={hint} className={className}>
      <span className="relative block">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 pt-1 text-sm text-muted">₱</span>
        <input inputMode="decimal" className={`${inputClass} pl-7`} {...props} />
      </span>
    </Field>
  );
}

const BADGE_STYLES = {
  green: 'bg-brand-green-tint text-brand-green',
  purple: 'bg-brand-purple/10 text-brand-purple',
  amber: 'bg-warning/15 text-amber-700',
  red: 'bg-critical/10 text-critical',
  orange: 'bg-brand-orange/15 text-orange-700',
  gray: 'bg-gray-100 text-muted',
};

export function Badge({ color = 'gray', children }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_STYLES[color]}`}>
      {children}
    </span>
  );
}

export function Notice({ kind = 'error', children }) {
  if (!children) return null;
  const style = {
    error: 'bg-critical/10 text-critical',
    warning: 'bg-warning/15 text-amber-800',
    success: 'bg-brand-green-tint text-brand-green-dark',
  }[kind];
  return <p role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${style}`}>{children}</p>;
}

// Thin rounded bar with "used / capacity" and "available".
// neutral: a plain purple bar with no warning colors, for totals where being
// full is not a problem (e.g. layout size against the plan limit).
export function CapacityBar({ used, capacity, unit = 'sacks', neutral = false, remainingLabel = 'available' }) {
  const percent = capacity > 0 ? Math.min(100, (used / capacity) * 100) : 0;
  const level = percent > 90 ? 'bg-critical' : percent >= 70 ? 'bg-warning' : 'bg-brand-green';
  const n = (v) => v.toLocaleString('en-US');
  return (
    <div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full ${neutral ? 'bg-brand-purple' : level}`} style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-1 flex justify-between gap-3 text-xs text-muted">
        <span>{n(used)} / {n(capacity)} {unit}</span>
        <span>{n(Math.max(0, capacity - used))} {remainingLabel}</span>
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-page">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Table({ columns, children, minWidth = 560 }) {
  return (
    <div className="-mx-5 overflow-x-auto print:mx-0 print:overflow-visible">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            {columns.map((c) => <th key={c} className="px-5 py-2 font-normal">{c}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ className = '', ...props }) => <td className={`px-5 py-3 align-middle ${className}`} {...props} />;

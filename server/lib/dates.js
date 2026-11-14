export const DAY_MS = 86_400_000;

// Same day N months later; the 31st falls back to the month's last day.
export function addMonths(date, months) {
  const out = new Date(date);
  const day = out.getDate();
  out.setDate(1);
  out.setMonth(out.getMonth() + months);
  out.setDate(Math.min(day, new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate()));
  return out;
}

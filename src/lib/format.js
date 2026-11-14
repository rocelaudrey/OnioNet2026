import { toCentavos } from '../../shared/money.js';

export { formatPHP } from '../../shared/money.js';

export const pesosInput = (centavos) => (centavos / 100).toFixed(2);

// Reads a typed peso amount. Throws a message the user can act on.
export function readPesos(text, label) {
  try {
    const value = toCentavos(String(text).trim() || '0');
    if (value < 0) throw new Error('negative');
    return value;
  } catch {
    throw new Error(`${label}: enter an amount like 150 or 150.50.`);
  }
}

export const number = (value) => Number(value).toLocaleString('en-US');

export function dateTime(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function date(value) {
  if (!value) return 'Not set';
  return new Date(value).toLocaleDateString('en-US', { dateStyle: 'medium' });
}

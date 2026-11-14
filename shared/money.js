// Money is stored as integer centavos and displayed as PHP with 2 decimals.
export function formatPHP(centavos) {
  if (!Number.isInteger(centavos)) throw new TypeError('Amount must be integer centavos');
  const abs = Math.abs(centavos);
  const pesos = Math.trunc(abs / 100).toLocaleString('en-US');
  const cents = String(abs % 100).padStart(2, '0');
  return `${centavos < 0 ? '-' : ''}₱${pesos}.${cents}`;
}

// Parses user input such as "1,250.50" into integer centavos without float math.
export function toCentavos(input) {
  const text = String(input).replace(/[₱,\s]/g, '');
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new TypeError(`Invalid peso amount: ${input}`);
  const [, sign, pesos, cents = ''] = match;
  const value = Number(pesos) * 100 + Number(cents.padEnd(2, '0'));
  return sign && value !== 0 ? -value : value;
}

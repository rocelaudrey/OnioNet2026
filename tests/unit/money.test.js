import { describe, it, expect } from 'vitest';
import { formatPHP, toCentavos } from '../../shared/money.js';

describe('formatPHP', () => {
  it('shows PHP with 2 decimals', () => {
    expect(formatPHP(0)).toBe('₱0.00');
    expect(formatPHP(5)).toBe('₱0.05');
    expect(formatPHP(123450)).toBe('₱1,234.50');
    expect(formatPHP(-250)).toBe('-₱2.50');
  });
  it('rejects non-integer amounts', () => {
    expect(() => formatPHP(10.5)).toThrow(TypeError);
  });
});

describe('toCentavos', () => {
  it('parses peso input without float errors', () => {
    expect(toCentavos('1,250.50')).toBe(125050);
    expect(toCentavos('0.1')).toBe(10);
    expect(toCentavos('19.99')).toBe(1999);
    expect(toCentavos(35)).toBe(3500);
    expect(toCentavos('-2.5')).toBe(-250);
  });
  it('rejects bad input', () => {
    expect(() => toCentavos('abc')).toThrow(TypeError);
    expect(() => toCentavos('1.234')).toThrow(TypeError);
  });
});

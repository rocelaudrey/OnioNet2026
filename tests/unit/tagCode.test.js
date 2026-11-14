import { describe, it, expect } from 'vitest';
import { makeTagCode, parseTagCode, isValidTagCode } from '../../server/lib/tagCode.js';

describe('tag code', () => {
  it('has the form PREFIX-000000-X', () => {
    expect(makeTagCode('FAF', 123)).toMatch(/^FAF-000123-[A-HJ-NPR-Z]$/);
  });
  it('round-trips', () => {
    expect(parseTagCode(makeTagCode('FAF', 123))).toEqual({ prefix: 'FAF', serial: 123 });
    expect(parseTagCode(makeTagCode('FAF', 123).toLowerCase())).toEqual({ prefix: 'FAF', serial: 123 });
  });
  it('rejects a wrong check character, a mistyped digit, and swapped digits', () => {
    const code = makeTagCode('FAF', 123);
    const wrongCheck = code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A');
    expect(isValidTagCode(wrongCheck)).toBe(false);
    expect(isValidTagCode(code.replace('000123', '000124'))).toBe(false);
    expect(isValidTagCode(code.replace('000123', '000132'))).toBe(false);
    expect(isValidTagCode('FAF-000123')).toBe(false);
    expect(isValidTagCode('')).toBe(false);
  });
  it('rejects serials outside 1 to 999999', () => {
    expect(() => makeTagCode('FAF', 0)).toThrow();
    expect(() => makeTagCode('FAF', 1000000)).toThrow();
  });
});

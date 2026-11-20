import { describe, it, expect } from 'vitest';
import { toCsv } from '../../src/lib/csv.js';

describe('CSV', () => {
  it('quotes commas and quotes, and keeps numbers as they are', () => {
    expect(toCsv([['Dela Cruz, Juan', 'He said "hi"', '-1234.50', '42']])).toBe('"Dela Cruz, Juan","He said ""hi""",-1234.50,42');
  });
  it('stops text from running as a spreadsheet formula', () => {
    expect(toCsv([['=SUM(A1)', '+1', '@x', '-x']])).toBe("'=SUM(A1),'+1,'@x,'-x");
  });
});

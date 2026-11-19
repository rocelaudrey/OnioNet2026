import { describe, it, expect } from 'vitest';
import { TIME_ZONE } from '../../server/timezone.js';

describe('server time zone', () => {
  it('works in Philippine time, whatever the machine is set to', () => {
    expect(TIME_ZONE).toBe('Asia/Manila');
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Manila');
    // 4:30 PM UTC on Nov 18 is 12:30 AM on Nov 19 in Manila.
    const d = new Date(Date.UTC(2026, 10, 18, 16, 30));
    expect([d.getDate(), d.getHours()]).toEqual([19, 0]);
    // Start of "today" is Manila midnight, which is 4:00 PM UTC the day before.
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    expect(start.toISOString()).toBe('2026-11-18T16:00:00.000Z');
  });
});

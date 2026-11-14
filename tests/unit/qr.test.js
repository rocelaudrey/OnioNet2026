import { describe, it, expect } from 'vitest';
import { encodeTagQr, decodeTagQr } from '../../server/lib/qr.js';

const secret = 'test-secret';

describe('tag QR payload', () => {
  it('round-trips a tag ID', () => {
    const payload = encodeTagQr('FAF-000123', secret);
    expect(decodeTagQr(payload, secret)).toBe('FAF-000123');
  });
  it('contains only the tag ID and a short signature', () => {
    expect(encodeTagQr('FAF-000123', secret)).toMatch(/^FAF-000123\.[A-Za-z0-9_-]{10}$/);
  });
  it('rejects a tampered tag ID, wrong secret, or malformed payload', () => {
    const payload = encodeTagQr('FAF-000123', secret);
    expect(decodeTagQr(payload.replace('123', '124'), secret)).toBeNull();
    expect(decodeTagQr(payload, 'other-secret')).toBeNull();
    expect(decodeTagQr('FAF-000123', secret)).toBeNull();
    expect(decodeTagQr('', secret)).toBeNull();
    expect(decodeTagQr(null, secret)).toBeNull();
  });
});

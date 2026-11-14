import { createHmac, timingSafeEqual } from 'node:crypto';

// The QR code holds ONLY the tag ID plus a short HMAC signature.
// No farmer or batch data is ever placed in the QR.
const SIG_LENGTH = 10;

function sign(tagId, secret) {
  return createHmac('sha256', secret).update(tagId).digest('base64url').slice(0, SIG_LENGTH);
}

export function encodeTagQr(tagId, secret) {
  if (!tagId || tagId.includes('.')) throw new Error('Invalid tag ID');
  return `${tagId}.${sign(tagId, secret)}`;
}

// Returns the tag ID if the signature is valid, otherwise null.
export function decodeTagQr(payload, secret) {
  if (typeof payload !== 'string') return null;
  const parts = payload.trim().split('.');
  if (parts.length !== 2 || !parts[0] || parts[1].length !== SIG_LENGTH) return null;
  const [tagId, sig] = parts;
  const expected = Buffer.from(sign(tagId, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return tagId;
}

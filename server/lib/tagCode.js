// Tag code format: {PREFIX}-{6-digit serial}-{check char}, e.g. FAF-000123-K.
// The check character catches typing mistakes when a code is entered by hand.
// It is not a security feature; the HMAC signature in the QR is.
const CHECK_ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ'; // 23 letters; no I, O, Q
const CODE_PATTERN = /^([A-Z0-9]{2,6})-(\d{6})-([A-Z])$/;

export function checkChar(prefix, serial) {
  const text = `${prefix}${serial}`;
  let sum = 0;
  for (let i = 0; i < text.length; i += 1) sum += text.charCodeAt(i) * (i + 1);
  return CHECK_ALPHABET[sum % CHECK_ALPHABET.length];
}

export function makeTagCode(prefix, serialNumber) {
  if (!/^[A-Z0-9]{2,6}$/.test(prefix)) throw new Error('Invalid tag prefix');
  if (!Number.isInteger(serialNumber) || serialNumber < 1 || serialNumber > 999999) {
    throw new Error('Tag serial must be between 1 and 999999');
  }
  const serial = String(serialNumber).padStart(6, '0');
  return `${prefix}-${serial}-${checkChar(prefix, serial)}`;
}

// Returns { prefix, serial } for a well-formed code, otherwise null.
export function parseTagCode(code) {
  const match = CODE_PATTERN.exec(String(code ?? '').trim().toUpperCase());
  if (!match) return null;
  const [, prefix, serial, check] = match;
  if (checkChar(prefix, serial) !== check) return null;
  return { prefix, serial: Number(serial) };
}

export function isValidTagCode(code) {
  return parseTagCode(code) !== null;
}

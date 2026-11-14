import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';

export const MIN_PASSWORD_LENGTH = 8;
const ROUNDS = 12;
// No look-alike characters (0/O, 1/l/I), so it can be read out or written down.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const hashPassword = (password) => bcrypt.hash(password, ROUNDS);
export const checkPassword = (password, hash) => bcrypt.compare(password, hash);

export function temporaryPassword(length = 10) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

'use strict';
// Password hashing with Node's built-in scrypt (memory-hard, no native add-on needed).
// Format: scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>
const crypto = require('crypto');

const N = 1 << 15; const R = 8; const P = 1; const KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;

function hashPassword(pw) {
  if (typeof pw !== 'string' || pw.length === 0) throw new Error('empty password');
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw.normalize('NFC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function isHashed(v) {
  return typeof v === 'string' && v.startsWith('scrypt$') && v.split('$').length === 6;
}

function verifyPassword(pw, stored) {
  if (typeof pw !== 'string' || !isHashed(stored)) return false;
  const [, n, r, p, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(pw.normalize('NFC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Used to keep login timing similar when the user does not exist.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function passwordProblem(pw) {
  if (typeof pw !== 'string') return 'Password missing';
  if (pw.length < 10) return 'Password must be at least 10 characters';
  if (pw.length > 256) return 'Password is too long';
  return null;
}

module.exports = { hashPassword, verifyPassword, isHashed, DUMMY_HASH, passwordProblem };

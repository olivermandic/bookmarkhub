'use strict';
// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) + RFC 4648 base32, Node crypto only.
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const s = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0; let value = 0; const out = [];
  for (const c of s) {
    value = (value << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
const newSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(secret, counter, digits = 6) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}
const totp = (secret, time = Date.now(), step = 30) => hotp(secret, Math.floor(time / 1000 / step));

/** Verify with ±1 step tolerance. Returns the matched counter (for replay protection) or -1. */
function verify(secret, code, { time = Date.now(), window = 1, lastCounter = -1 } = {}) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return -1;
  const now = Math.floor(time / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    const ctr = now + w;
    if (ctr <= lastCounter) continue;
    const exp = hotp(secret, ctr);
    if (crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(c))) return ctr;
  }
  return -1;
}

function otpauthUrl({ secret, account, issuer = 'BookmarkHub' }) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// Recovery codes: 10 × "xxxx-xxxx", stored as SHA-256 (they are high-entropy random values).
function newRecoveryCodes(n = 10) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: n }, () => {
    const b = crypto.randomBytes(8);
    const s = Array.from(b, (x) => alphabet[x % alphabet.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}
const hashCode = (c) => crypto.createHash('sha256').update(String(c).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');

module.exports = { base32Encode, base32Decode, newSecret, hotp, totp, verify, otpauthUrl, newRecoveryCodes, hashCode };

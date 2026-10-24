'use strict';
// Server-side favicon fetch + disk cache (data/favicons). Only http(s), max 256 KB,
// 5 s timeout, image content types only. Failures are cached for 1 day.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX = 256 * 1024;
const OK_TYPES = /^image\/(png|x-icon|vnd\.microsoft\.icon|gif|jpeg|webp)/i;
const inflight = new Map();

function candidates(b) {
  const list = [];
  if (typeof b.favicon === 'string' && /^https?:\/\//i.test(b.favicon)) list.push(b.favicon);
  try { list.push(`${new URL(b.url).origin}/favicon.ico`); } catch { /* ignore */ }
  return [...new Set(list)];
}

async function download(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'BookmarkHub favicon fetcher' } });
    if (!r.ok) return null;
    let type = (r.headers.get('content-type') || '').split(';')[0].trim();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX) return null;
    if (!OK_TYPES.test(type)) {
      // Many servers send .ico as octet-stream; accept ICO/PNG by magic bytes.
      if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1) type = 'image/x-icon';
      else if (buf.slice(0, 4).toString('hex') === '89504e47') type = 'image/png';
      else return null;
    }
    // SVG is deliberately not accepted (could contain scripts).
    return { type, data: buf };
  } catch { return null; } finally { clearTimeout(t); }
}

async function get(bookmark, dataDir) {
  const dir = path.join(dataDir, 'favicons');
  const urls = candidates(bookmark);
  if (!urls.length) return null;
  const key = crypto.createHash('sha256').update(urls.join('|')).digest('hex').slice(0, 32);
  const file = path.join(dir, key);
  try {
    const meta = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8'));
    const fresh = Date.now() - meta.at < (meta.type ? 30 : 1) * 864e5;
    if (fresh) return meta.type ? { type: meta.type, data: fs.readFileSync(file) } : null;
  } catch { /* not cached */ }
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    let icon = null;
    for (const u of urls) { icon = await download(u); if (icon) break; }
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (icon) fs.writeFileSync(file, icon.data);
      fs.writeFileSync(`${file}.json`, JSON.stringify({ at: Date.now(), type: icon ? icon.type : null }));
    } catch { /* cache is optional */ }
    return icon;
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

module.exports = { get };

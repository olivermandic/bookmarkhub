'use strict';
// Robust server-side favicon discovery + disk cache (data/favicons/<bookmarkId>.bin/.json).
// No third-party icon services (GDPR): we only talk to the bookmarked site itself.
//
// Order of attempts:
//   1. custom icon (upload) or custom icon URL set by the user
//   2. <link rel=icon|shortcut icon|apple-touch-icon|mask-icon> + web manifest icons of the page
//      (after following redirects; best size wins, >= 64 px preferred)
//   3. /favicon.ico and /apple-touch-icon.png on the final and the original origin
//   4. the same for the parent domain (sub.example.com -> example.com)
// Every download is sniffed by magic bytes; HTML (login pages, Cloudflare challenges) is rejected.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { request, sleep, UA_BROWSER, UA_PLAIN } = require('./lib/http');

const MAX_ICON = 512 * 1024;
const MAX_HTML = 768 * 1024;
const TTL_FOUND = 30 * 864e5;
const TTL_NONE = 3 * 864e5;

// ---------- type sniffing ----------
function sniff(buf) {
  if (!buf || buf.length < 4) return null;
  const hex = buf.subarray(0, 12).toString('hex');
  if (hex.startsWith('89504e47')) return 'image/png';
  if (hex.startsWith('00000100') || hex.startsWith('00000200')) return 'image/x-icon';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (hex.startsWith('424d')) return 'image/bmp';
  const head = buf.subarray(0, 1024).toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if ((head.startsWith('<?xml') || head.startsWith('<svg') || head.startsWith('<!--')) && head.includes('<svg')) return 'image/svg+xml';
  return null;
}

// ---------- SVG sanitising (keep only static vector content) ----------
function sanitizeSvg(text) {
  let s = String(text);
  s = s.replace(/<!DOCTYPE[^>[]*(\[[^\]]*\])?>/gi, '');
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/<script[^>]*\/>/gi, '');
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '');
  s = s.replace(/<(iframe|embed|object|audio|video|use)\b[\s\S]*?(<\/\1\s*>|\/>)/gi, (m) => (/(href)\s*=\s*["']#/i.test(m) ? m : ''));
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/\s(xlink:)?href\s*=\s*("|')\s*(?!#|data:image\/(png|jpeg|gif|webp))[^"']*\2/gi, '');
  s = s.replace(/url\(\s*['"]?\s*(?!#)[^)]*\)/gi, 'none');
  if (!/<svg[\s>]/i.test(s)) return null;
  return s;
}

// ---------- ICO: extract the biggest embedded PNG if there is one ----------
function icoBest(buf) {
  try {
    const count = buf.readUInt16LE(4);
    let best = null;
    for (let i = 0; i < count && 6 + i * 16 + 16 <= buf.length; i++) {
      const o = 6 + i * 16;
      const w = buf[o] || 256; const h = buf[o + 1] || 256;
      const size = buf.readUInt32LE(o + 8); const off = buf.readUInt32LE(o + 12);
      if (off + size > buf.length) continue;
      if (!best || w * h > best.w * best.h) best = { w, h, size, off };
    }
    if (!best) return { type: 'image/x-icon', data: buf, size: 0 };
    const part = buf.subarray(best.off, best.off + best.size);
    if (part.subarray(0, 4).toString('hex') === '89504e47') return { type: 'image/png', data: Buffer.from(part), size: best.w };
    return { type: 'image/x-icon', data: buf, size: best.w }; // browsers render ICO natively
  } catch { return { type: 'image/x-icon', data: buf, size: 0 }; }
}

function pngSize(buf) { try { return buf.readUInt32BE(16); } catch { return 0; } }

// ---------- HTML parsing ----------
function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m; const body = tag.replace(/^<\s*\w+/, '').replace(/\/?>$/, '');
  while ((m = re.exec(body))) out[m[1].toLowerCase()] = (m[3] ?? m[4] ?? m[5] ?? '').trim();
  return out;
}
function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}
function parseSizes(s) {
  if (!s) return 0;
  if (/any/i.test(s)) return 512;
  return Math.max(0, ...String(s).split(/\s+/).map((x) => parseInt(x.split(/x/i)[0], 10) || 0));
}

/** Extracts icon candidates + manifest URL from page HTML. */
function parseIcons(html, pageUrl) {
  const head = html.slice(0, MAX_HTML);
  let base = pageUrl;
  const baseTag = head.match(/<base\s[^>]*>/i);
  if (baseTag) { const h = attrs(baseTag[0]).href; if (h) { try { base = new URL(decodeEntities(h), pageUrl).toString(); } catch { /* ignore */ } } }
  const icons = []; let manifest = null;
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const rel = (a.rel || '').toLowerCase().split(/\s+/);
    if (!a.href) continue;
    let href;
    try { href = new URL(decodeEntities(a.href), base).toString(); } catch { continue; }
    if (rel.includes('manifest')) { manifest = href; continue; }
    let kind = null;
    if (rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) kind = 'apple';
    else if (rel.includes('mask-icon')) kind = 'mask';
    else if (rel.includes('icon')) kind = 'icon';
    if (!kind) continue;
    const type = (a.type || '').toLowerCase();
    let size = parseSizes(a.sizes);
    if (!size) size = kind === 'apple' ? 180 : (type.includes('svg') || /\.svg(\?|$)/i.test(href)) ? 512 : 32;
    icons.push({ url: href, size, kind, type });
  }
  return { icons, manifest };
}

function score(c) {
  let s = 0;
  if (c.size >= 64 && c.size <= 256) s = 1000 + c.size;
  else if (c.size > 256) s = 900 + Math.min(c.size, 1024) / 10;
  else s = 500 + c.size;
  if (c.kind === 'mask') s -= 800; // monochrome outline only
  if (c.kind === 'manifest' && c.purpose === 'maskable') s -= 50;
  return s;
}

function parentDomain(host) {
  const parts = host.split('.');
  if (parts.length <= 2 || /^\d+$/.test(parts[parts.length - 1])) return null;
  // naive public-suffix guard for co.uk-style domains
  if (parts.length === 3 && parts[1].length <= 3 && parts[2].length === 2) return null;
  return parts.slice(1).join('.');
}

// ---------- downloading ----------
async function downloadIcon(url, ctx = {}) {
  if (url.startsWith('data:')) {
    const m = url.match(/^data:([^;,]*)(;base64)?,(.*)$/s);
    if (!m) return null;
    const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
    return finishIcon(buf, url);
  }
  let host; try { host = new URL(url).host; } catch { return null; }
  if (ctx.deadHosts && ctx.deadHosts.has(host)) return null;
  if (ctx.deadline && Date.now() > ctx.deadline) return null;
  let r = await request(url, { max: MAX_ICON, accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5' });
  if (r.status === 0 && ctx.deadHosts && /timeout|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ECONNRESET|EHOSTUNREACH/.test(r.error || '')) ctx.deadHosts.add(host);
  if ([403, 429, 503].includes(r.status)) { await sleep(800); r = await request(url, { max: MAX_ICON, ua: UA_PLAIN, accept: 'image/*,*/*;q=0.5' }); }
  if (!r.ok || !r.body || r.truncated) return null;
  return finishIcon(r.body, r.url);
}
function finishIcon(buf, source) {
  const type = sniff(buf);
  if (!type || buf.length < 50) return null; // reject HTML, empty files, 1x1 GIFs etc.
  if (type === 'image/svg+xml') {
    const clean = sanitizeSvg(buf.toString('utf8'));
    return clean ? { type, data: Buffer.from(clean), size: 512, source } : null;
  }
  if (type === 'image/x-icon') { const r = icoBest(buf); return { ...r, source }; }
  if (type === 'image/png') return { type, data: buf, size: pngSize(buf), source };
  return { type, data: buf, size: 0, source };
}

async function fetchPage(url, ctx = {}) {
  let host; try { host = new URL(url).host; } catch { return { ok: false, status: 0 }; }
  if ((ctx.deadHosts && ctx.deadHosts.has(host)) || (ctx.deadline && Date.now() > ctx.deadline)) return { ok: false, status: 0, url };
  let r = await request(url, { max: MAX_HTML, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' });
  if (r.status === 0 && /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|EHOSTUNREACH/.test(r.error || '')) { if (ctx.deadHosts) ctx.deadHosts.add(host); return r; }
  if ([403, 429, 503].includes(r.status) || r.error === 'timeout') {
    await sleep(1200);
    r = await request(url, { max: MAX_HTML, ua: UA_PLAIN, accept: 'text/html,*/*;q=0.5' });
    if (r.status === 0 && ctx.deadHosts) ctx.deadHosts.add(host);
  }
  return r;
}

async function manifestIcons(manifestUrl) {
  const r = await request(manifestUrl, { max: 128 * 1024, accept: 'application/manifest+json,application/json,*/*' });
  if (!r.ok || !r.body) return [];
  try {
    const j = JSON.parse(r.body.toString('utf8'));
    return (Array.isArray(j.icons) ? j.icons : []).filter((i) => i && i.src).map((i) => ({
      url: new URL(i.src, r.url).toString(), size: parseSizes(i.sizes) || 192, kind: 'manifest', type: i.type || '', purpose: i.purpose || '',
    }));
  } catch { return []; }
}

/** Discover the best icon for a page URL. Returns {type,data,source,size} or null, plus tried list. */
async function discover(pageUrl, { log, budgetMs = 25000 } = {}) {
  const tried = [];
  const ctx = { deadHosts: new Set(), deadline: Date.now() + budgetMs };
  const seen = new Set();
  const tryList = async (list) => {
    for (const c of list) {
      if (seen.has(c.url)) continue;
      seen.add(c.url); tried.push(c.url);
      const icon = await downloadIcon(c.url, ctx);
      if (icon) return icon;
    }
    return null;
  };
  const fromPage = async (url) => {
    const page = await fetchPage(url, ctx);
    let cands = [];
    if (page.body && /html|xml|text\/plain|^$/i.test((page.headers && page.headers.get('content-type')) || '')) {
      const { icons, manifest } = parseIcons(page.body.toString('utf8'), page.url);
      cands = icons;
      if (manifest) cands = cands.concat(await manifestIcons(manifest));
    }
    cands.sort((a, b) => score(b) - score(a));
    const origins = [...new Set([page.url, url].map((u) => { try { return new URL(u).origin; } catch { return null; } }).filter(Boolean))];
    const fallbacks = [];
    for (const o of origins) fallbacks.push({ url: `${o}/favicon.ico` }, { url: `${o}/apple-touch-icon.png` }, { url: `${o}/favicon.png` });
    // good icons first, then fallbacks, then low-scoring (mask) ones
    const good = cands.filter((c) => score(c) > 300); const weak = cands.filter((c) => score(c) <= 300);
    return tryList([...good, ...fallbacks, ...weak]);
  };
  let icon = null;
  try {
    icon = await fromPage(pageUrl);
    if (!icon) {
      const u = new URL(pageUrl);
      const parent = parentDomain(u.hostname);
      if (parent) icon = await fromPage(`${u.protocol}//${parent}/`);
      if (!icon && u.protocol === 'http:') icon = await fromPage(`https://${u.host}/`);
    }
  } catch (e) { if (log) log('favicon error', e.message); }
  return { icon, tried };
}

// ---------- cache per bookmark ----------
const dirOf = (dataDir) => path.join(dataDir, 'favicons');
const safeId = (id) => String(id).replace(/[^\w.-]/g, '_').slice(0, 120);

function readCache(dataDir, id) {
  const base = path.join(dirOf(dataDir), safeId(id));
  try {
    const meta = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
    const data = meta.type ? fs.readFileSync(`${base}.bin`) : null;
    return { meta, data };
  } catch { return null; }
}
function writeCache(dataDir, id, meta, data) {
  const dir = dirOf(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, safeId(id));
  if (data) fs.writeFileSync(`${base}.bin`, data);
  else { try { fs.unlinkSync(`${base}.bin`); } catch { /* ignore */ } }
  fs.writeFileSync(`${base}.json`, JSON.stringify(meta));
}
function removeCache(dataDir, id) {
  const base = path.join(dirOf(dataDir), safeId(id));
  for (const ext of ['.bin', '.json']) { try { fs.unlinkSync(base + ext); } catch { /* ignore */ } }
}

const inflight = new Map();

/**
 * Refresh icon for a bookmark. Returns meta {status:'found'|'fallback'|'custom', type, source, fetchedAt, etag, pageUrl}.
 * force=true ignores cache (but keeps uploaded custom icons unless dropCustom).
 */
async function refresh(bookmark, dataDir, { force = false, log } = {}) {
  const id = bookmark.id;
  if (inflight.has(id)) return inflight.get(id);
  const p = (async () => {
    const cached = readCache(dataDir, id);
    if (cached && cached.meta.status === 'custom' && cached.meta.upload) return cached.meta;
    if (!force && cached && cached.meta.pageUrl === (bookmark.iconUrl || bookmark.url)) {
      const ttl = cached.meta.status === 'found' || cached.meta.status === 'custom' ? TTL_FOUND : TTL_NONE;
      if (Date.now() - cached.meta.fetchedAt < ttl) return cached.meta;
    }
    let result;
    if (bookmark.iconUrl) {
      const icon = await downloadIcon(bookmark.iconUrl);
      result = { icon, tried: [bookmark.iconUrl] };
    } else {
      result = await discover(bookmark.url, { log });
    }
    const { icon } = result;
    const meta = {
      status: icon ? (bookmark.iconUrl ? 'custom' : 'found') : 'fallback',
      type: icon ? icon.type : null, source: icon ? icon.source.slice(0, 500) : null,
      size: icon ? icon.size || 0 : 0, fetchedAt: Date.now(), pageUrl: bookmark.iconUrl || bookmark.url,
      etag: icon ? `"${crypto.createHash('sha1').update(icon.data).digest('hex').slice(0, 20)}"` : null,
      tried: result.tried.length,
    };
    try { writeCache(dataDir, id, meta, icon ? icon.data : null); } catch { /* cache optional */ }
    return meta;
  })();
  inflight.set(id, p);
  try { return await p; } finally { inflight.delete(id); }
}

/** Store an uploaded icon (buffer). Returns meta or throws. */
function saveUpload(bookmark, dataDir, buf) {
  if (!buf || buf.length > MAX_ICON) throw Object.assign(new Error('Icon too large (max 512 KB)'), { status: 400 });
  const icon = finishIcon(buf, 'upload');
  if (!icon) throw Object.assign(new Error('Unsupported image (PNG, ICO, SVG, GIF, JPEG, WebP)'), { status: 400 });
  const meta = {
    status: 'custom', upload: true, type: icon.type, source: 'upload', size: icon.size || 0, fetchedAt: Date.now(),
    pageUrl: bookmark.url, etag: `"${crypto.createHash('sha1').update(icon.data).digest('hex').slice(0, 20)}"`,
  };
  writeCache(dataDir, bookmark.id, meta, icon.data);
  return meta;
}

module.exports = { discover, refresh, readCache, removeCache, saveUpload, sanitizeSvg, sniff, parseIcons, icoBest, parentDomain };

'use strict';
// Small outgoing-HTTP helper used by the favicon fetcher and the link checker.
// Manual redirect handling (max 5), hard timeouts, byte limits. Requests go only to the
// bookmarked sites themselves – never to third-party services.
const UA_BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const UA_PLAIN = 'BookmarkHub/2.1 (+self-hosted bookmark manager)';

async function readLimited(res, max) {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) { chunks.push(Buffer.from(value).subarray(0, Math.max(0, value.length - (size - max)))); size = max; return { buf: Buffer.concat(chunks), truncated: true }; }
      chunks.push(Buffer.from(value));
    }
  } finally { try { await reader.cancel(); } catch { /* ignore */ } }
  return { buf: Buffer.concat(chunks), truncated: false };
}

/**
 * request(url, { method, max, timeout, accept, ua, readBody })
 * -> { ok, status, url (final), headers, body (Buffer|null), truncated, error }
 */
async function request(url, opts = {}) {
  const { method = 'GET', max = 512 * 1024, timeout = 8000, accept = '*/*', ua = UA_BROWSER, readBody = true, maxRedirects = 5 } = opts;
  let current = url;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    for (let i = 0; i <= maxRedirects; i++) {
      const u = new URL(current);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, status: 0, url: current, error: 'unsupported protocol' };
      const res = await fetch(current, {
        method, redirect: 'manual', signal: ctrl.signal,
        headers: { 'User-Agent': ua, Accept: accept, 'Accept-Language': 'de,en;q=0.8' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        try { await res.body?.cancel(); } catch { /* ignore */ }
        current = new URL(res.headers.get('location'), current).toString();
        continue;
      }
      let body = null; let truncated = false;
      if (readBody && method !== 'HEAD') ({ buf: body, truncated } = await readLimited(res, max));
      else { try { await res.body?.cancel(); } catch { /* ignore */ } }
      return { ok: res.ok, status: res.status, url: current, headers: res.headers, body, truncated };
    }
    return { ok: false, status: 0, url: current, error: 'too many redirects' };
  } catch (e) {
    return { ok: false, status: 0, url: current, error: e.name === 'AbortError' ? 'timeout' : (e.cause && e.cause.code) || e.message };
  } finally { clearTimeout(timer); }
}

// Run async fn over items with a concurrency limit.
async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { request, pool, sleep, UA_BROWSER, UA_PLAIN };

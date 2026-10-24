'use strict';
// Dead-link check, server-side only: HEAD first, GET fallback (many servers reject HEAD),
// timeouts, max 4 parallel requests. Only the bookmarked URLs themselves are requested.
const { request, pool, sleep, UA_PLAIN } = require('./lib/http');

const CONCURRENCY = Number(process.env.LINKCHECK_CONCURRENCY || 4);
const INTERVAL_DAYS = Number(process.env.LINKCHECK_INTERVAL_DAYS || 7);

/** Returns { state: 'ok'|'broken'|'unknown', code, error, finalUrl, checkedAt } */
async function checkUrl(url) {
  let r = await request(url, { method: 'HEAD', timeout: 10000, readBody: false });
  if (!r.ok && (r.status === 0 || r.status === 403 || r.status === 405 || r.status === 501 || r.status === 400 || r.status >= 500 || r.status === 404)) {
    r = await request(url, { method: 'GET', timeout: 12000, max: 64 * 1024, accept: 'text/html,*/*;q=0.8' });
    if (r.status === 0 || r.status === 429 || r.status === 503) {
      await sleep(1500);
      const r2 = await request(url, { method: 'GET', timeout: 12000, max: 64 * 1024, ua: UA_PLAIN });
      if (r2.status !== 0 || r.status === 0) r = r2;
    }
  }
  const checkedAt = new Date().toISOString();
  const finalUrl = r.url !== url ? r.url : undefined;
  if (r.ok) return { state: 'ok', code: r.status, finalUrl, checkedAt };
  // 401/403/429 usually mean "site exists but blocks robots / needs login" -> not broken.
  if ([401, 403, 407, 429, 451].includes(r.status)) return { state: 'ok', code: r.status, note: 'restricted', finalUrl, checkedAt };
  if (r.status === 0 && /ENOTFOUND|EAI_AGAIN/.test(r.error || '')) return { state: 'broken', code: 0, error: 'DNS', checkedAt };
  if (r.status === 0) {
    const err = String(r.error || 'error').slice(0, 80);
    // Refused connections and certificate problems are real errors; resets/timeouts are often bot protection.
    const hard = /ECONNREFUSED|EHOSTUNREACH|CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/.test(err);
    return { state: hard ? 'broken' : 'unknown', code: 0, error: err, checkedAt };
  }
  if (r.status === 404 || r.status === 410 || r.status >= 500) return { state: 'broken', code: r.status, finalUrl, checkedAt };
  return { state: 'unknown', code: r.status, finalUrl, checkedAt };
}

/** Merge a new result with the previous status: "broken" only after 2 failed checks in a row (except 404/410/DNS). */
function merge(prev, res) {
  const fails = res.state === 'broken' ? ((prev && prev.fails) || 0) + 1 : 0;
  const definite = res.code === 404 || res.code === 410 || res.error === 'DNS';
  const state = res.state === 'broken' && fails < 2 && !definite ? 'unknown' : res.state;
  return { ...res, state, fails };
}

function due(b, now = Date.now()) {
  const t = b.linkStatus && Date.parse(b.linkStatus.checkedAt);
  return !t || now - t > INTERVAL_DAYS * 864e5;
}

module.exports = { checkUrl, merge, due, CONCURRENCY, INTERVAL_DAYS, pool };

'use strict';
// Tiny in-memory limiter for failed logins: after `max` failures within `windowMs`
// the key is blocked for the rest of the window.
function createLimiter({ max, windowMs }) {
  const hits = new Map();
  const prune = () => { const now = Date.now(); for (const [k, v] of hits) if (v.until < now) hits.delete(k); };
  setInterval(prune, 60e3).unref();
  return {
    fail(key) {
      const now = Date.now();
      const e = hits.get(key);
      if (!e || e.until < now) hits.set(key, { count: 1, until: now + windowMs });
      else e.count++;
    },
    blockedFor(key, limit = max) {
      const e = hits.get(key);
      if (!e || e.until < Date.now() || e.count < limit) return 0;
      return e.until - Date.now();
    },
    reset(key) { hits.delete(key); },
  };
}
module.exports = { createLimiter };

'use strict';
// Optional update notice (admins only, OFF by default). At most one request per 24 hours to
// https://api.github.com/repos/olivermandic/bookmarkhub/releases/latest. No user data, no cookies,
// no installation ID is sent - only a fixed User-Agent. The answer is stored in data/settings.json.
const settings = require('./settings');

const REPO = process.env.UPDATE_REPO || 'olivermandic/bookmarkhub';
// UPDATE_API_URL only exists for the automated tests (local fake server instead of GitHub).
const API = process.env.UPDATE_API_URL || `https://api.github.com/repos/${REPO}/releases/latest`;
const DAY = 24 * 60 * 60 * 1000;

function cmp(a, b) {
  const p = (v) => String(v || '').replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  const x = p(a); const y = p(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

async function check({ force = false, fetchImpl = globalThis.fetch, now = Date.now(), log = () => {} } = {}) {
  if (!settings.get().updateCheck) return null;
  const last = settings.getState('update');
  if (!force && last && last.checkedAt && now - Date.parse(last.checkedAt) < DAY) return last;
  const state = { checkedAt: new Date(now).toISOString(), latest: last ? last.latest || null : null, url: last ? last.url || null : null, error: null };
  try {
    const res = await fetchImpl(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BookmarkHub-update-check' }, signal: AbortSignal.timeout(10000), redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const tag = String(j.tag_name || '').slice(0, 40);
    if (!/^v?\d+\.\d+\.\d+/.test(tag)) throw new Error('no release tag');
    state.latest = tag.replace(/^v/i, '');
    const url = String(j.html_url || '');
    state.url = /^https:\/\/github\.com\//.test(url) ? url.slice(0, 300) : `https://github.com/${REPO}/releases`;
  } catch (e) { state.error = String(e.message || e).slice(0, 200); log(`update check failed: ${state.error}`); }
  settings.setState('update', state);
  return state;
}

/** What the admin banner needs, or null. Never triggers a request. */
function notice(currentVersion) {
  if (!settings.get().updateCheck) return null;
  const s = settings.getState('update');
  if (!s || !s.latest || cmp(s.latest, currentVersion) <= 0) return null;
  return { latest: s.latest, url: s.url, checkedAt: s.checkedAt };
}

function start(log) {
  const run = () => { check({ log }).catch(() => {}); };
  setTimeout(run, 60e3).unref();
  setInterval(run, 6 * 60 * 60e3).unref(); // wakes every 6 h, but requests at most once per 24 h
}

module.exports = { check, notice, start, cmp, API };

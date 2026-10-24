'use strict';
// Instance settings chosen by an admin (data/settings.json). Environment variables only set the
// defaults; once an admin saves a value in the admin area, the saved value wins.
const path = require('path');
const store = require('./store');

const FILE = path.join(store.DATA_DIR, 'settings.json');
const envDefaults = () => ({
  // Server-side fetching of external sites (default ON = behaviour of 2.0/2.1).
  fetchFavicons: process.env.FAVICON_FETCH !== 'false',
  linkCheck: process.env.LINKCHECK_DISABLED !== 'true',
  // Update notice for admins: OFF unless enabled here or with UPDATE_CHECK=true.
  updateCheck: process.env.UPDATE_CHECK === 'true',
});
const KEYS = ['fetchFavicons', 'linkCheck', 'updateCheck'];

function raw() { const s = store.readJson(FILE, {}); return s && typeof s === 'object' ? s : {}; }
function get() {
  const saved = raw(); const d = envDefaults(); const out = {};
  for (const k of KEYS) out[k] = typeof saved[k] === 'boolean' ? saved[k] : d[k];
  return out;
}
function set(patch) {
  const saved = raw();
  for (const k of KEYS) if (patch && typeof patch[k] === 'boolean') saved[k] = patch[k];
  store.writeJson(FILE, saved);
  return get();
}
function getState(key) { return raw()[`state_${key}`] || null; }
function setState(key, value) { const saved = raw(); saved[`state_${key}`] = value; store.writeJson(FILE, saved); }

module.exports = { get, set, getState, setState, KEYS };

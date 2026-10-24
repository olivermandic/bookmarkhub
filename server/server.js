'use strict';
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { hashPassword, verifyPassword, DUMMY_HASH, passwordProblem } = require('./password');
const { createLimiter } = require('./ratelimit');
const { applyResetTrigger } = require('./reset');
const favicons = require('./favicons');
const linkcheck = require('./linkcheck');
const backups = require('./backup');
const totp = require('./totp');
const settings = require('./settings');
const updatecheck = require('./updatecheck');
const QRCode = require('qrcode');
const pkg = require('./package.json');

const PORT = Number(process.env.PORT || 3131);
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(__dirname, '..', 'dist'));
const COOKIE_NAME = 'bmh_session';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
// "auto" = Secure flag when the request came in via HTTPS (reverse proxy sets X-Forwarded-Proto).
const COOKIE_SECURE = (process.env.COOKIE_SECURE || 'auto').toLowerCase();
// Install path behind a reverse proxy, e.g. "/bookmarks/". Default "/". Nothing else is hard-coded.
const BASE_PATH = (`/${(process.env.BASE_PATH || '').replace(/^\/+|\/+$/g, '')}/`).replace('//', '/');
const BACKGROUND = process.env.BACKGROUND_JOBS !== 'false';
const BUILD_ID = (() => { try { return fs.statSync(path.join(STATIC_DIR, 'index.html')).mtimeMs.toString(36).slice(0, 6); } catch { return 'dev'; } })();

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- startup: data folder, migration, reset trigger ----------
store.initIfEmpty(log);
for (const m of [store.migrateUsers(), store.migrateBookmarks(), store.migrateV3()]) if (m) log(m);
applyResetTrigger(log);
const SECRET = store.getSessionSecret();

// ---------- helpers ----------
const publicUser = (u) => ({
  id: u.id, username: u.username, isAdmin: !!u.isAdmin,
  isFirstLogin: !!u.isFirstLogin, mustChangePassword: !!u.mustChangePassword,
  twoFactorEnabled: !!(u.totp && u.totp.secret), prefs: u.prefs || {},
});

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function unsign(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function setSessionCookie(req, res, user) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const token = sign({ uid: user.id, sv: user.sessionVersion || 1, exp });
  const secure = COOKIE_SECURE === 'true' || (COOKIE_SECURE === 'auto' && req.secure);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=${BASE_PATH}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=${BASE_PATH}; HttpOnly; SameSite=Strict; Max-Age=0`);
}
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function validUrl(v) {
  try {
    const u = new URL(String(v).trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : null;
  } catch { return null; }
}
function cleanBookmarkInput(input, partial) {
  const out = {};
  const err = (m) => { throw Object.assign(new Error(m), { status: 400 }); };
  if (!partial || 'title' in input) { out.title = str(input.title, 200); if (!out.title) err('Title is required'); }
  if (!partial || 'url' in input) { out.url = validUrl(input.url); if (!out.url) err('Valid http(s) URL is required'); }
  if ('description' in input) out.description = str(input.description, 1000);
  if ('tags' in input) {
    out.tags = (Array.isArray(input.tags) ? input.tags : []).map((t) => str(t, 50)).filter(Boolean).slice(0, 30);
  } else if (!partial) out.tags = [];
  if (!partial || 'isShared' in input) out.isShared = !!input.isShared;
  if ('sharedWith' in input) {
    // Share with chosen users only (ids of existing users). Empty list + isShared = everyone.
    const ids = new Set(store.getUsers().map((u) => u.id));
    out.sharedWith = [...new Set((Array.isArray(input.sharedWith) ? input.sharedWith : []).map(String))].filter((id) => ids.has(id)).slice(0, 200);
    if (Array.isArray(input.sharedWith) && input.sharedWith.length && !out.sharedWith.length) err('Unknown users');
  } else if (!partial) out.sharedWith = [];
  if ('favicon' in input) {
    const f = str(input.favicon, 2000);
    // Either an http(s) URL or a short fallback text (emoji/letter).
    out.favicon = validUrl(f) || (f.length <= 8 ? f : '');
  }
  if ('iconUrl' in input) {
    const f = str(input.iconUrl, 2000);
    out.iconUrl = f ? (validUrl(f) || err('Icon URL must be http(s)')) : '';
  }
  if ('categoryId' in input) {
    const c = input.categoryId ? String(input.categoryId) : null;
    if (c && !store.getCategories().some((x) => x.id === c)) err('Unknown category');
    out.categoryId = c;
  }
  return out;
}

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
    "connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true, version: pkg.version }));

const api = express.Router();
api.use(express.json({ limit: '100kb' }));

// CSRF protection: SameSite=Strict cookie + custom header that a cross-site form cannot send.
api.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'bookmarkhub') return res.status(403).json({ error: 'Forbidden' });
  next();
});

// Load session user (if any).
api.use((req, res, next) => {
  const payload = unsign(parseCookies(req.headers.cookie)[COOKIE_NAME]);
  if (payload && payload.exp > Date.now()) {
    const user = store.getUsers().find((u) => u.id === payload.uid);
    if (user && (user.sessionVersion || 1) === payload.sv) req.user = user;
  }
  next();
});
const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Not logged in' }));
const requireAdmin = (req, res, next) => (req.user && req.user.isAdmin ? next() : res.status(403).json({ error: 'Admins only' }));

// ---- auth ----
const loginLimiter = createLimiter({ max: 5, windowMs: 15 * 60e3 });
api.post('/login', (req, res) => {
  const username = str(req.body && req.body.username, 100);
  const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';
  const key = `${req.ip}|${username.toLowerCase()}`;
  const ipKey = `${req.ip}|*`;
  const wait = Math.max(loginLimiter.blockedFor(key), loginLimiter.blockedFor(ipKey, 30));
  if (wait > 0) {
    res.setHeader('Retry-After', Math.ceil(wait / 1000));
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60000)} min.` });
  }
  const users = store.getUsers();
  const user = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  const ok = verifyPassword(password, user ? user.passwordHash : DUMMY_HASH) && !!user;
  if (!ok) {
    loginLimiter.fail(key); loginLimiter.fail(ipKey);
    log(`login failed for "${username.slice(0, 40)}" from ${req.ip}`);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  loginLimiter.reset(key);
  if (user.totp && user.totp.secret) {
    // Second step required: short-lived signed ticket, no session yet.
    const ticket = sign({ t: '2fa', uid: user.id, sv: user.sessionVersion || 1, exp: Date.now() + 5 * 60e3 });
    return res.json({ twoFactorRequired: true, ticket });
  }
  finishLogin(req, res, users, user);
});
function finishLogin(req, res, users, user) {
  const isFirst = !!user.isFirstLogin;
  user.lastLoginAt = new Date().toISOString();
  store.saveUsers(users);
  setSessionCookie(req, res, user);
  res.json({ ...publicUser(user), isFirstLogin: isFirst });
}
const totpLimiter = createLimiter({ max: 5, windowMs: 15 * 60e3 });
api.post('/login/2fa', (req, res) => {
  const t = unsign(req.body && req.body.ticket);
  if (!t || t.t !== '2fa' || t.exp < Date.now()) return res.status(401).json({ error: 'Login expired, please start again' });
  const key = `2fa|${t.uid}`;
  const wait = totpLimiter.blockedFor(key);
  if (wait > 0) { res.setHeader('Retry-After', Math.ceil(wait / 1000)); return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60000)} min.` }); }
  const users = store.getUsers();
  const user = users.find((u) => u.id === t.uid);
  if (!user || (user.sessionVersion || 1) !== t.sv || !user.totp) return res.status(401).json({ error: 'Login expired, please start again' });
  const code = String((req.body && req.body.code) || '').trim();
  let ok = false;
  if (/^\d{6}$/.test(code.replace(/\s/g, ''))) {
    const ctr = totp.verify(user.totp.secret, code, { lastCounter: user.totp.lastCounter || -1 });
    if (ctr >= 0) { user.totp.lastCounter = ctr; ok = true; }
  } else if (code) {
    const h = totp.hashCode(code);
    const idx = (user.totp.recovery || []).indexOf(h);
    if (idx >= 0) { user.totp.recovery.splice(idx, 1); ok = true; log(`recovery code used by "${user.username}" (${user.totp.recovery.length} left)`); }
  }
  if (!ok) { totpLimiter.fail(key); return res.status(401).json({ error: 'Invalid code' }); }
  totpLimiter.reset(key);
  finishLogin(req, res, users, user);
});
api.post('/logout', (req, res) => { clearSessionCookie(res); res.json({ success: true }); });
api.get('/me', requireAuth, (req, res) => res.json(publicUser(req.user)));

// Own account: dismiss first-login hint, change own password.
api.post('/me', requireAuth, (req, res) => {
  const users = store.getUsers();
  const u = users.find((x) => x.id === req.user.id);
  if (req.body && req.body.isFirstLogin === false) u.isFirstLogin = false;
  store.saveUsers(users);
  res.json(publicUser(u));
});
api.post('/me/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!verifyPassword(String(currentPassword || ''), req.user.passwordHash)) return res.status(400).json({ error: 'Current password is wrong' });
  const problem = passwordProblem(newPassword);
  if (problem) return res.status(400).json({ error: problem });
  const users = store.getUsers();
  const u = users.find((x) => x.id === req.user.id);
  u.passwordHash = hashPassword(newPassword);
  u.mustChangePassword = false;
  u.sessionVersion = (u.sessionVersion || 1) + 1; // logs out all other sessions
  store.saveUsers(users);
  setSessionCookie(req, res, u);
  res.json(publicUser(u));
});

const PREF_KEYS = { view: ['grid', 'list', 'compact'], theme: ['system', 'light', 'dark'], sort: ['manual', 'title', 'recent'] };
api.put('/me/prefs', requireAuth, (req, res) => {
  const body = req.body || {};
  const u = store.updateUsers((users) => {
    const x = users.find((y) => y.id === req.user.id);
    const p = { ...(x.prefs || {}) };
    for (const [k, allowed] of Object.entries(PREF_KEYS)) if (allowed.includes(body[k])) p[k] = body[k];
    if (typeof body.language === 'string' && /^[a-z]{2}(-[A-Z]{2})?$|^auto$/.test(body.language)) p.language = body.language;
    if (Array.isArray(body.categoryOrder)) p.categoryOrder = body.categoryOrder.map(String).slice(0, 500);
    if (body.bookmarkOrder && typeof body.bookmarkOrder === 'object') {
      const bo = {};
      for (const [cat, ids] of Object.entries(body.bookmarkOrder).slice(0, 500)) if (Array.isArray(ids)) bo[String(cat).slice(0, 100)] = ids.map(String).slice(0, 5000);
      p.bookmarkOrder = { ...(p.bookmarkOrder || {}), ...bo };
    }
    if (Array.isArray(body.collapsed)) p.collapsed = body.collapsed.map(String).slice(0, 500);
    x.prefs = p;
    return x;
  });
  res.json(publicUser(u));
});

// ---- two-factor login (TOTP) ----
api.post('/me/2fa/setup', requireAuth, async (req, res, next) => {
  try {
    if (!verifyPassword(String((req.body && req.body.password) || ''), req.user.passwordHash)) return res.status(400).json({ error: 'Current password is wrong' });
    const secret = totp.newSecret();
    store.updateUsers((users) => { users.find((x) => x.id === req.user.id).totpPending = { secret, at: Date.now() }; });
    const url = totp.otpauthUrl({ secret, account: req.user.username });
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }); // generated locally
    res.json({ secret, otpauthUrl: url, qrSvg });
  } catch (e) { next(e); }
});
api.post('/me/2fa/enable', requireAuth, (req, res) => {
  const pending = req.user.totpPending;
  if (!pending || Date.now() - pending.at > 15 * 60e3) return res.status(400).json({ error: 'Setup expired, please start again' });
  const ctr = totp.verify(pending.secret, req.body && req.body.code);
  if (ctr < 0) return res.status(400).json({ error: 'Invalid code' });
  const codes = totp.newRecoveryCodes();
  const u = store.updateUsers((users) => {
    const x = users.find((y) => y.id === req.user.id);
    x.totp = { secret: pending.secret, enabledAt: new Date().toISOString(), lastCounter: ctr, recovery: codes.map(totp.hashCode) };
    delete x.totpPending;
    x.sessionVersion = (x.sessionVersion || 1) + 1; // sign out other devices
    return x;
  });
  setSessionCookie(req, res, u);
  log(`two-factor login enabled for "${u.username}"`);
  res.json({ ...publicUser(u), recoveryCodes: codes });
});
api.post('/me/2fa/disable', requireAuth, (req, res) => {
  const body = req.body || {};
  if (!req.user.totp) return res.json(publicUser(req.user));
  if (!verifyPassword(String(body.password || ''), req.user.passwordHash)) return res.status(400).json({ error: 'Current password is wrong' });
  if (totp.verify(req.user.totp.secret, body.code) < 0 && !(req.user.totp.recovery || []).includes(totp.hashCode(body.code || ''))) return res.status(400).json({ error: 'Invalid code' });
  const u = store.updateUsers((users) => { const x = users.find((y) => y.id === req.user.id); delete x.totp; delete x.totpPending; return x; });
  log(`two-factor login disabled for "${u.username}"`);
  res.json(publicUser(u));
});
api.post('/me/2fa/recovery-codes', requireAuth, (req, res) => {
  if (!req.user.totp) return res.status(400).json({ error: 'Two-factor login is not enabled' });
  if (!verifyPassword(String((req.body && req.body.password) || ''), req.user.passwordHash)) return res.status(400).json({ error: 'Current password is wrong' });
  const codes = totp.newRecoveryCodes();
  store.updateUsers((users) => { users.find((y) => y.id === req.user.id).totp.recovery = codes.map(totp.hashCode); });
  res.json({ recoveryCodes: codes });
});

// ---- people directory (names only, for "share with") ----
api.get('/users/directory', requireAuth, (req, res) => res.json(store.getUsers().map((u) => ({ id: u.id, username: u.username }))));

// ---- instance settings ----
api.get('/config', requireAuth, (req, res) => {
  const s = settings.get();
  res.json({ version: pkg.version, fetchFavicons: s.fetchFavicons, linkCheck: s.linkCheck, ...(req.user.isAdmin ? { updateCheck: s.updateCheck, update: updatecheck.notice(pkg.version) } : {}) });
});
api.get('/admin/settings', requireAdmin, (req, res) => res.json({ ...settings.get(), updateState: settings.getState('update') }));
api.put('/admin/settings', requireAdmin, async (req, res) => {
  const before = settings.get();
  const s = settings.set(req.body || {});
  for (const k of settings.KEYS) if (before[k] !== s[k]) log(`setting ${k} = ${s[k]} by admin "${req.user.username}"`);
  if (!before.updateCheck && s.updateCheck) await updatecheck.check({ log }).catch(() => {}); // first check (still max. once per 24 h, 10 s timeout)
  res.json({ ...s, updateState: settings.getState('update') });
});

// ---- users (admin) ----
api.get('/users', requireAdmin, (req, res) => {
  const counts = {};
  store.getBookmarks().forEach((b) => { counts[b.createdBy] = (counts[b.createdBy] || 0) + 1; });
  res.json(store.getUsers().map((u) => ({ ...publicUser(u), lastLoginAt: u.lastLoginAt || null, bookmarkCount: counts[u.id] || 0 })));
});
api.post('/users', requireAdmin, (req, res) => {
  const username = str(req.body && req.body.username, 50);
  if (!/^[\w.@-]{2,50}$/.test(username)) return res.status(400).json({ error: 'Username: 2-50 characters (letters, digits, . _ - @)' });
  const problem = passwordProblem(req.body.password);
  if (problem) return res.status(400).json({ error: problem });
  const users = store.getUsers();
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return res.status(400).json({ error: 'Username already exists' });
  const user = {
    id: `user-${crypto.randomUUID()}`, username, passwordHash: hashPassword(req.body.password),
    isAdmin: !!req.body.isAdmin, isFirstLogin: true, mustChangePassword: false, sessionVersion: 1, createdAt: new Date().toISOString(),
  };
  users.push(user);
  store.saveUsers(users);
  res.status(201).json(publicUser(user));
});
api.put('/users/:id', requireAdmin, (req, res) => {
  const users = store.getUsers();
  const u = users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const body = req.body || {};
  if ('username' in body) {
    const name = str(body.username, 50);
    if (!/^[\w.@-]{2,50}$/.test(name)) return res.status(400).json({ error: 'Invalid username' });
    if (users.some((x) => x.id !== u.id && x.username.toLowerCase() === name.toLowerCase())) return res.status(400).json({ error: 'Username already exists' });
    u.username = name;
  }
  if ('isAdmin' in body) {
    const makeAdmin = !!body.isAdmin;
    if (!makeAdmin && u.isAdmin && users.filter((x) => x.isAdmin).length === 1) return res.status(400).json({ error: 'The last admin cannot be demoted' });
    u.isAdmin = makeAdmin;
  }
  if (body.disable2fa === true && u.totp) { delete u.totp; delete u.totpPending; log(`two-factor login of "${u.username}" disabled by admin "${req.user.username}"`); }
  if (body.password) {
    const problem = passwordProblem(body.password);
    if (problem) return res.status(400).json({ error: problem });
    u.passwordHash = hashPassword(body.password);
    u.mustChangePassword = u.id !== req.user.id; // user must pick their own password next time
    u.sessionVersion = (u.sessionVersion || 1) + 1;
  }
  store.saveUsers(users);
  if (u.id === req.user.id && body.password) setSessionCookie(req, res, u);
  res.json(publicUser(u));
});
api.delete('/users/:id', requireAdmin, (req, res) => {
  const users = store.getUsers();
  const u = users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself' });
  if (u.isAdmin && users.filter((x) => x.isAdmin).length === 1) return res.status(400).json({ error: 'The last admin cannot be deleted' });
  store.saveUsers(users.filter((x) => x.id !== u.id));
  store.updateBookmarks((list) => list.forEach((b) => {
    if (Array.isArray(b.sharedWith) && b.sharedWith.includes(u.id)) {
      b.sharedWith = b.sharedWith.filter((id) => id !== u.id);
      if (!b.sharedWith.length) b.isShared = false; // was meant for chosen people only -> private, never "everyone"
    }
  }));
  res.json({ success: true });
});

// ---- bookmarks ----
// private: only the owner | shared + empty list: everyone | shared + list: owner and the listed users
const audience = (b) => (b.isShared && Array.isArray(b.sharedWith) && b.sharedWith.length ? b.sharedWith : null);
const visible = (b, user) => b.createdBy === user.id || (b.isShared && (!audience(b) || audience(b).includes(user.id)));
function normalizeSharing(b) {
  if (!b.isShared) b.sharedWith = [];
  else b.sharedWith = (b.sharedWith || []).filter((id) => id !== b.createdBy);
  return b;
}
const canEdit = (b, user) => b.createdBy === user.id || user.isAdmin;

api.get('/bookmarks', requireAuth, (req, res) => {
  res.json(store.getBookmarks().filter((b) => visible(b, req.user)));
});
api.post('/bookmarks', requireAuth, (req, res, next) => {
  try {
    const data = cleanBookmarkInput((req.body && req.body.bookmark) || {}, false);
    const now = new Date().toISOString();
    const bm = normalizeSharing({ ...data, id: `bookmark-${crypto.randomUUID()}`, createdBy: req.user.id, createdAt: now, updatedAt: now });
    if (data.isShared && 'sharedWith' in ((req.body && req.body.bookmark) || {}) && ((req.body.bookmark.sharedWith || []).length) && !bm.sharedWith.length) bm.isShared = false;
    const list = store.getBookmarks();
    list.push(bm);
    store.saveBookmarks(list);
    res.status(201).json(bm);
    if (BACKGROUND && settings.get().fetchFavicons) favicons.refresh(bm, store.DATA_DIR, { log }).then((m) => setIconStatus(bm.id, m)).catch(() => {});
  } catch (e) { next(e); }
});
api.put('/bookmarks/:id', requireAuth, (req, res, next) => {
  try {
    const list = store.getBookmarks();
    const b = list.find((x) => x.id === req.params.id);
    if (!b || !visible(b, req.user)) return res.status(404).json({ error: 'Bookmark not found' });
    if (!canEdit(b, req.user)) return res.status(403).json({ error: 'Not allowed' });
    const before = { url: b.url, iconUrl: b.iconUrl || '' };
    const upd = cleanBookmarkInput((req.body && req.body.updates) || {}, true);
    const hadAudience = !!audience(b);
    Object.assign(b, upd, { updatedAt: new Date().toISOString() });
    normalizeSharing(b);
    // a list that ends up empty (only the owner was picked) must not silently become "everyone"
    if (b.isShared && 'sharedWith' in upd && Array.isArray(req.body.updates.sharedWith) && req.body.updates.sharedWith.length && !b.sharedWith.length) b.isShared = false;
    else if (b.isShared && hadAudience && !('sharedWith' in upd) && !b.sharedWith.length) b.isShared = false;
    if (b.url !== before.url) delete b.linkStatus;
    store.saveBookmarks(list);
    res.json(b);
    if (BACKGROUND && settings.get().fetchFavicons && (b.url !== before.url || (b.iconUrl || '') !== before.iconUrl)) favicons.refresh(b, store.DATA_DIR, { force: true, log }).then((m) => setIconStatus(b.id, m)).catch(() => {});
  } catch (e) { next(e); }
});
api.delete('/bookmarks/:id', requireAuth, (req, res) => {
  const list = store.getBookmarks();
  const b = list.find((x) => x.id === req.params.id);
  if (!b || !visible(b, req.user)) return res.status(404).json({ error: 'Bookmark not found' });
  if (!canEdit(b, req.user)) return res.status(403).json({ error: 'Not allowed' });
  store.saveBookmarks(list.filter((x) => x.id !== b.id));
  favicons.removeCache(store.DATA_DIR, b.id);
  res.json({ success: true });
});

// ---- categories (shared by the household; order is personal, see /me/prefs) ----
api.get('/categories', requireAuth, (req, res) => res.json(store.getCategories()));
api.post('/categories', requireAuth, (req, res) => {
  const name = str(req.body && req.body.name, 80);
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const cat = store.updateCategories((list) => {
    const existing = list.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const c = { id: `cat-${crypto.randomUUID()}`, name, createdBy: req.user.id, createdAt: new Date().toISOString() };
    list.push(c);
    return c;
  });
  res.status(201).json(cat);
});
const canEditCat = (c, user) => c.createdBy === user.id || user.isAdmin;
api.put('/categories/:id', requireAuth, (req, res) => {
  const name = str(req.body && req.body.name, 80);
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const list = store.getCategories();
  const c = list.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Category not found' });
  if (!canEditCat(c, req.user)) return res.status(403).json({ error: 'Not allowed' });
  c.name = name;
  store.saveCategories(list);
  res.json(c);
});
api.delete('/categories/:id', requireAuth, (req, res) => {
  const list = store.getCategories();
  const c = list.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Category not found' });
  if (!canEditCat(c, req.user)) return res.status(403).json({ error: 'Not allowed' });
  store.saveCategories(list.filter((x) => x.id !== c.id));
  // bookmarks of this category become "uncategorised" – nothing is deleted
  store.updateBookmarks((bms) => bms.forEach((b) => { if (b.categoryId === c.id) b.categoryId = null; }));
  res.json({ success: true });
});

// ---- favicons ----
// Fetched by the server and cached in the data folder, so the browser never contacts
// third-party sites just to show an icon (privacy).
function setIconStatus(id, meta) {
  store.updateBookmarks((list) => {
    const b = list.find((x) => x.id === id);
    if (b) { b.iconStatus = meta.status; b.iconVersion = meta.etag ? meta.etag.replace(/"/g, '').slice(0, 8) : null; }
  });
}
api.get('/favicon/:id', requireAuth, async (req, res) => {
  const b = store.getBookmarks().find((x) => x.id === req.params.id);
  if (!b || !visible(b, req.user)) return res.status(404).end();
  let cached = favicons.readCache(store.DATA_DIR, b.id);
  if (settings.get().fetchFavicons && (!cached || cached.meta.pageUrl !== (b.iconUrl || b.url) || (!cached.meta.upload && Date.now() - cached.meta.fetchedAt > (cached.meta.type ? 30 : 3) * 864e5))) {
    const meta = await favicons.refresh(b, store.DATA_DIR, { log });
    if (b.iconStatus !== meta.status) setIconStatus(b.id, meta);
    cached = favicons.readCache(store.DATA_DIR, b.id);
  }
  if (!cached || !cached.data) return res.status(404).end();
  const { meta } = cached;
  res.setHeader('Cache-Control', 'private, max-age=86400');
  if (meta.etag) {
    res.setHeader('ETag', meta.etag);
    if (req.headers['if-none-match'] === meta.etag) return res.status(304).end();
  }
  res.setHeader('Content-Type', meta.type);
  if (meta.type === 'image/svg+xml') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.end(cached.data);
});
const fetchOff = (res) => res.status(409).json({ error: 'Loading icons from websites is switched off by the admin', code: 'fetch_disabled' });
const linkOff = (res) => res.status(409).json({ error: 'The link check is switched off by the admin', code: 'linkcheck_disabled' });
api.post('/bookmarks/:id/favicon/refresh', requireAuth, async (req, res) => {
  const b = store.getBookmarks().find((x) => x.id === req.params.id);
  if (!b || !visible(b, req.user)) return res.status(404).json({ error: 'Bookmark not found' });
  if (!settings.get().fetchFavicons) return fetchOff(res);
  const meta = await favicons.refresh(b, store.DATA_DIR, { force: true, log });
  setIconStatus(b.id, meta);
  res.json({ status: meta.status, iconVersion: meta.etag ? meta.etag.replace(/"/g, '').slice(0, 8) : null, source: meta.source });
});
api.post('/bookmarks/:id/favicon', requireAuth, express.json({ limit: '800kb' }), (req, res, next) => {
  try {
    const b = store.getBookmarks().find((x) => x.id === req.params.id);
    if (!b || !visible(b, req.user)) return res.status(404).json({ error: 'Bookmark not found' });
    if (!canEdit(b, req.user)) return res.status(403).json({ error: 'Not allowed' });
    const m = String((req.body && req.body.data) || '').match(/^(?:data:[^;,]*;base64,)?([A-Za-z0-9+/=\s]+)$/);
    if (!m) return res.status(400).json({ error: 'Invalid image data' });
    const meta = favicons.saveUpload(b, store.DATA_DIR, Buffer.from(m[1], 'base64'));
    setIconStatus(b.id, meta);
    res.json({ status: meta.status, iconVersion: meta.etag.replace(/"/g, '').slice(0, 8) });
  } catch (e) { next(e); }
});
api.delete('/bookmarks/:id/favicon', requireAuth, async (req, res) => {
  const b = store.getBookmarks().find((x) => x.id === req.params.id);
  if (!b || !visible(b, req.user)) return res.status(404).json({ error: 'Bookmark not found' });
  if (!canEdit(b, req.user)) return res.status(403).json({ error: 'Not allowed' });
  favicons.removeCache(store.DATA_DIR, b.id);
  store.updateBookmarks((list) => { const x = list.find((y) => y.id === b.id); if (x) x.iconUrl = ''; });
  if (!settings.get().fetchFavicons) { setIconStatus(b.id, { status: 'fallback', etag: null }); return res.json({ status: 'fallback', iconVersion: null }); }
  const meta = await favicons.refresh({ ...b, iconUrl: '' }, store.DATA_DIR, { force: true, log });
  setIconStatus(b.id, meta);
  res.json({ status: meta.status, iconVersion: meta.etag ? meta.etag.replace(/"/g, '').slice(0, 8) : null });
});

// ---- dead-link check ----
async function checkBookmark(id) {
  const b = store.getBookmarks().find((x) => x.id === id);
  if (!b) return null;
  const res = linkcheck.merge(b.linkStatus, await linkcheck.checkUrl(b.url));
  store.updateBookmarks((list) => { const x = list.find((y) => y.id === id); if (x) x.linkStatus = res; });
  return res;
}
api.post('/bookmarks/:id/check', requireAuth, async (req, res) => {
  const b = store.getBookmarks().find((x) => x.id === req.params.id);
  if (!b || !visible(b, req.user)) return res.status(404).json({ error: 'Bookmark not found' });
  if (!settings.get().linkCheck) return linkOff(res);
  res.json(await checkBookmark(b.id));
});

// ---- background jobs (one of each kind at a time) ----
const jobs = {};
function startJob(kind, ids, worker, concurrency) {
  if (jobs[kind] && jobs[kind].running) return jobs[kind];
  const job = { kind, running: true, total: ids.length, done: 0, results: {}, startedAt: new Date().toISOString(), finishedAt: null };
  jobs[kind] = job;
  linkcheck.pool(ids, concurrency, async (id) => {
    try { const r = await worker(id); const k = (r && (r.status || r.state)) || 'failed'; job.results[k] = (job.results[k] || 0) + 1; } catch { job.results.failed = (job.results.failed || 0) + 1; }
    job.done++;
  }).finally(() => { job.running = false; job.finishedAt = new Date().toISOString(); log(`job ${kind} finished: ${JSON.stringify(job.results)}`); });
  return job;
}
const faviconWorker = async (id) => {
  const b = store.getBookmarks().find((x) => x.id === id);
  if (!b) return null;
  const meta = await favicons.refresh(b, store.DATA_DIR, { force: true, log });
  setIconStatus(id, meta);
  return meta;
};
api.get('/jobs', requireAuth, (req, res) => res.json(jobs));
api.post('/admin/favicons/refresh-all', requireAdmin, (req, res) => {
  if (!settings.get().fetchFavicons) return fetchOff(res);
  res.status(202).json(startJob('favicons', store.getBookmarks().map((b) => b.id), faviconWorker, 4));
});
api.post('/admin/links/check-all', requireAdmin, (req, res) => {
  if (!settings.get().linkCheck) return linkOff(res);
  res.status(202).json(startJob('links', store.getBookmarks().map((b) => b.id), checkBookmark, linkcheck.CONCURRENCY));
});

// ---- backups (admin) ----
api.get('/admin/backups', requireAdmin, (req, res) => res.json({ dir: backups.BACKUP_DIR, backups: backups.list() }));
api.post('/admin/backups', requireAdmin, (req, res, next) => {
  try { const name = backups.write(true); backups.rotate(); log(`manual backup by "${req.user.username}": ${name}`); res.status(201).json({ name, backups: backups.list() }); } catch (e) { next(e); }
});
api.get('/admin/backups/:name', requireAdmin, (req, res) => {
  const file = backups.filePath(req.params.name);
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}"`);
  fs.createReadStream(file).pipe(res);
});

// ---- import (browser bookmark HTML is parsed in the browser; server gets clean items) ----
const normUrl = (u) => { try { const x = new URL(u); x.hash = ''; return x.toString().replace(/\/$/, '').replace(/^http:/, 'https:').replace('://www.', '://').toLowerCase(); } catch { return null; } };
api.post('/import', requireAuth, express.json({ limit: '5mb' }), (req, res) => {
  const items = Array.isArray(req.body && req.body.items) ? req.body.items.slice(0, 5000) : [];
  const isShared = !!(req.body && req.body.isShared);
  const existing = new Set(store.getBookmarks().filter((b) => visible(b, req.user)).map((b) => normUrl(b.url)));
  const catByName = new Map(store.getCategories().map((c) => [c.name.toLowerCase(), c]));
  const newCats = [];
  const created = []; let skipped = 0; let invalid = 0;
  const now = new Date().toISOString();
  for (const it of items) {
    let data;
    try { data = cleanBookmarkInput({ title: it.title || it.url, url: it.url, description: it.description || '', tags: it.tags || [], isShared: 'isShared' in it ? it.isShared : isShared }, false); } catch { invalid++; continue; }
    const key = normUrl(data.url);
    if (existing.has(key)) { skipped++; continue; }
    existing.add(key);
    let categoryId = null;
    const cname = str(it.category, 80);
    if (cname) {
      let c = catByName.get(cname.toLowerCase());
      if (!c) { c = { id: `cat-${crypto.randomUUID()}`, name: cname, createdBy: req.user.id, createdAt: now }; catByName.set(cname.toLowerCase(), c); newCats.push(c); }
      categoryId = c.id;
    }
    created.push({ ...data, categoryId, id: `bookmark-${crypto.randomUUID()}`, createdBy: req.user.id, createdAt: it.addDate && !Number.isNaN(Date.parse(it.addDate)) ? new Date(it.addDate).toISOString() : now, updatedAt: now });
  }
  if (created.length || newCats.length) {
    store.backup(store.BOOKMARKS_FILE, 'pre-import');
    if (newCats.length) store.updateCategories((l) => l.push(...newCats));
    store.updateBookmarks((l) => l.push(...created));
  }
  log(`import by "${req.user.username}": ${created.length} created, ${skipped} duplicates, ${invalid} invalid, ${newCats.length} new categories`);
  res.json({ created: created.length, skipped, invalid, categoriesCreated: newCats.length });
});

// Export own + shared bookmarks as JSON (can be imported again).
api.get('/export', requireAuth, (req, res) => {
  const list = store.getBookmarks().filter((b) => visible(b, req.user));
  const cats = store.getCategories();
  res.setHeader('Content-Disposition', `attachment; filename="bookmarkhub-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({
    app: 'BookmarkHub', exportedAt: new Date().toISOString(), version: pkg.version, categories: cats,
    bookmarks: list.map(({ linkStatus, iconStatus, iconVersion, sharedWith, ...b }) => ({ ...b, category: (cats.find((c) => c.id === b.categoryId) || {}).name || '' })),
  });
});

api.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
api.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  log('error:', err.message);
  res.status(500).json({ error: 'Internal error' });
});
const site = express.Router();
site.use('/api', api);

// ---------- static frontend ----------
// index.html gets the install path as <base href>; sw.js gets the release version (cache bump).
let indexCache = null; let swCache = null;
function renderIndex() {
  if (!indexCache) indexCache = fs.readFileSync(path.join(STATIC_DIR, 'index.html'), 'utf8').replace(/<base href="[^"]*"\s*\/?>/, `<base href="${BASE_PATH}" />`);
  return indexCache;
}
if (fs.existsSync(STATIC_DIR)) {
  site.get('/sw.js', (req, res) => {
    if (!swCache) swCache = fs.readFileSync(path.join(STATIC_DIR, 'sw.js'), 'utf8').replace(/__BMH_VERSION__/g, `${pkg.version}-${BUILD_ID}`);
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Service-Worker-Allowed', BASE_PATH);
    res.end(swCache);
  });
  site.get(['/', '/index.html'], (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.type('html').send(renderIndex()); });
  site.use(express.static(STATIC_DIR, {
    index: false,
    setHeaders: (res, file) => {
      if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  site.get('*', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.type('html').send(renderIndex()); });
}
app.use(BASE_PATH, site);

// ---------- background work: daily backup, weekly link check ----------
function startBackground() {
  backups.start(log);
  updatecheck.start(log);
  {
    // runs always; the admin setting (default from LINKCHECK_DISABLED) is checked on every run
    const run = () => {
      if (!settings.get().linkCheck || (jobs.links && jobs.links.running)) return;
      const dueIds = store.getBookmarks().filter((b) => linkcheck.due(b)).slice(0, 40).map((b) => b.id);
      if (dueIds.length) startJob('links', dueIds, checkBookmark, linkcheck.CONCURRENCY);
    };
    setTimeout(run, 2 * 60e3).unref();
    setInterval(run, 60 * 60e3).unref();
  }
}

if (require.main === module) {
  app.listen(PORT, () => log(`BookmarkHub ${pkg.version} listening on port ${PORT}${BASE_PATH !== '/' ? ` under ${BASE_PATH}` : ''}, data in ${store.DATA_DIR}, backups in ${backups.BACKUP_DIR}`));
  if (BACKGROUND) startBackground();
}
module.exports = app;

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
const pkg = require('./package.json');

const PORT = Number(process.env.PORT || 3131);
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(__dirname, '..', 'dist'));
const COOKIE_NAME = 'bmh_session';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
// "auto" = Secure flag when the request came in via HTTPS (reverse proxy sets X-Forwarded-Proto).
const COOKIE_SECURE = (process.env.COOKIE_SECURE || 'auto').toLowerCase();

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- startup: data folder, migration, reset trigger ----------
store.initIfEmpty(log);
for (const m of [store.migrateUsers(), store.migrateBookmarks()]) if (m) log(m);
applyResetTrigger(log);
const SECRET = store.getSessionSecret();

// ---------- helpers ----------
const publicUser = (u) => ({
  id: u.id, username: u.username, isAdmin: !!u.isAdmin,
  isFirstLogin: !!u.isFirstLogin, mustChangePassword: !!u.mustChangePassword,
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
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
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
  if ('favicon' in input) {
    const f = str(input.favicon, 2000);
    // Either an http(s) URL or a short fallback text (emoji/letter).
    out.favicon = validUrl(f) || (f.length <= 8 ? f : '');
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
  const isFirst = !!user.isFirstLogin;
  user.lastLoginAt = new Date().toISOString();
  store.saveUsers(users);
  setSessionCookie(req, res, user);
  res.json({ ...publicUser(user), isFirstLogin: isFirst });
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
  res.json({ success: true });
});

// ---- bookmarks ----
const visible = (b, user) => b.isShared || b.createdBy === user.id;
const canEdit = (b, user) => b.createdBy === user.id || user.isAdmin;

api.get('/bookmarks', requireAuth, (req, res) => {
  res.json(store.getBookmarks().filter((b) => visible(b, req.user)));
});
api.post('/bookmarks', requireAuth, (req, res, next) => {
  try {
    const data = cleanBookmarkInput((req.body && req.body.bookmark) || {}, false);
    const now = new Date().toISOString();
    const bm = { ...data, id: `bookmark-${crypto.randomUUID()}`, createdBy: req.user.id, createdAt: now, updatedAt: now };
    const list = store.getBookmarks();
    list.push(bm);
    store.saveBookmarks(list);
    res.status(201).json(bm);
  } catch (e) { next(e); }
});
api.put('/bookmarks/:id', requireAuth, (req, res, next) => {
  try {
    const list = store.getBookmarks();
    const b = list.find((x) => x.id === req.params.id);
    if (!b || !visible(b, req.user)) return res.status(404).json({ error: 'Bookmark not found' });
    if (!canEdit(b, req.user)) return res.status(403).json({ error: 'Not allowed' });
    Object.assign(b, cleanBookmarkInput((req.body && req.body.updates) || {}, true), { updatedAt: new Date().toISOString() });
    store.saveBookmarks(list);
    res.json(b);
  } catch (e) { next(e); }
});
api.delete('/bookmarks/:id', requireAuth, (req, res) => {
  const list = store.getBookmarks();
  const b = list.find((x) => x.id === req.params.id);
  if (!b || !visible(b, req.user)) return res.status(404).json({ error: 'Bookmark not found' });
  if (!canEdit(b, req.user)) return res.status(403).json({ error: 'Not allowed' });
  store.saveBookmarks(list.filter((x) => x.id !== b.id));
  res.json({ success: true });
});

// Favicons are fetched by the server and cached in the data folder, so the browser
// never contacts third-party sites just to show an icon (privacy).
api.get('/favicon/:id', requireAuth, async (req, res) => {
  const b = store.getBookmarks().find((x) => x.id === req.params.id);
  if (!b || !visible(b, req.user)) return res.status(404).end();
  const icon = await favicons.get(b, store.DATA_DIR);
  if (!icon) return res.status(404).end();
  res.setHeader('Content-Type', icon.type);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.end(icon.data);
});

// Export own + shared bookmarks as JSON (backup).
api.get('/export', requireAuth, (req, res) => {
  const list = store.getBookmarks().filter((b) => req.user.isAdmin || visible(b, req.user));
  res.setHeader('Content-Disposition', `attachment; filename="bookmarkhub-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exportedAt: new Date().toISOString(), version: pkg.version, bookmarks: list });
});

api.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
api.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  log('error:', err.message);
  res.status(500).json({ error: 'Internal error' });
});
app.use('/api', api);

// ---------- static frontend ----------
if (fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR, {
    index: false,
    setHeaders: (res, file) => {
      if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get('*', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(STATIC_DIR, 'index.html')); });
}

if (require.main === module) {
  app.listen(PORT, () => log(`BookmarkHub ${pkg.version} listening on port ${PORT}, data in ${store.DATA_DIR}`));
}
module.exports = app;

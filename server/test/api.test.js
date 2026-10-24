'use strict';
// Integration tests: v1 -> v2 migration, auth, CSRF, permissions, reset CLI and reset trigger file.
// Run: node --test server/test/
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const SERVER = path.join(__dirname, '..', 'server.js');
const CLI = path.join(__dirname, '..', 'reset-password.js');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmh-test-'));
const PORT = 31000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
let proc;

// Same structure as the data of BookmarkHub v1 (plaintext passwords).
const v1Users = [
  { id: 'admin-1', username: 'admin', password: 'old-admin-pass', isAdmin: true, isFirstLogin: false },
  { id: 'user-1', username: 'user', password: 'user', isAdmin: false, isFirstLogin: true },
  { id: 'user-1745780000000', username: 'anna', password: 'anna-secret-1', isAdmin: false, isFirstLogin: false },
];
const v1Bookmarks = [
  { id: '1', title: 'Google', url: 'https://www.google.com', description: 'Search', favicon: 'https://www.google.com/favicon.ico', tags: ['search'], isShared: true, createdBy: 'admin-1', createdAt: '2025-04-27T00:00:00.000Z', updatedAt: '2025-04-27T00:00:00.000Z' },
  { id: 'bookmark-1745780000001', title: 'Admin private', url: 'https://example.org', description: '', favicon: 'E', tags: [], isShared: false, createdBy: 'admin-1', createdAt: '2025-04-27T00:00:00.000Z', updatedAt: '2025-04-27T00:00:00.000Z' },
  { id: 'bookmark-1745780000002', title: 'Anna private', url: 'https://example.net', description: '', favicon: '', tags: [], isShared: false, createdBy: 'user-1745780000000', createdAt: '2025-04-27T00:00:00.000Z', updatedAt: '2025-04-27T00:00:00.000Z' },
];

function startServer() {
  return new Promise((resolve, reject) => {
    proc = spawn(process.execPath, [SERVER], { env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), STATIC_DIR: '/nonexistent' } });
    let out = '';
    proc.stdout.on('data', (d) => { out += d; if (out.includes('listening')) resolve(out); });
    proc.stderr.on('data', (d) => { out += d; });
    proc.on('exit', (c) => reject(new Error(`server exited ${c}: ${out}`)));
  });
}
function stopServer() { return new Promise((r) => { if (!proc) return r(); proc.removeAllListeners('exit'); proc.on('exit', r); proc.kill(); }); }

class Client {
  constructor() { this.cookie = ''; }
  async req(method, p, body, headers = {}) {
    const h = { ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (method !== 'GET' && !('X-Requested-With' in h)) h['X-Requested-With'] = 'bookmarkhub';
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const r = await fetch(BASE + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    let data = null; try { data = await r.json(); } catch { /* no body */ }
    return { status: r.status, data, headers: r.headers };
  }
  login(username, password) { return this.req('POST', '/api/login', { username, password }); }
}

before(async () => {
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify(v1Users));
  fs.writeFileSync(path.join(dataDir, 'bookmarks.json'), JSON.stringify(v1Bookmarks));
  await startServer();
});
after(async () => { await stopServer(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('migration hashes all passwords and keeps a backup', () => {
  const users = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'));
  assert.equal(users.length, 3);
  for (const u of users) {
    assert.equal(u.password, undefined);
    assert.match(u.passwordHash, /^scrypt\$/);
  }
  assert.equal(users.find((u) => u.username === 'user').mustChangePassword, true, 'default user/user must change password');
  assert.ok(fs.readdirSync(dataDir).some((f) => f.startsWith('users.json.backup-pre-v2')));
  const bms = JSON.parse(fs.readFileSync(path.join(dataDir, 'bookmarks.json'), 'utf8'));
  assert.equal(bms.length, 3);
});

test('unauthenticated access is refused', async () => {
  const c = new Client();
  for (const p of ['/api/users', '/api/bookmarks', '/api/me']) {
    const r = await c.req('GET', p);
    assert.ok([401, 403].includes(r.status), `${p} -> ${r.status}`);
  }
  assert.equal((await c.req('POST', '/api/updateUser', { userId: 'admin-1', updates: { password: 'x' } })).status, 404);
});

test('login with migrated password, cookie flags, no hash leaked', async () => {
  const c = new Client();
  const r = await c.login('admin', 'old-admin-pass');
  assert.equal(r.status, 200);
  assert.equal(r.data.passwordHash, undefined);
  const sc = r.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  assert.equal((await c.req('GET', '/api/me')).data.username, 'admin');
  assert.equal((await new Client().login('admin', 'wrong')).status, 401);
});

test('CSRF: state-changing request without custom header is rejected', async () => {
  const c = new Client();
  await c.login('admin', 'old-admin-pass');
  const r = await c.req('POST', '/api/bookmarks', { bookmark: { title: 'x', url: 'https://x.test' } }, { 'X-Requested-With': undefined });
  // undefined header value is sent as the string "undefined" -> must be rejected
  assert.equal(r.status, 403);
});

test('bookmark visibility and permissions', async () => {
  const anna = new Client();
  assert.equal((await anna.login('anna', 'anna-secret-1')).status, 200);
  const list = (await anna.req('GET', '/api/bookmarks')).data;
  const titles = list.map((b) => b.title).sort();
  assert.deepEqual(titles, ['Anna private', 'Google']);
  // cannot edit admin's shared bookmark, cannot see admin's private one
  assert.equal((await anna.req('PUT', '/api/bookmarks/1', { updates: { title: 'hacked' } })).status, 403);
  assert.equal((await anna.req('DELETE', '/api/bookmarks/bookmark-1745780000001')).status, 404);
  // non-admin cannot list users
  assert.equal((await anna.req('GET', '/api/users')).status, 403);
  // javascript: URLs are rejected (XSS)
  assert.equal((await anna.req('POST', '/api/bookmarks', { bookmark: { title: 'x', url: 'javascript:alert(1)' } })).status, 400);
  const created = await anna.req('POST', '/api/bookmarks', { bookmark: { title: 'New', url: 'https://new.example', tags: ['a'], createdBy: 'admin-1' } });
  assert.equal(created.status, 201);
  assert.equal(created.data.createdBy, 'user-1745780000000', 'createdBy cannot be spoofed');
});

test('admin user management guards', async () => {
  const admin = new Client();
  await admin.login('admin', 'old-admin-pass');
  const users = (await admin.req('GET', '/api/users')).data;
  assert.equal(users.length, 3);
  assert.ok(users.every((u) => u.passwordHash === undefined && u.password === undefined));
  assert.equal((await admin.req('DELETE', '/api/users/admin-1')).status, 400, 'cannot delete yourself');
  assert.equal((await admin.req('PUT', '/api/users/admin-1', { isAdmin: false })).status, 400, 'last admin');
  assert.equal((await admin.req('POST', '/api/users', { username: 'bob', password: 'short' })).status, 400);
  assert.equal((await admin.req('POST', '/api/users', { username: 'bob', password: 'long-enough-pw' })).status, 201);
  assert.equal((await new Client().login('bob', 'long-enough-pw')).status, 200);
});

test('change own password logs out other sessions', async () => {
  const a = new Client(); const b = new Client();
  await a.login('anna', 'anna-secret-1'); await b.login('anna', 'anna-secret-1');
  assert.equal((await a.req('POST', '/api/me/password', { currentPassword: 'wrong', newPassword: 'new-anna-pass-1' })).status, 400);
  assert.equal((await a.req('POST', '/api/me/password', { currentPassword: 'anna-secret-1', newPassword: 'new-anna-pass-1' })).status, 200);
  assert.equal((await a.req('GET', '/api/me')).status, 200, 'own session stays valid');
  assert.equal((await b.req('GET', '/api/me')).status, 401, 'other session is invalidated');
});

test('login rate limit after 5 failures', async () => {
  const c = new Client();
  for (let i = 0; i < 5; i++) assert.equal((await c.login('bob', 'nope')).status, 401);
  const r = await c.login('bob', 'long-enough-pw');
  assert.equal(r.status, 429);
});

test('reset CLI (non-interactive => random one-time password) works while server runs', async () => {
  const admin = new Client();
  await admin.login('admin', 'old-admin-pass');
  const out = execFileSync(process.execPath, [CLI, '--random'], { env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const pw = /One-time password: (\S+)/.exec(out)[1];
  assert.ok(pw.length >= 16);
  assert.equal((await admin.req('GET', '/api/me')).status, 401, 'old admin session invalidated');
  assert.equal((await new Client().login('admin', 'old-admin-pass')).status, 401);
  const c = new Client();
  const r = await c.login('admin', pw);
  assert.equal(r.status, 200);
  assert.equal(r.data.mustChangePassword, true);
  assert.equal((await c.req('POST', '/api/me/password', { currentPassword: pw, newPassword: 'brand-new-admin-pw' })).status, 200);
  assert.equal((await c.req('GET', '/api/me')).data.mustChangePassword, false);
});

test('reset CLI rejects unknown user', () => {
  assert.throws(() => execFileSync(process.execPath, [CLI, '--random', '--user', 'ghost'], { env: { ...process.env, DATA_DIR: dataDir }, stdio: 'pipe' }));
});

test('reset trigger file on startup', async () => {
  await stopServer();
  fs.writeFileSync(path.join(dataDir, 'RESET_ADMIN_PASSWORD'), 'admin\n');
  const out = await startServer();
  assert.ok(!fs.existsSync(path.join(dataDir, 'RESET_ADMIN_PASSWORD')), 'trigger file deleted');
  const pw = /New one-time password: (\S+)/.exec(out)[1];
  assert.equal((await new Client().login('admin', pw)).status, 200);
});

test('security headers and health endpoint', async () => {
  const r = await fetch(`${BASE}/healthz`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-powered-by'), null);
});

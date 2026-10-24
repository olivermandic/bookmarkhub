'use strict';
// BookmarkHub 2.2: share with chosen users, admin switches for external requests, opt-in update notice.
// No real network: the update check talks to a local fake "GitHub" server.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, '..', 'server.js');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmh22-'));
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmh22b-'));
const PORT = 33000 + Math.floor(Math.random() * 1000);
let proc; let gh; let ghHits = 0; let ghTag = 'v9.0.0'; let ghUrl = 'https://github.com/x/bookmarkhub/releases/tag/v9.0.0';

const users = [
  { id: 'admin-1', username: 'admin', password: 'admin-pass-123', isAdmin: true, isFirstLogin: false },
  { id: 'u-anna', username: 'anna', password: 'anna-pass-123', isAdmin: false, isFirstLogin: false },
  { id: 'u-bob', username: 'bob', password: 'bob-pass-1234', isAdmin: false, isFirstLogin: false },
  { id: 'u-carl', username: 'carl', password: 'carl-pass-123', isAdmin: false, isFirstLogin: false },
];
const bms = [
  { id: 'b-all', title: 'Everyone', url: 'https://all.example', tags: [], isShared: true, createdBy: 'admin-1', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
  { id: 'b-priv', title: 'Private', url: 'https://priv.example', tags: [], isShared: false, createdBy: 'admin-1', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
];

function startServer(env = {}) {
  return new Promise((resolve, reject) => {
    proc = spawn(process.execPath, [SERVER], { env: { ...process.env, DATA_DIR: dataDir, BACKUP_DIR: backupDir, PORT: String(PORT), STATIC_DIR: '/nonexistent', BACKGROUND_JOBS: 'false', UPDATE_API_URL: `http://127.0.0.1:${gh.address().port}/latest`, ...env } });
    let out = '';
    proc.stdout.on('data', (d) => { out += d; if (out.includes('listening')) resolve(out); });
    proc.stderr.on('data', (d) => { out += d; });
    proc.on('exit', (c) => reject(new Error(`server exited ${c}: ${out}`)));
  });
}
const stop = () => new Promise((r) => { if (!proc) return r(); proc.removeAllListeners('exit'); proc.on('exit', r); proc.kill(); });

class Client {
  constructor() { this.cookie = ''; }
  async req(method, p, body) {
    const h = {}; if (this.cookie) h.Cookie = this.cookie;
    if (method !== 'GET') h['X-Requested-With'] = 'bookmarkhub';
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const text = await r.text(); let data = text; try { data = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, data };
  }
  async login(u, p) { const r = await this.req('POST', '/api/login', { username: u, password: p }); assert.equal(r.status, 200, `login ${u}`); return this; }
}
const titles = async (c) => (await c.req('GET', '/api/bookmarks')).data.map((b) => b.title).sort();
let admin; let anna; let bob; let carl;

before(async () => {
  gh = http.createServer((req, res) => {
    ghHits++;
    assert.equal(req.headers.cookie, undefined); // nothing user-related is sent
    assert.equal(req.headers['user-agent'], 'BookmarkHub-update-check');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tag_name: ghTag, html_url: ghUrl }));
  });
  await new Promise((r) => gh.listen(0, '127.0.0.1', r));
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify(users));
  fs.writeFileSync(path.join(dataDir, 'bookmarks.json'), JSON.stringify(bms));
  await startServer();
  admin = await new Client().login('admin', 'admin-pass-123');
  anna = await new Client().login('anna', 'anna-pass-123');
  bob = await new Client().login('bob', 'bob-pass-1234');
  carl = await new Client().login('carl', 'carl-pass-123');
});
after(async () => { await stop(); gh.close(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(backupDir, { recursive: true, force: true }); });

test('existing visibility is unchanged after the update', async () => {
  assert.deepEqual(await titles(anna), ['Everyone']);
  assert.deepEqual(await titles(admin), ['Everyone', 'Private']);
  const all = (await admin.req('GET', '/api/bookmarks')).data;
  assert.ok(all.every((b) => !b.sharedWith || b.sharedWith.length === 0));
});

test('user directory lists names only', async () => {
  const r = await anna.req('GET', '/api/users/directory');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.map((u) => u.username).sort(), ['admin', 'anna', 'bob', 'carl']);
  assert.ok(r.data.every((u) => Object.keys(u).sort().join() === 'id,username'));
  assert.equal((await new Client().req('GET', '/api/users/directory')).status, 401);
});

test('share with chosen users: only they and the owner see it', async () => {
  const r = await anna.req('POST', '/api/bookmarks', { bookmark: { title: 'For Bob', url: 'https://bob.example', isShared: true, sharedWith: ['u-bob', 'u-anna', 'u-bob', 'nope'] } });
  assert.equal(r.status, 201);
  assert.deepEqual(r.data.sharedWith, ['u-bob'], 'owner + unknown + duplicates removed');
  assert.ok((await titles(anna)).includes('For Bob'));
  assert.ok((await titles(bob)).includes('For Bob'));
  assert.ok(!(await titles(carl)).includes('For Bob'));
  assert.ok(!(await titles(admin)).includes('For Bob'), 'admin is not on the list');
  assert.equal((await carl.req('PUT', `/api/bookmarks/${r.data.id}`, { updates: { title: 'x' } })).status, 404);
  assert.equal((await bob.req('PUT', `/api/bookmarks/${r.data.id}`, { updates: { title: 'x' } })).status, 403, 'shared users cannot edit');
  // owner adds carl
  const u = await anna.req('PUT', `/api/bookmarks/${r.data.id}`, { updates: { sharedWith: ['u-bob', 'u-carl'] } });
  assert.equal(u.status, 200);
  assert.ok((await titles(carl)).includes('For Bob'));
  // switching to private clears the list
  const p = await anna.req('PUT', `/api/bookmarks/${r.data.id}`, { updates: { isShared: false } });
  assert.deepEqual(p.data.sharedWith || [], []);
  assert.ok(!(await titles(bob)).includes('For Bob'));
  // only unknown users -> error, not "everyone"
  assert.equal((await anna.req('POST', '/api/bookmarks', { bookmark: { title: 'x', url: 'https://x.example', isShared: true, sharedWith: ['nope'] } })).status, 400);
});

test('admin can restrict a bookmark of another user; deleting a user cleans the lists', async () => {
  const r = await bob.req('POST', '/api/bookmarks', { bookmark: { title: 'Bob all', url: 'https://boball.example', isShared: true } });
  assert.ok((await titles(carl)).includes('Bob all'));
  const u = await admin.req('PUT', `/api/bookmarks/${r.data.id}`, { updates: { sharedWith: ['u-carl'] } });
  assert.equal(u.status, 200);
  assert.ok((await titles(carl)).includes('Bob all'));
  assert.ok(!(await titles(anna)).includes('Bob all'));
  assert.equal((await admin.req('DELETE', '/api/users/u-carl')).status, 200);
  const after = (await bob.req('GET', '/api/bookmarks')).data.find((b) => b.id === r.data.id);
  assert.equal(after.isShared, false, 'list became empty -> private, never everyone');
  assert.ok(!(await titles(anna)).includes('Bob all'));
});

test('export does not contain user ids of the share list', async () => {
  const r = await anna.req('POST', '/api/bookmarks', { bookmark: { title: 'Exp', url: 'https://exp.example', isShared: true, sharedWith: ['u-bob'] } });
  assert.equal(r.status, 201);
  const ex = await anna.req('GET', '/api/export');
  assert.equal(ex.status, 200);
  assert.ok(!JSON.stringify(ex.data).includes('u-bob'));
});

test('config + admin settings: defaults, permissions, gating with 409', async () => {
  const cfg = (await anna.req('GET', '/api/config')).data;
  assert.equal(cfg.fetchFavicons, true); assert.equal(cfg.linkCheck, true);
  assert.equal(cfg.updateCheck, undefined, 'non-admins do not see update settings');
  const s = (await admin.req('GET', '/api/admin/settings')).data;
  assert.deepEqual([s.fetchFavicons, s.linkCheck, s.updateCheck], [true, true, false]);
  assert.equal((await anna.req('PUT', '/api/admin/settings', { fetchFavicons: false })).status, 403);
  const off = (await admin.req('PUT', '/api/admin/settings', { fetchFavicons: false, linkCheck: false })).data;
  assert.deepEqual([off.fetchFavicons, off.linkCheck], [false, false]);
  assert.equal((await anna.req('GET', '/api/config')).data.fetchFavicons, false);
  const r1 = await admin.req('POST', '/api/bookmarks/b-all/favicon/refresh');
  assert.equal(r1.status, 409); assert.equal(r1.data.code, 'fetch_disabled');
  const r2 = await admin.req('POST', '/api/bookmarks/b-all/check');
  assert.equal(r2.status, 409); assert.equal(r2.data.code, 'linkcheck_disabled');
  assert.equal((await admin.req('POST', '/api/admin/favicons/refresh-all')).status, 409);
  assert.equal((await admin.req('POST', '/api/admin/links/check-all')).status, 409);
  assert.equal((await admin.req('GET', '/favicon/b-all')).status, 404, 'no fetch -> letter avatar');
  assert.equal(ghHits, 0, 'update check stays off by default');
  await admin.req('PUT', '/api/admin/settings', { fetchFavicons: true, linkCheck: true });
});

test('settings survive a restart and env only sets defaults', async () => {
  await admin.req('PUT', '/api/admin/settings', { linkCheck: false });
  await stop(); await startServer({ LINKCHECK_DISABLED: 'false', FAVICON_FETCH: 'false' });
  admin = await new Client().login('admin', 'admin-pass-123');
  const s = (await admin.req('GET', '/api/admin/settings')).data;
  assert.equal(s.linkCheck, false, 'saved value wins');
  assert.equal(s.fetchFavicons, true, 'saved value wins over env');
  await admin.req('PUT', '/api/admin/settings', { linkCheck: true });
});

test('update notice: opt-in, max once a day, admins only', async () => {
  const s = (await admin.req('PUT', '/api/admin/settings', { updateCheck: true })).data;
  assert.equal(ghHits, 1);
  assert.equal(s.updateState.latest, '9.0.0');
  const cfg = (await admin.req('GET', '/api/config')).data;
  assert.equal(cfg.update.latest, '9.0.0'); assert.equal(cfg.update.url, ghUrl);
  anna = await new Client().login('anna', 'anna-pass-123');
  assert.equal((await anna.req('GET', '/api/config')).data.update, undefined);
  // toggling off/on within 24 h does not ask again
  await admin.req('PUT', '/api/admin/settings', { updateCheck: false });
  assert.equal((await admin.req('GET', '/api/config')).data.update, null);
  await admin.req('PUT', '/api/admin/settings', { updateCheck: true });
  assert.equal(ghHits, 1);
});

test('updatecheck module: versions, bad URLs, errors', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bmh22u-'));
  delete require.cache[require.resolve('../store')]; delete require.cache[require.resolve('../settings')]; delete require.cache[require.resolve('../updatecheck')];
  const settings = require('../settings'); const uc = require('../updatecheck');
  assert.equal(uc.cmp('2.10.0', '2.9.9'), 1); assert.equal(uc.cmp('v2.2.0', '2.2.0'), 0); assert.equal(uc.cmp('2.1.1', '2.2.0'), -1);
  let calls = 0;
  const fake = (body, ok = true) => async () => { calls++; return { ok, status: ok ? 200 : 500, json: async () => body }; };
  assert.equal(await uc.check({ fetchImpl: fake({}) }), null, 'off -> no request'); assert.equal(calls, 0);
  settings.set({ updateCheck: true });
  const st = await uc.check({ fetchImpl: fake({ tag_name: 'v3.0.0', html_url: 'javascript:alert(1)' }) });
  assert.equal(st.latest, '3.0.0'); assert.match(st.url, /^https:\/\/github\.com\/.+\/releases$/);
  assert.equal(uc.notice('2.2.0').latest, '3.0.0'); assert.equal(uc.notice('3.0.0'), null);
  await uc.check({ fetchImpl: fake({ tag_name: 'v4.0.0' }) }); assert.equal(calls, 1, 'cached for 24 h');
  const e = await uc.check({ force: true, fetchImpl: fake({}, false) });
  assert.equal(e.error, 'HTTP 500'); assert.equal(e.latest, '3.0.0', 'keeps last known version');
  const later = await uc.check({ now: Date.now() + 25 * 3600e3, fetchImpl: fake({ tag_name: 'v4.0.0', html_url: 'https://github.com/a/b/releases/tag/v4.0.0' }) });
  assert.equal(later.latest, '4.0.0');
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

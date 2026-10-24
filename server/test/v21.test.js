'use strict';
// BookmarkHub 2.1 features: schema-v3 migration, favicons (local fixture site), TOTP 2FA,
// categories, prefs, import/dedupe, link check, backups + rotation, base path, CLI 2FA reset.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { spawn, execFileSync } = require('child_process');
const totp = require('../totp');
const fav = require('../favicons');
const backupMod = require('../backup');

const SERVER = path.join(__dirname, '..', 'server.js');
const CLI = path.join(__dirname, '..', 'reset-password.js');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmh21-'));
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmh21b-'));
const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmh21s-'));
const PORT = 32000 + Math.floor(Math.random() * 1000);
let FIX; let fixture; let proc;

// 1x1 transparent PNG is rejected (too small), so build a 64x64 PNG header + padding.
const png = (size) => { const b = Buffer.alloc(200); Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(b); b.writeUInt32BE(size, 16); b.writeUInt32BE(size, 20); return b; };
function ico(withPng) {
  const inner = withPng ? png(48) : Buffer.alloc(300, 1);
  const h = Buffer.alloc(22); h.writeUInt16LE(0, 0); h.writeUInt16LE(1, 2); h.writeUInt16LE(1, 4);
  h[6] = 48; h[7] = 48; h.writeUInt32LE(inner.length, 14); h.writeUInt32LE(22, 18);
  return Buffer.concat([h, inner]);
}
const evilSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><rect width="10" height="10" fill="red"/></a><foreignObject><div>x</div></foreignObject></svg>';

function startFixture() {
  return new Promise((resolve) => {
    fixture = http.createServer((req, res) => {
      const send = (code, type, body, extra = {}) => { res.writeHead(code, { 'Content-Type': type, ...extra }); res.end(body); };
      const u = req.url;
      if (u === '/rich/') return send(200, 'text/html', `<html><head><link rel="icon" href="/i/16.png" sizes="16x16"><link rel="apple-touch-icon" href="//127.0.0.1:${FIX}/i/180.png"><link rel="manifest" href="manifest.json"><link rel="mask-icon" href="/i/mask.svg"></head></html>`);
      if (u === '/rich/manifest.json') return send(200, 'application/json', JSON.stringify({ icons: [{ src: '/i/192.png', sizes: '192x192', type: 'image/png' }] }));
      if (u === '/i/16.png') return send(200, 'image/png', png(16));
      if (u === '/i/180.png') return send(200, 'image/png', png(180));
      if (u === '/i/192.png') return send(200, 'application/octet-stream', png(192)); // wrong type, sniffed
      if (u === '/plain/') return send(200, 'text/html', '<html><head><title>x</title></head></html>');
      if (u === '/favicon.ico') return send(200, 'image/x-icon', ico(true));
      if (u === '/redir') return send(302, 'text/plain', '', { Location: '/rich/' });
      if (u === '/svg/') return send(200, 'text/html', '<link rel="icon" type="image/svg+xml" href="/i/evil.svg">');
      if (u === '/i/evil.svg') return send(200, 'image/svg+xml', evilSvg);
      if (u === '/data/') return send(200, 'text/html', `<link rel="icon" href="data:image/png;base64,${png(64).toString('base64')}">`);
      if (u === '/gone') return send(404, 'text/html', 'nope');
      if (u === '/headless') { if (req.method === 'HEAD') return send(405, 'text/plain', ''); return send(200, 'text/html', 'ok'); }
      return send(404, 'text/html', '<html>login page</html>');
    }).listen(0, '127.0.0.1', () => { FIX = fixture.address().port; resolve(); });
  });
}

function startServer(env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SERVER], { env: { ...process.env, DATA_DIR: dataDir, BACKUP_DIR: backupDir, PORT: String(PORT), STATIC_DIR: staticDir, BACKGROUND_JOBS: 'false', ...env } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; if (out.includes('listening')) resolve({ p, out }); });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (c) => reject(new Error(`server exited ${c}: ${out}`)));
    proc = p;
  });
}
const stop = () => new Promise((r) => { if (!proc) return r(); proc.removeAllListeners('exit'); proc.on('exit', r); proc.kill(); });

class Client {
  constructor(base) { this.cookie = ''; this.base = base || `http://127.0.0.1:${PORT}`; }
  async req(method, p, body) {
    const h = {};
    if (this.cookie) h.Cookie = this.cookie;
    if (method !== 'GET') h['X-Requested-With'] = 'bookmarkhub';
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const r = await fetch(this.base + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const text = await r.text(); let data = text; try { data = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, data, headers: r.headers };
  }
}

const v2Users = () => {
  const { hashPassword } = require('../password');
  return [
    { id: 'admin-1', username: 'oliver@example.org', passwordHash: hashPassword('admin-pass-123'), isAdmin: true, isFirstLogin: false, sessionVersion: 1 },
    { id: 'user-2', username: 'paul', passwordHash: hashPassword('paul-pass-123'), isAdmin: false, isFirstLogin: false, sessionVersion: 1 },
  ];
};

let admin; let paul;
before(async () => {
  await startFixture();
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><html><head><base href="/" /></head><body>app</body></html>');
  fs.writeFileSync(path.join(staticDir, 'sw.js'), "const V='__BMH_VERSION__';");
  // data as written by BookmarkHub 2.0.x (schema 2, no meta.json)
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify(v2Users()));
  fs.writeFileSync(path.join(dataDir, 'bookmarks.json'), JSON.stringify([
    { id: 'b1', title: 'Rich', url: `http://127.0.0.1:${FIX}/rich/`, tags: [], isShared: true, createdBy: 'admin-1', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
    { id: 'b2', title: 'Paul private', url: `http://127.0.0.1:${FIX}/plain/`, tags: [], isShared: false, createdBy: 'user-2', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
  ]));
  const { out } = await startServer();
  assert.match(out, /schema v3/);
  admin = new Client(); paul = new Client();
  assert.strictEqual((await admin.req('POST', '/api/login', { username: 'oliver@example.org', password: 'admin-pass-123' })).status, 200);
  assert.strictEqual((await paul.req('POST', '/api/login', { username: 'paul', password: 'paul-pass-123' })).status, 200);
});
after(async () => { await stop(); fixture.close(); });

test('2.0 -> 2.1 migration keeps data and writes backups', () => {
  const files = fs.readdirSync(dataDir);
  assert.ok(files.some((f) => f.startsWith('users.json.backup-pre-v2.1-')));
  assert.ok(files.some((f) => f.startsWith('bookmarks.json.backup-pre-v2.1-')));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'))).schema, 3);
  const bms = JSON.parse(fs.readFileSync(path.join(dataDir, 'bookmarks.json')));
  assert.strictEqual(bms.length, 2);
  assert.ok(bms.every((b) => 'categoryId' in b));
});

test('favicon discovery picks the best icon and sniffs types', async () => {
  const r = await fav.discover(`http://127.0.0.1:${FIX}/rich/`);
  assert.ok(r.icon); assert.strictEqual(r.icon.type, 'image/png');
  assert.match(r.icon.source, /192\.png$/); // manifest 192 beats apple 180 and 16
  const plain = await fav.discover(`http://127.0.0.1:${FIX}/plain/`);
  assert.strictEqual(plain.icon.type, 'image/png'); // ICO with embedded PNG -> PNG extracted
  assert.match(plain.icon.source, /favicon\.ico$/);
  const redir = await fav.discover(`http://127.0.0.1:${FIX}/redir`);
  assert.match(redir.icon.source, /192\.png$/);
  const data = await fav.discover(`http://127.0.0.1:${FIX}/data/`);
  assert.match(data.icon.source, /^data:image\/png/);
});

test('SVG icons are sanitised', async () => {
  const r = await fav.discover(`http://127.0.0.1:${FIX}/svg/`);
  assert.strictEqual(r.icon.type, 'image/svg+xml');
  const s = r.icon.data.toString();
  assert.ok(!/script|onload|javascript:|foreignObject/i.test(s), s);
  assert.match(s, /<rect/);
});

test('HTML responses (login pages) are never accepted as icons; helpers', () => {
  assert.strictEqual(fav.sniff(Buffer.from('<html><body>login</body></html>')), null);
  assert.strictEqual(fav.parentDomain('mail.example.com'), 'example.com');
  assert.strictEqual(fav.parentDomain('example.com'), null);
  assert.strictEqual(fav.parentDomain('www.bbc.co.uk'), 'bbc.co.uk');
  assert.strictEqual(fav.parentDomain('bbc.co.uk'), null);
  const p = fav.parseIcons('<base href="https://cdn.example/x/"><link rel="shortcut icon" href="f.ico"><link rel=icon href=/a.png sizes=96x96>', 'https://example.com/');
  assert.deepStrictEqual(p.icons.map((i) => i.url), ['https://cdn.example/x/f.ico', 'https://cdn.example/a.png']);
});

test('favicon endpoint, ETag, per-bookmark refresh, upload, visibility', async () => {
  const r = await admin.req('GET', '/api/favicon/b1');
  assert.strictEqual(r.status, 200);
  const etag = r.headers.get('etag'); assert.ok(etag);
  const r304 = await fetch(`http://127.0.0.1:${PORT}/api/favicon/b1`, { headers: { Cookie: admin.cookie, 'If-None-Match': etag } });
  assert.strictEqual(r304.status, 304);
  assert.strictEqual((await admin.req('GET', '/api/favicon/b2')).status, 404); // Paul's private bookmark
  const rf = await admin.req('POST', '/api/bookmarks/b1/favicon/refresh');
  assert.strictEqual(rf.data.status, 'found');
  const up = await admin.req('POST', '/api/bookmarks/b1/favicon', { data: png(96).toString('base64') });
  assert.strictEqual(up.data.status, 'custom');
  const bad = await admin.req('POST', '/api/bookmarks/b1/favicon', { data: Buffer.from('<html>').toString('base64') });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual((await paul.req('POST', '/api/bookmarks/b1/favicon', { data: png(96).toString('base64') })).status, 403);
  const del = await admin.req('DELETE', '/api/bookmarks/b1/favicon');
  assert.strictEqual(del.data.status, 'found');
  const list = (await admin.req('GET', '/api/bookmarks')).data;
  assert.strictEqual(list.find((b) => b.id === 'b1').iconStatus, 'found');
});

test('refresh-all job reports progress and results', async () => {
  const j = await admin.req('POST', '/api/admin/favicons/refresh-all');
  assert.strictEqual(j.status, 202);
  assert.strictEqual((await paul.req('POST', '/api/admin/favicons/refresh-all')).status, 403);
  let jobs;
  for (let i = 0; i < 50; i++) { jobs = (await admin.req('GET', '/api/jobs')).data; if (!jobs.favicons.running) break; await new Promise((r) => setTimeout(r, 100)); }
  assert.strictEqual(jobs.favicons.done, 2);
  assert.strictEqual(jobs.favicons.results.found, 2);
});

test('TOTP: RFC 6238 vectors', () => {
  const s = totp.base32Encode(Buffer.from('12345678901234567890'));
  assert.strictEqual(totp.hotp(s, Math.floor(59 / 30)), '287082');
  assert.strictEqual(totp.hotp(s, Math.floor(1111111109 / 30)), '081804');
  assert.strictEqual(totp.hotp(s, Math.floor(2000000000 / 30)), '279037');
});

test('2FA: setup, login with code, replay blocked, recovery code, disable via CLI', async () => {
  assert.strictEqual((await paul.req('POST', '/api/me/2fa/setup', { password: 'wrong' })).status, 400);
  const setup = await paul.req('POST', '/api/me/2fa/setup', { password: 'paul-pass-123' });
  assert.strictEqual(setup.status, 200);
  assert.match(setup.data.qrSvg, /^<svg/); assert.match(setup.data.otpauthUrl, /^otpauth:\/\/totp\//);
  assert.strictEqual((await paul.req('POST', '/api/me/2fa/enable', { code: '000000' })).status, 400);
  const en = await paul.req('POST', '/api/me/2fa/enable', { code: totp.totp(setup.data.secret) });
  assert.strictEqual(en.status, 200); assert.strictEqual(en.data.recoveryCodes.length, 10); assert.strictEqual(en.data.twoFactorEnabled, true);
  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'))).find((u) => u.username === 'paul');
  assert.ok(!JSON.stringify(stored).includes(en.data.recoveryCodes[0])); // only hashes stored

  const c = new Client();
  const step1 = await c.req('POST', '/api/login', { username: 'paul', password: 'paul-pass-123' });
  assert.strictEqual(step1.data.twoFactorRequired, true); assert.ok(!c.cookie);
  assert.strictEqual((await c.req('GET', '/api/me')).status, 401);
  assert.strictEqual((await c.req('POST', '/api/login/2fa', { ticket: step1.data.ticket, code: '123456' })).status, 401);
  // the code used for enabling was consumed (replay protection) -> wait for next window is too slow;
  // use a recovery code instead, then verify it cannot be reused
  const ok = await c.req('POST', '/api/login/2fa', { ticket: step1.data.ticket, code: en.data.recoveryCodes[0] });
  assert.strictEqual(ok.status, 200); assert.ok(c.cookie);
  const c2 = new Client();
  const s2 = await c2.req('POST', '/api/login', { username: 'paul', password: 'paul-pass-123' });
  assert.strictEqual((await c2.req('POST', '/api/login/2fa', { ticket: s2.data.ticket, code: en.data.recoveryCodes[0] })).status, 401);
  assert.strictEqual((await c2.req('POST', '/api/login/2fa', { ticket: 'forged.ticket', code: '123456' })).status, 401);

  const out = execFileSync(process.execPath, [CLI, '--user', 'paul', '--disable-2fa', '--keep-password'], { env: { ...process.env, DATA_DIR: dataDir }, input: '' }).toString();
  assert.match(out, /two-factor login switched off/);
  const c3 = new Client();
  const s3 = await c3.req('POST', '/api/login', { username: 'paul', password: 'paul-pass-123' });
  assert.strictEqual(s3.status, 200); assert.ok(!s3.data.twoFactorRequired);
  paul = c3;
});

test('categories: create, rename (permissions), delete keeps bookmarks', async () => {
  const c = await paul.req('POST', '/api/categories', { name: 'Kinder' });
  assert.strictEqual(c.status, 201);
  const dup = await admin.req('POST', '/api/categories', { name: 'kinder' });
  assert.strictEqual(dup.data.id, c.data.id);
  const b = await paul.req('POST', '/api/bookmarks', { bookmark: { title: 'Kika', url: 'https://www.kika.de', categoryId: c.data.id } });
  assert.strictEqual(b.data.categoryId, c.data.id);
  assert.strictEqual((await paul.req('POST', '/api/bookmarks', { bookmark: { title: 'X', url: 'https://x.y', categoryId: 'nope' } })).status, 400);
  const other = await admin.req('POST', '/api/categories', { name: 'Admin-Kram' });
  assert.strictEqual((await paul.req('PUT', `/api/categories/${other.data.id}`, { name: 'hack' })).status, 403);
  assert.strictEqual((await admin.req('PUT', `/api/categories/${c.data.id}`, { name: 'Kids' })).data.name, 'Kids');
  assert.strictEqual((await paul.req('DELETE', `/api/categories/${c.data.id}`)).status, 200);
  const after = (await paul.req('GET', '/api/bookmarks')).data.find((x) => x.id === b.data.id);
  assert.strictEqual(after.categoryId, null);
});

test('prefs: order, view, language are validated and stored per user', async () => {
  const r = await paul.req('PUT', '/api/me/prefs', { view: 'list', theme: 'dark', language: 'hr', categoryOrder: ['a', 'b'], bookmarkOrder: { none: ['b1'] }, evil: 'x' });
  assert.deepStrictEqual(r.data.prefs, { view: 'list', theme: 'dark', language: 'hr', categoryOrder: ['a', 'b'], bookmarkOrder: { none: ['b1'] } });
  const bad = await paul.req('PUT', '/api/me/prefs', { view: '<script>', language: '../../etc' });
  assert.strictEqual(bad.data.prefs.view, 'list'); assert.strictEqual(bad.data.prefs.language, 'hr');
});

test('import: dedupe by URL, categories from folders, invalid URLs skipped', async () => {
  const r = await admin.req('POST', '/api/import', { isShared: false, items: [
    { title: 'Rich again', url: `http://127.0.0.1:${FIX}/rich` }, // duplicate of b1 (slash/scheme insensitive)
    { title: 'Heise', url: 'https://www.heise.de/', category: 'News' },
    { title: 'Heise 2', url: 'https://heise.de' }, // duplicate inside the file
    { title: 'Bad', url: 'javascript:alert(1)' },
    { title: 'Spiegel', url: 'https://www.spiegel.de', category: 'News', addDate: '2020-01-01T00:00:00Z' },
  ] });
  assert.deepStrictEqual(r.data, { created: 2, skipped: 2, invalid: 1, categoriesCreated: 1 });
  const cats = (await admin.req('GET', '/api/categories')).data;
  const news = cats.find((c) => c.name === 'News');
  const list = (await admin.req('GET', '/api/bookmarks')).data;
  assert.strictEqual(list.filter((b) => b.categoryId === news.id).length, 2);
  assert.ok(fs.readdirSync(dataDir).some((f) => f.startsWith('bookmarks.json.backup-pre-import-')));
  const exp = await admin.req('GET', '/api/export');
  assert.ok(exp.data.bookmarks.some((b) => b.category === 'News'));
});

test('link check: 404 is broken at once, HEAD-405 falls back to GET', async () => {
  const b = await admin.req('POST', '/api/bookmarks', { bookmark: { title: 'Gone', url: `http://127.0.0.1:${FIX}/gone` } });
  const r = await admin.req('POST', `/api/bookmarks/${b.data.id}/check`);
  assert.strictEqual(r.data.state, 'broken'); assert.strictEqual(r.data.code, 404);
  const h = await admin.req('POST', '/api/bookmarks', { bookmark: { title: 'Headless', url: `http://127.0.0.1:${FIX}/headless` } });
  assert.strictEqual((await admin.req('POST', `/api/bookmarks/${h.data.id}/check`)).data.state, 'ok');
  const list = (await admin.req('GET', '/api/bookmarks')).data;
  assert.strictEqual(list.find((x) => x.id === b.data.id).linkStatus.state, 'broken');
});

test('backups: manual backup, list, download (admin only), rotation rule', async () => {
  const r = await admin.req('POST', '/api/admin/backups');
  assert.strictEqual(r.status, 201);
  assert.strictEqual((await paul.req('GET', '/api/admin/backups')).status, 403);
  const dl = await fetch(`http://127.0.0.1:${PORT}/api/admin/backups/${r.data.name}`, { headers: { Cookie: admin.cookie } });
  const snap = JSON.parse(zlib.gunzipSync(Buffer.from(await dl.arrayBuffer())));
  assert.strictEqual(snap.app, 'BookmarkHub'); assert.ok(snap.bookmarks.length >= 4);
  assert.strictEqual((await admin.req('GET', '/api/admin/backups/..%2Fusers.json')).status, 404);
  // rotation: 120 daily files -> 14 newest + 8 weekly
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmhrot-'));
  const out = execFileSync(process.execPath, ['-e', `
    const fs=require('fs');const p=require('path');
    for(let i=0;i<120;i++){const d=new Date(Date.UTC(2026,0,1)+i*864e5).toISOString().slice(0,10);fs.writeFileSync(p.join('${dir}','bookmarkhub-'+d+'.json.gz'),'x');}
    const b=require('${path.join(__dirname, '..', 'backup.js')}');b.rotate();console.log(fs.readdirSync('${dir}').length);`], { env: { ...process.env, BACKUP_DIR: dir, DATA_DIR: dataDir } }).toString().trim();
  assert.strictEqual(out, '22');
  assert.ok(backupMod.isoWeek('2026-01-05').endsWith('W2'));
});

test('base path: index gets <base href>, sw.js gets version, API under prefix', async () => {
  await stop();
  await startServer({ BASE_PATH: '/bm' });
  const base = `http://127.0.0.1:${PORT}`;
  const idx = await (await fetch(`${base}/bm/some/route`)).text();
  assert.match(idx, /<base href="\/bm\/" \/>/);
  const sw = await (await fetch(`${base}/bm/sw.js`)).text();
  assert.match(sw, new RegExp("const V='" + require('../package.json').version.replace(/\./g, '\\.') + '-'));
  assert.strictEqual((await fetch(`${base}/bm/api/me`)).status, 401);
  await stop();
  await startServer();
});

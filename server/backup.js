'use strict';
// Built-in automatic backups: one gzip'ed JSON snapshot per day in BACKUP_DIR (default /app/backups).
// Rotation keeps the newest 14 daily snapshots plus one per ISO week for 8 more weeks.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const store = require('./store');

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(store.DATA_DIR, '..', 'backups'));
const KEEP_DAILY = Number(process.env.BACKUP_KEEP_DAILY || 14);
const KEEP_WEEKLY = Number(process.env.BACKUP_KEEP_WEEKLY || 8);
const NAME_RE = /^bookmarkhub-(\d{4}-\d{2}-\d{2})(?:-(\d{6}))?(-manual)?\.json\.gz$/;

function snapshot() {
  return {
    app: 'BookmarkHub', version: require('./package.json').version, schema: store.SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    users: store.getUsers(), bookmarks: store.getBookmarks(), categories: store.getCategories(), meta: store.getMeta(),
  };
}

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return { day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` };
}

function list() {
  let files = [];
  try { files = fs.readdirSync(BACKUP_DIR); } catch { return []; }
  return files.map((f) => {
    const m = f.match(NAME_RE); if (!m) return null;
    const st = fs.statSync(path.join(BACKUP_DIR, f));
    return { name: f, day: m[1], manual: !!m[3], size: st.size, createdAt: st.mtime.toISOString() };
  }).filter(Boolean).sort((a, b) => (a.name < b.name ? 1 : -1));
}

function write(manual = false) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const { day, time } = localDate();
  const name = manual ? `bookmarkhub-${day}-${time}-manual.json.gz` : `bookmarkhub-${day}.json.gz`;
  const file = path.join(BACKUP_DIR, name);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(snapshot())), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return name;
}

function isoWeek(dayStr) {
  const d = new Date(`${dayStr}T12:00:00Z`);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${Math.ceil(((t - y) / 864e5 + 1) / 7)}`;
}

/** Decide which automatic backups to keep. Manual backups: newest 10 are kept. */
function rotate() {
  const all = list();
  const autos = all.filter((b) => !b.manual);
  const keep = new Set(autos.slice(0, KEEP_DAILY).map((b) => b.name));
  const weeks = new Set();
  for (const b of autos.slice(KEEP_DAILY)) {
    const w = isoWeek(b.day);
    if (weeks.size < KEEP_WEEKLY && !weeks.has(w)) { weeks.add(w); keep.add(b.name); }
  }
  // also never count weeks already represented in the daily set twice
  all.filter((b) => b.manual).slice(0, 10).forEach((b) => keep.add(b.name));
  const removed = [];
  for (const b of all) if (!keep.has(b.name)) { try { fs.unlinkSync(path.join(BACKUP_DIR, b.name)); removed.push(b.name); } catch { /* ignore */ } }
  return removed;
}

/** Daily: create today's backup if missing, then rotate. */
function daily(log) {
  try {
    const { day } = localDate();
    if (!list().some((b) => !b.manual && b.day === day)) {
      const n = write(false);
      const removed = rotate();
      if (log) log(`backup written: ${n}${removed.length ? `, rotated out: ${removed.length}` : ''}`);
    }
  } catch (e) { if (log) log(`backup failed: ${e.message}`); }
}

function start(log) {
  if (process.env.BACKUP_DISABLED === 'true') return null;
  daily(log);
  const t = setInterval(() => daily(log), 60 * 60e3); // check hourly, writes once per day
  t.unref();
  return t;
}

const filePath = (name) => (NAME_RE.test(name) ? path.join(BACKUP_DIR, name) : null);

module.exports = { BACKUP_DIR, list, write, rotate, daily, start, filePath, isoWeek, snapshot };

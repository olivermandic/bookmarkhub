'use strict';
// Data storage: plain JSON files in DATA_DIR (default /app/data).
// Writes are atomic (temp file + rename) so a crash never leaves half a file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword, isHashed } = require('./password');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BOOKMARKS_FILE = path.join(DATA_DIR, 'bookmarks.json');
const SESSION_SECRET_FILE = path.join(DATA_DIR, '.session-secret');
const SCHEMA_VERSION = 2;

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`Cannot read ${path.basename(file)}: ${e.message}`);
  }
}

function writeJson(file, data, mode = 0o600) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
  fs.renameSync(tmp, file);
}

const getUsers = () => readJson(USERS_FILE, []);
const saveUsers = (users) => writeJson(USERS_FILE, users);
const getBookmarks = () => readJson(BOOKMARKS_FILE, []);
const saveBookmarks = (b) => writeJson(BOOKMARKS_FILE, b);

function backup(file, tag) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${file}.backup-${tag}-${stamp}`;
  fs.copyFileSync(file, target);
  fs.chmodSync(target, 0o600);
  return target;
}

// Migrates users.json from v1 (plaintext "password") to v2 ("passwordHash" + "sessionVersion").
// Returns a short log message or null if nothing changed.
function migrateUsers() {
  const users = getUsers();
  if (!Array.isArray(users)) throw new Error('users.json is not an array');
  const needs = users.some((u) => typeof u.password === 'string' || !isHashed(u.passwordHash) || typeof u.sessionVersion !== 'number');
  if (!needs) return null;
  const bak = backup(USERS_FILE, 'pre-v2');
  let converted = 0;
  const migrated = users.map((u) => {
    const out = { ...u };
    if (typeof out.password === 'string') {
      out.passwordHash = hashPassword(out.password);
      // Old default credentials must be changed after login.
      if ((out.username === 'admin' && out.password === 'admin') || (out.username === 'user' && out.password === 'user')) {
        out.mustChangePassword = true;
      }
      delete out.password;
      converted++;
    }
    if (typeof out.sessionVersion !== 'number') out.sessionVersion = 1;
    if (!out.createdAt) out.createdAt = new Date().toISOString();
    return out;
  });
  saveUsers(migrated);
  return `users.json migrated to schema v${SCHEMA_VERSION} (${converted} password(s) hashed${bak ? `, backup: ${path.basename(bak)}` : ''})`;
}

// Removes fields that must never be stored on bookmarks and fixes obviously broken records.
function migrateBookmarks() {
  const list = getBookmarks();
  if (!Array.isArray(list)) throw new Error('bookmarks.json is not an array');
  let changed = false;
  const fixed = list.map((b) => {
    const out = { ...b };
    if ('icon' in out && typeof out.icon === 'object') { delete out.icon; changed = true; }
    if (!Array.isArray(out.tags)) { out.tags = []; changed = true; }
    if (typeof out.isShared !== 'boolean') { out.isShared = !!out.isShared; changed = true; }
    return out;
  });
  if (changed) {
    backup(BOOKMARKS_FILE, 'pre-v2');
    saveBookmarks(fixed);
    return 'bookmarks.json normalised';
  }
  return null;
}

function randomPassword(len = 20) {
  // Unambiguous characters only (no 0/O, 1/l/I).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

// First start with an empty data folder: create one admin with a random password (printed once to the log).
function initIfEmpty(log) {
  ensureDir();
  const users = getUsers();
  if (users.length === 0) {
    const pw = randomPassword();
    saveUsers([{
      id: 'admin-1', username: 'admin', passwordHash: hashPassword(pw), isAdmin: true,
      isFirstLogin: true, mustChangePassword: true, sessionVersion: 1, createdAt: new Date().toISOString(),
    }]);
    log('================================================================');
    log(' First start: user "admin" created.');
    log(` Initial password: ${pw}`);
    log(' Please change it after the first login.');
    log('================================================================');
  }
  if (!fs.existsSync(BOOKMARKS_FILE)) saveBookmarks([]);
}

function getSessionSecret() {
  ensureDir();
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) return process.env.SESSION_SECRET;
  if (fs.existsSync(SESSION_SECRET_FILE)) {
    const s = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
    if (s.length >= 32) return s;
  }
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SESSION_SECRET_FILE, s, { mode: 0o600 });
  return s;
}

module.exports = {
  DATA_DIR, USERS_FILE, BOOKMARKS_FILE, SCHEMA_VERSION,
  ensureDir, getUsers, saveUsers, getBookmarks, saveBookmarks,
  migrateUsers, migrateBookmarks, initIfEmpty, getSessionSecret, randomPassword, backup,
};

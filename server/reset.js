'use strict';
// Shared logic for resetting a password (CLI and trigger file).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const { hashPassword } = require('./password');

const TRIGGER_FILE = path.join(store.DATA_DIR, 'RESET_ADMIN_PASSWORD');

// Sets a new password for `username` (or the only/first admin). Creates an admin if none exists.
function resetPassword({ username, password, mustChange }) {
  store.ensureDir();
  store.migrateUsers();
  const users = store.getUsers();
  let user;
  if (username) user = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  else user = users.find((u) => u.isAdmin);
  let created = false;
  if (!user) {
    if (username && users.some((u) => u.isAdmin)) throw new Error(`User "${username}" not found`);
    user = { id: `admin-${crypto.randomUUID()}`, username: username || 'admin', isAdmin: true, isFirstLogin: false, sessionVersion: 1, createdAt: new Date().toISOString() };
    users.push(user);
    created = true;
  }
  store.backup(store.USERS_FILE, 'pre-reset');
  user.passwordHash = hashPassword(password);
  user.isAdmin = user.isAdmin || created;
  user.mustChangePassword = !!mustChange;
  user.sessionVersion = (user.sessionVersion || 1) + 1; // invalidates existing logins of this user
  store.saveUsers(users);
  return { username: user.username, created, isAdmin: !!user.isAdmin };
}

// If the file data/RESET_ADMIN_PASSWORD exists at startup, reset that admin's password to a
// random one, print it once to the container log and delete the file.
// Optional file content: the username to reset (default: first admin).
function applyResetTrigger(log) {
  if (!fs.existsSync(TRIGGER_FILE)) return;
  let username = '';
  try { username = fs.readFileSync(TRIGGER_FILE, 'utf8').trim().split(/\s+/)[0] || ''; } catch { /* ignore */ }
  try {
    const pw = store.randomPassword();
    const r = resetPassword({ username: username || undefined, password: pw, mustChange: true });
    log('================================================================');
    log(` Password reset via RESET_ADMIN_PASSWORD file for user "${r.username}".`);
    log(` New one-time password: ${pw}`);
    log(' You will be asked to choose your own password after login.');
    log('================================================================');
  } catch (e) {
    log(`RESET_ADMIN_PASSWORD failed: ${e.message}`);
  } finally {
    try { fs.unlinkSync(TRIGGER_FILE); } catch (e) { log(`Could not delete ${TRIGGER_FILE}: ${e.message} - delete it manually!`); }
  }
}

module.exports = { resetPassword, applyResetTrigger, TRIGGER_FILE };

'use strict';
// Shared logic for resetting a password (CLI and trigger file).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const { hashPassword } = require('./password');

const TRIGGER_FILE = path.join(store.DATA_DIR, 'RESET_ADMIN_PASSWORD');

// Sets a new password for `username` (or the only/first admin). Creates an admin if none exists.
function resetPassword({ username, password, mustChange, disable2fa = false }) {
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
  let twoFactorDisabled = false;
  if (disable2fa && user.totp) { delete user.totp; delete user.totpPending; twoFactorDisabled = true; }
  if (password === null) { // only disable 2FA, keep password
    user.sessionVersion = (user.sessionVersion || 1) + 1;
    store.saveUsers(users);
    return { username: user.username, created, isAdmin: !!user.isAdmin, twoFactorDisabled };
  }
  user.passwordHash = hashPassword(password);
  user.isAdmin = user.isAdmin || created;
  user.mustChangePassword = !!mustChange;
  user.sessionVersion = (user.sessionVersion || 1) + 1; // invalidates existing logins of this user
  store.saveUsers(users);
  return { username: user.username, created, isAdmin: !!user.isAdmin, twoFactorDisabled };
}

// If the file data/RESET_ADMIN_PASSWORD exists at startup, reset that admin's password to a
// random one, print it once to the container log and delete the file.
// Optional file content: the username to reset (default: first admin). Add the word
// "disable-2fa" (e.g. "oliver disable-2fa") to switch off two-factor login as well.
function applyResetTrigger(log) {
  if (!fs.existsSync(TRIGGER_FILE)) return;
  let username = '';
  let disable2fa = false;
  try {
    const words = fs.readFileSync(TRIGGER_FILE, 'utf8').trim().split(/\s+/).filter(Boolean);
    disable2fa = words.some((w) => /^-*disable-?2fa$/i.test(w));
    username = words.find((w) => !/^-*disable-?2fa$/i.test(w)) || '';
  } catch { /* ignore */ }
  try {
    const pw = store.randomPassword();
    const r = resetPassword({ username: username || undefined, password: pw, mustChange: true, disable2fa });
    log('================================================================');
    log(` Password reset via RESET_ADMIN_PASSWORD file for user "${r.username}".`);
    log(` New one-time password: ${pw}`);
    if (r.twoFactorDisabled) log(' Two-factor login has been switched off for this user.');
    log(' You will be asked to choose your own password after login.');
    log('================================================================');
  } catch (e) {
    log(`RESET_ADMIN_PASSWORD failed: ${e.message}`);
  } finally {
    try { fs.unlinkSync(TRIGGER_FILE); } catch (e) { log(`Could not delete ${TRIGGER_FILE}: ${e.message} - delete it manually!`); }
  }
}

module.exports = { resetPassword, applyResetTrigger, TRIGGER_FILE };

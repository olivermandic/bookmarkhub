#!/usr/bin/env node
'use strict';
// Reset a BookmarkHub password from inside the container:
//   docker exec -it bookmarkhub reset-admin-password            (asks for the new password)
//   docker exec -it bookmarkhub reset-admin-password --random   (prints a random one-time password)
//   docker exec -it bookmarkhub reset-admin-password --user NAME
//   docker exec -it bookmarkhub reset-admin-password --disable-2fa [--keep-password]
// Works only with shell access to the container/host – there is no web endpoint for this.
const readline = require('readline');
const { resetPassword } = require('./reset');
const { passwordProblem } = require('./password');
const store = require('./store');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] || '') : null; };
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: reset-admin-password [--user NAME] [--random] [--disable-2fa [--keep-password]]');
  process.exit(0);
}
const username = opt('--user') || undefined;
const disable2fa = args.includes('--disable-2fa');
const keepPassword = disable2fa && args.includes('--keep-password');
const random = !keepPassword && (args.includes('--random') || !process.stdin.isTTY);

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = false;
    rl._writeToOutput = function (s) {
      if (rl.stdoutMuted && !s.includes(question) && !/^[\r\n]+$/.test(s)) rl.output.write('*'.repeat(s.length));
      else rl.output.write(s);
    };
    rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
    rl.stdoutMuted = true;
  });
}

(async () => {
  try {
    const users = store.getUsers();
    const admins = users.filter((u) => u.isAdmin).map((u) => u.username);
    console.log(`Data folder: ${store.DATA_DIR}`);
    console.log(`Admins: ${admins.length ? admins.join(', ') : '(none - a new "admin" will be created)'}`);
    let password; let mustChange;
    if (keepPassword) {
      password = null; mustChange = false;
    } else if (random) {
      password = store.randomPassword();
      mustChange = true;
    } else {
      for (;;) {
        password = await askHidden('New password (min. 10 characters): ');
        const p = passwordProblem(password);
        if (p) { console.log(p); continue; }
        const again = await askHidden('Repeat new password: ');
        if (again !== password) { console.log('Passwords do not match, please try again.'); continue; }
        break;
      }
      mustChange = false;
    }
    const r = resetPassword({ username, password, mustChange, disable2fa });
    if (password !== null) console.log(`OK: password for "${r.username}" ${r.created ? '(newly created admin) ' : ''}has been set. Existing logins of this user were signed out.`);
    if (disable2fa) console.log(r.twoFactorDisabled ? `OK: two-factor login switched off for "${r.username}".` : `Note: "${r.username}" had no two-factor login.`);
    if (random) console.log(`One-time password: ${password}\nYou will be asked to choose a new password after login.`);
    console.log('No restart needed.');
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
})();

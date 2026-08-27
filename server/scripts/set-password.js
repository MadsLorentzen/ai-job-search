#!/usr/bin/env node
/**
 * Generate an APP_PASSWORD_HASH line for server/.env.
 *
 * Storing a scrypt hash rather than the password means a leaked .env costs a
 * rotation instead of handing over the login.
 *
 * Usage:
 *   npm run set-password              (prompts, input hidden)
 *   npm run set-password -- <password>
 */
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../src/middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.resolve(__dirname, '../.env');

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const onData = (char) => {
      if (['\n', '\r', ''].includes(String(char))) {
        process.stdin.removeListener('data', onData);
        return;
      }
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(question + '*'.repeat(rl.line.length));
    };

    process.stdout.write(question);
    if (process.stdin.isTTY) process.stdin.on('data', onData);

    rl.question('', (answer) => {
      rl.close();
      if (process.stdin.isTTY) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const fromArgv = process.argv.slice(2).join(' ').trim();
  const password = fromArgv || await promptHidden('New password: ');

  if (!password || password.length < 8) {
    console.error('\nPassword must be at least 8 characters.');
    process.exit(1);
  }

  const hash = await hashPassword(password);
  const line = `APP_PASSWORD_HASH=${hash}`;

  let existing = '';
  if (fs.existsSync(ENV_FILE)) existing = fs.readFileSync(ENV_FILE, 'utf-8');

  if (/^APP_PASSWORD_HASH=.*$/m.test(existing)) {
    existing = existing.replace(/^APP_PASSWORD_HASH=.*$/m, line);
  } else {
    existing = existing.trimEnd() + (existing.trim() ? '\n' : '') + line + '\n';
  }

  // Comment out any plaintext password so the hash is unambiguously in charge.
  existing = existing.replace(/^APP_PASSWORD=(.*)$/m, '# APP_PASSWORD=$1  # superseded by APP_PASSWORD_HASH');

  fs.writeFileSync(ENV_FILE, existing, { encoding: 'utf-8', mode: 0o600 });
  console.log(`\nWrote APP_PASSWORD_HASH to ${ENV_FILE}`);
  console.log('Restart the server for it to take effect.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

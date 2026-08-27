import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// server/src/config -> server
export const SERVER_DIR = path.resolve(__dirname, '../..');
// server/src/config -> repo root
export const ROOT_DIR = path.resolve(__dirname, '../../..');

export const DATA_DIR = path.join(SERVER_DIR, 'data');
export const BUILDS_DIR = path.join(DATA_DIR, 'builds');

/**
 * Every .env location the app honours, nearest-first.
 *
 * These paths used to be computed independently in index.js, claudeService.js
 * and middleware/auth.js, and two of the three resolved one directory too high
 * (landing outside the repo entirely). Passwords loaded from the repo-root
 * .env while API keys silently did not, which surfaced as unexplained Demo
 * Mode. Resolving them once here keeps the three call sites honest.
 */
export const ENV_PATHS = [
  path.join(SERVER_DIR, '.env'),
  path.join(ROOT_DIR, '.env')
];

let loaded = false;

/** Load .env files into process.env. Idempotent; nearest file wins. */
export function loadEnv() {
  if (loaded) return;
  loaded = true;
  for (const envPath of ENV_PATHS) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }
  }
}

/**
 * Strip inline comments and surrounding quotes from a config value.
 * Exported because the auth layer parses .env files directly as well.
 */
export function cleanSecret(val) {
  if (val === undefined || val === null) return '';
  let str = String(val).trim();
  if (!str.startsWith('"') && !str.startsWith("'")) {
    str = str.replace(/\s+#.*$/, '').trim();
  }
  return str.replace(/^["']|["']$/g, '').trim();
}

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

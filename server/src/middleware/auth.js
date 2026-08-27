import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadEnv, cleanSecret, ENV_PATHS, DATA_DIR, ensureDir } from '../config/env.js';
import { loggerFor } from '../config/logger.js';

loadEnv();

const log = loggerFor('auth');
const scrypt = promisify(crypto.scrypt);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

/**
 * This app is single-user by design.
 *
 * An earlier revision advertised AUTH_USERS=name:password pairs, but there is
 * exactly one profile and one application store, so every "user" shared one
 * CV and one tracker and could edit the other's. Supporting that config while
 * the data model cannot honour it is worse than not supporting it, so the
 * multi-user path is gone. See docs in .env.example.
 */

function loadOrCreateSecret() {
  const fromEnv = cleanSecret(process.env.SESSION_SECRET);
  if (fromEnv) return fromEnv;

  ensureDir(DATA_DIR);
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const existing = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
      if (existing) return existing;
    }
  } catch (err) {
    log.warn({ err: err.message }, 'could not read session secret, regenerating');
  }

  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(SECRET_FILE, generated, { encoding: 'utf-8', mode: 0o600 });
  } catch (err) {
    log.warn({ err: err.message }, 'could not persist session secret; sessions will not survive a restart');
  }
  return generated;
}

const SESSION_SECRET = loadOrCreateSecret();

function parseEnvFileManually(filePath) {
  const map = {};
  if (!fs.existsSync(filePath)) return map;
  try {
    for (const line of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (match) map[match[1]] = cleanSecret(match[2]);
    }
  } catch (err) {
    log.warn({ file: filePath, err: err.message }, 'could not read env file');
  }
  return map;
}

function configValue(...names) {
  for (const name of names) {
    const fromEnv = cleanSecret(process.env[name]);
    if (fromEnv) return fromEnv;
  }
  for (const envPath of ENV_PATHS) {
    const parsed = parseEnvFileManually(envPath);
    for (const name of names) {
      if (parsed[name]) return parsed[name];
    }
  }
  return '';
}

/**
 * Format: scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>
 * Produced by `npm run set-password`.
 */
export async function hashPassword(password, salt = crypto.randomBytes(16)) {
  const { N, r, p, keylen } = SCRYPT_PARAMS;
  // @ts-expect-error promisify() drops scrypt's options overload; the runtime
  // signature is (password, salt, keylen, options, callback).
  const derived = await scrypt(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function verifyAgainstHash(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, N, r, p, saltHex, hashHex] = parts;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    // @ts-expect-error see hashPassword: promisify drops the options overload.
    const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024
    });
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch (err) {
    log.warn({ err: err.message }, 'could not verify password hash');
    return false;
  }
}

function safeEqual(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export function getPasswordHash() {
  return configValue('APP_PASSWORD_HASH');
}

export function getPlaintextPassword() {
  return configValue('APP_PASSWORD', 'AUTH_PASSWORD', 'ACCESS_KEY');
}

export function isAuthConfigured() {
  return Boolean(getPasswordHash() || getPlaintextPassword());
}

/** True when only the legacy plaintext form is configured. */
export function isUsingPlaintextPassword() {
  return !getPasswordHash() && Boolean(getPlaintextPassword());
}

/**
 * There is deliberately no built-in fallback password: an empty configuration
 * means "refuse every login", never "use the default".
 */
export async function verifyPassword(input) {
  const candidate = cleanSecret(input);
  if (!candidate) return false;

  const hash = getPasswordHash();
  if (hash) return verifyAgainstHash(candidate, hash);

  // Plaintext remains supported so an existing install keeps working, but the
  // server warns at startup and points at `npm run set-password`.
  const plain = getPlaintextPassword();
  return plain ? safeEqual(candidate, plain) : false;
}

function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

export function issueToken(ttlMs = SESSION_TTL_MS) {
  const expiresAt = Date.now() + ttlMs;
  const nonce = crypto.randomBytes(18).toString('base64url');
  const payload = `${nonce}.${expiresAt}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [nonce, expiresAt, signature] = parts;
  const expected = sign(`${nonce}.${expiresAt}`);

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  const expiry = Number(expiresAt);
  return Number.isFinite(expiry) && expiry > Date.now();
}

/**
 * Fixed-window login throttle keyed by client IP.
 * In-memory, which is correct for a single-process app; see README on why
 * clustering this app would need a shared store.
 */
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();

export function checkLoginRate(ip) {
  const now = Date.now();
  const record = attempts.get(ip);

  if (!record || now > record.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSec: 0 };
  }

  record.count += 1;
  if (record.count > MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSec: Math.ceil((record.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function clearLoginRate(ip) {
  attempts.delete(ip);
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of attempts) {
    if (now > record.resetAt) attempts.delete(ip);
  }
}, WINDOW_MS).unref();

export function extractToken(req) {
  const authHeader = req.headers['authorization'];
  const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  return String(bearer || req.headers['x-access-token'] || '').trim();
}

/**
 * Tokens are accepted from headers only. The query-string branch is gone on
 * purpose: it put credentials into browser history, access logs and Referer.
 */
export function authMiddleware(req, res, next) {
  if (req.path === '/health' || req.path.startsWith('/auth/')) return next();

  if (verifyToken(extractToken(req))) return next();

  return res.status(401).json({
    success: false,
    error: 'Unauthorized. Please unlock the workspace.'
  });
}

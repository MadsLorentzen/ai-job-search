import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { loadEnv, cleanSecret, ENV_PATHS, DATA_DIR, ensureDir } from '../config/env.js';

loadEnv();

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');

/**
 * Signing secret for session tokens.
 *
 * Persisted (0600) so that sessions survive a restart, which is the whole
 * point of the 7-day window. SESSION_SECRET in the environment wins when set,
 * which is what a multi-instance deployment needs.
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
    console.warn('Could not read session secret, regenerating:', err.message);
  }

  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(SECRET_FILE, generated, { encoding: 'utf-8', mode: 0o600 });
  } catch (err) {
    console.warn('Could not persist session secret; sessions will not survive a restart:', err.message);
  }
  return generated;
}

const SESSION_SECRET = loadOrCreateSecret();

function parseEnvFileManually(filePath) {
  const map = {};
  if (!fs.existsSync(filePath)) return map;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (match) map[match[1]] = cleanSecret(match[2]);
    }
  } catch (err) {
    console.warn(`Error reading ${filePath}:`, err.message);
  }
  return map;
}

/**
 * Passwords that may unlock the app.
 *
 * There is deliberately no built-in fallback. A previous revision always
 * appended a hardcoded password here, which meant no configuration could
 * secure the app and every fork of this repo shared one working credential.
 * An empty result now means "refuse all logins", not "use the default".
 */
export function getAuthorizedPasswords() {
  const passwords = new Set();

  const add = (val) => {
    const clean = cleanSecret(val);
    if (clean) passwords.add(clean);
  };

  add(process.env.APP_PASSWORD);
  add(process.env.AUTH_PASSWORD);
  add(process.env.ACCESS_KEY);

  const addUsers = (raw) => {
    if (!raw || !String(raw).trim()) return;
    for (const entry of String(raw).split(',')) {
      const parts = entry.split(':');
      add(parts.length >= 2 ? parts.slice(1).join(':') : entry);
    }
  };

  addUsers(process.env.AUTH_USERS);

  for (const envPath of ENV_PATHS) {
    const parsed = parseEnvFileManually(envPath);
    add(parsed.APP_PASSWORD);
    add(parsed.AUTH_PASSWORD);
    add(parsed.ACCESS_KEY);
    addUsers(parsed.AUTH_USERS);
  }

  return Array.from(passwords);
}

export function isAuthConfigured() {
  return getAuthorizedPasswords().length > 0;
}

/** Constant-time comparison that does not leak length through early return. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf-8');
  const bufB = Buffer.from(String(b), 'utf-8');
  const hashA = crypto.createHash('sha256').update(bufA).digest();
  const hashB = crypto.createHash('sha256').update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export function verifyPassword(input) {
  const candidate = cleanSecret(input);
  if (!candidate) return false;

  // Compare against every configured password without short-circuiting, so
  // response time does not reveal which entry (if any) matched.
  let matched = false;
  for (const password of getAuthorizedPasswords()) {
    if (safeEqual(candidate, password)) matched = true;
  }
  return matched;
}

function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

/**
 * Issue an opaque session token.
 *
 * The token is random material plus an expiry, signed with the server secret.
 * It is explicitly NOT the user's password: the previous revision returned the
 * submitted password as the token, so anything that could read it (an XSS, a
 * proxy log, browser history) recovered the account credential itself.
 */
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
  const payload = `${nonce}.${expiresAt}`;
  const expected = sign(payload);

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  const expiry = Number(expiresAt);
  return Number.isFinite(expiry) && expiry > Date.now();
}

/**
 * Fixed-window login throttle, keyed by client IP.
 * In-memory by design: this app is single-process and single-user.
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

// Bound the map so a burst of spoofed IPs cannot grow it without limit.
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of attempts) {
    if (now > record.resetAt) attempts.delete(ip);
  }
}, WINDOW_MS).unref();

/**
 * Gate for every /api route except the explicitly public ones.
 *
 * Tokens are accepted from the Authorization header or X-Access-Token only.
 * The query-string branch is gone on purpose: it put credentials into browser
 * history, access logs and Referer headers.
 */
export function authMiddleware(req, res, next) {
  if (req.path === '/health' || req.path.startsWith('/auth/')) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = (bearer || req.headers['x-access-token'] || '').trim();

  if (verifyToken(token)) return next();

  return res.status(401).json({
    success: false,
    error: 'Unauthorized. Please unlock the workspace.'
  });
}

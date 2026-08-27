import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Possible .env paths (server/.env and repo root .env)
const envPaths = [
  path.resolve(__dirname, '../../.env'),       // server/.env
  path.resolve(__dirname, '../../../.env'),    // job-search/.env
  path.resolve(process.cwd(), '.env'),         // cwd .env
  path.resolve(process.cwd(), 'server/.env')   // cwd/server/.env
];

// Default fallback master password
export const DEFAULT_FALLBACK_PASSWORD = 'jobsearch_access_2026';

function cleanSecret(val) {
  if (!val) return '';
  let str = String(val).trim();
  // Strip inline comments if unquoted (e.g. APP_PASSWORD=secret # my comment)
  if (!str.startsWith('"') && !str.startsWith("'")) {
    str = str.split('#')[0].trim();
  }
  // Strip surrounding quotes
  return str.replace(/^["']|["']$/g, '').trim();
}

function parseEnvFileManually(filePath) {
  const map = {};
  if (!fs.existsSync(filePath)) return map;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (match) {
        const key = match[1];
        const val = cleanSecret(match[2]);
        map[key] = val;
      }
    }
  } catch (err) {
    console.warn(`Error reading ${filePath}:`, err.message);
  }
  return map;
}

export function getAuthorizedPasswords() {
  const passwords = new Set();

  // 1. Check process.env (loaded by PM2 or dotenv)
  const envPass = cleanSecret(process.env.APP_PASSWORD || process.env.AUTH_PASSWORD || process.env.ACCESS_KEY);
  if (envPass) passwords.add(envPass);

  const envUsers = process.env.AUTH_USERS;
  if (envUsers && envUsers.trim()) {
    envUsers.split(',').forEach(entry => {
      const parts = entry.split(':');
      if (parts.length >= 2) {
        passwords.add(cleanSecret(parts[1]));
      } else {
        passwords.add(cleanSecret(entry));
      }
    });
  }

  // 2. Directly read from .env files on disk (bypasses any PM2 caching)
  for (const envPath of envPaths) {
    const parsed = parseEnvFileManually(envPath);
    if (parsed.APP_PASSWORD) passwords.add(parsed.APP_PASSWORD);
    if (parsed.AUTH_PASSWORD) passwords.add(parsed.AUTH_PASSWORD);
    if (parsed.ACCESS_KEY) passwords.add(parsed.ACCESS_KEY);
    if (parsed.AUTH_USERS) {
      parsed.AUTH_USERS.split(',').forEach(entry => {
        const parts = entry.split(':');
        passwords.add(cleanSecret(parts.length >= 2 ? parts[1] : entry));
      });
    }
  }

  // 3. Always include default password as emergency fallback
  passwords.add(DEFAULT_FALLBACK_PASSWORD);

  return Array.from(passwords).filter(Boolean);
}

export function authMiddleware(req, res, next) {
  if (req.path === '/health' || req.path === '/auth/login' || req.path === '/auth/verify') {
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const customHeader = req.headers['x-access-token'];
  const queryToken = req.query.token;

  const providedToken = cleanSecret(token || customHeader || queryToken);
  const validPasswords = getAuthorizedPasswords();

  if (providedToken && validPasswords.includes(providedToken)) {
    return next();
  }

  return res.status(401).json({
    success: false,
    error: 'Unauthorized: Valid Access Key or Password required.'
  });
}

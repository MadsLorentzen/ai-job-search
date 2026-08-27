import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check both server/.env and root/.env
const serverEnvPath = path.resolve(__dirname, '../../.env');
const rootEnvPath = path.resolve(__dirname, '../../../../.env');

if (fs.existsSync(serverEnvPath)) {
  dotenv.config({ path: serverEnvPath });
}
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
}

// Default fallback password if none set
const DEFAULT_PASSWORD = 'jobsearch_access_2026';

function cleanSecret(val) {
  if (!val) return '';
  return String(val).trim().replace(/^["']|["']$/g, '');
}

export function getAuthorizedPasswords() {
  // Re-read .env dynamically in case it changed at runtime
  if (fs.existsSync(serverEnvPath)) {
    dotenv.config({ path: serverEnvPath, override: true });
  }

  const envPass = cleanSecret(process.env.APP_PASSWORD || process.env.AUTH_PASSWORD || process.env.ACCESS_KEY);
  const envUsers = process.env.AUTH_USERS;

  const passwords = new Set();

  if (envPass) {
    passwords.add(envPass);
  }

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

  if (passwords.size === 0) {
    passwords.add(DEFAULT_PASSWORD);
  }

  return Array.from(passwords);
}

export function authMiddleware(req, res, next) {
  // Allow health check and login endpoint without auth
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

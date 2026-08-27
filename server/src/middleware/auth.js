import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Default password if none set in .env
const DEFAULT_PASSWORD = 'jobsearch_access_2026';

export function getAuthorizedPasswords() {
  const envPass = process.env.APP_PASSWORD;
  const envUsers = process.env.AUTH_USERS; // format: "user1:pass1,user2:pass2"

  const passwords = new Set();

  if (envPass && envPass.trim()) {
    passwords.add(envPass.trim());
  }

  if (envUsers && envUsers.trim()) {
    envUsers.split(',').forEach(entry => {
      const parts = entry.split(':');
      if (parts.length >= 2) {
        passwords.add(parts[1].trim());
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

  const providedToken = token || customHeader || req.query.token;
  const validPasswords = getAuthorizedPasswords();

  if (providedToken && validPasswords.includes(providedToken.trim())) {
    return next();
  }

  return res.status(401).json({
    success: false,
    error: 'Unauthorized: Valid Access Key or Password required.'
  });
}

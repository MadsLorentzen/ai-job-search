import express from 'express';
import {
  verifyPassword, verifyToken, issueToken, isAuthConfigured,
  checkLoginRate, clearLoginRate, extractToken
} from '../middleware/auth.js';
import { registerUser, authenticateUser, resolveUserFromToken, revokeSession } from '../services/authService.js';
import { loggerFor } from '../config/logger.js';

const router = express.Router();
const log = loggerFor('auth');

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Register a new user and organization.
 */
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, fullName, organizationName, role } = req.body;
    const result = await registerUser({
      email,
      password,
      fullName,
      organizationName,
      role: role || 'candidate',
      req
    });

    const authResult = await authenticateUser({ email, password, req });
    return res.status(201).json({
      success: true,
      ...result,
      ...authResult
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * Login endpoint supporting both multi-user (email + password) and workspace unlock (password only).
 */
router.post('/login', async (req, res, next) => {
  try {
    const ip = clientIp(req);
    const { email, password } = req.body;

    const rate = checkLoginRate(ip);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      return res.status(429).json({
        success: false,
        error: `Too many attempts. Try again in ${Math.ceil(rate.retryAfterSec / 60)} minutes.`
      });
    }

    if (email) {
      const result = await authenticateUser({ email, password, req });
      if (!result) {
        return res.status(401).json({ success: false, error: 'Invalid email or password.' });
      }
      clearLoginRate(ip);
      return res.json({ success: true, ...result });
    }

    // Workspace password fallback
    if (!isAuthConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'No password configured on the server. Run `npm run set-password` in server/ and restart.'
      });
    }

    if (await verifyPassword(password)) {
      clearLoginRate(ip);
      const { token, expiresAt } = issueToken();
      log.info('login succeeded');
      return res.json({
        success: true,
        token,
        expiresAt,
        user: {
          id: '00000000-0000-0000-0000-000000000002',
          email: 'admin@oppertunex.local',
          fullName: 'Default Admin',
          organizationId: '00000000-0000-0000-0000-000000000001',
          role: 'platform_admin'
        }
      });
    }

    log.warn({ ip }, 'login failed');
    return res.status(401).json({ success: false, error: 'Incorrect password.' });
  } catch (err) {
    next(err);
  }
});

/**
 * Get current authenticated user context
 */
router.get('/me', (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ success: false, error: 'Unauthenticated' });

  const resolved = resolveUserFromToken(token);
  if (!resolved) {
    if (verifyToken(token)) {
      return res.json({
        success: true,
        user: {
          id: '00000000-0000-0000-0000-000000000002',
          email: 'admin@oppertunex.local',
          fullName: 'Default Admin'
        },
        organizationId: '00000000-0000-0000-0000-000000000001',
        organizationName: 'Default Workspace',
        role: 'platform_admin'
      });
    }
    return res.status(401).json({ success: false, error: 'Invalid or expired session' });
  }

  return res.json({
    success: true,
    user: resolved.user,
    organizationId: resolved.organizationId,
    organizationName: resolved.organizationName,
    role: resolved.role,
    permissions: resolved.permissions
  });
});

router.post('/logout', (req, res) => {
  const token = extractToken(req);
  revokeSession(token);
  return res.json({ success: true, message: 'Logged out successfully' });
});

router.get('/verify', (req, res) => {
  if (verifyToken(extractToken(req))) {
    return res.json({ success: true, valid: true });
  }
  return res.status(401).json({ success: false, valid: false });
});

export default router;

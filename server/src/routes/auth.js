import express from 'express';
import {
  verifyPassword, verifyToken, issueToken, isAuthConfigured,
  checkLoginRate, clearLoginRate, extractToken
} from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { loginBody } from '../validation/schemas.js';
import { loggerFor } from '../config/logger.js';

const router = express.Router();
const log = loggerFor('auth');

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

router.post('/login', validateBody(loginBody), async (req, res, next) => {
  try {
    const ip = clientIp(req);

    // Saying this reveals no secret, and it is the only way an operator can
    // tell a misconfigured server from a wrong password.
    if (!isAuthConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'No password configured on the server. Run `npm run set-password` in server/ and restart.'
      });
    }

    const rate = checkLoginRate(ip);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      return res.status(429).json({
        success: false,
        error: `Too many attempts. Try again in ${Math.ceil(rate.retryAfterSec / 60)} minutes.`
      });
    }

    if (await verifyPassword(req.body.password)) {
      clearLoginRate(ip);
      const { token, expiresAt } = issueToken();
      log.info('login succeeded');
      return res.json({ success: true, token, expiresAt });
    }

    // Deliberately generic and without a hint.
    log.warn({ ip }, 'login failed');
    return res.status(401).json({ success: false, error: 'Incorrect password.' });
  } catch (err) {
    next(err);
  }
});

router.get('/verify', (req, res) => {
  if (verifyToken(extractToken(req))) {
    return res.json({ success: true, valid: true });
  }
  return res.status(401).json({ success: false, valid: false });
});

export default router;

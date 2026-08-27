import express from 'express';
import {
  verifyPassword,
  verifyToken,
  issueToken,
  isAuthConfigured,
  checkLoginRate,
  clearLoginRate
} from '../middleware/auth.js';

const router = express.Router();

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

router.post('/login', (req, res) => {
  const ip = clientIp(req);

  // Without a configured password the app cannot be unlocked at all. Saying so
  // is safe (it reveals no secret) and it is the only way an operator can tell
  // this apart from a wrong password.
  if (!isAuthConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'No password configured on the server. Set APP_PASSWORD in server/.env and restart.'
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

  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ success: false, error: 'Password is required.' });
  }

  if (verifyPassword(password)) {
    clearLoginRate(ip);
    const { token, expiresAt } = issueToken();
    console.log('[Auth] Login succeeded.');
    return res.json({ success: true, token, expiresAt });
  }

  // Deliberately generic, and deliberately without a hint. The previous
  // revision printed a working password in this response body.
  console.warn(`[Auth] Login failed from ${ip}.`);
  return res.status(401).json({ success: false, error: 'Incorrect password.' });
});

router.get('/verify', (req, res) => {
  const authHeader = req.headers['authorization'];
  const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = (bearer || req.headers['x-access-token'] || '').trim();

  if (verifyToken(token)) {
    return res.json({ success: true, valid: true });
  }
  return res.status(401).json({ success: false, valid: false });
});

export default router;

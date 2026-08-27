import express from 'express';
import { getAuthorizedPasswords, DEFAULT_FALLBACK_PASSWORD } from '../middleware/auth.js';

const router = express.Router();

// Login endpoint
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, error: 'Password or Access Key is required.' });
  }

  const cleanInput = String(password).trim().replace(/^["']|["']$/g, '');
  const validPasswords = getAuthorizedPasswords();

  console.log(`[Auth] Login attempt. Cleaned input length: ${cleanInput.length}. Configured passwords count: ${validPasswords.length}`);

  if (validPasswords.includes(cleanInput)) {
    console.log(`[Auth] ✅ Login SUCCESS!`);
    return res.json({
      success: true,
      token: cleanInput,
      message: 'Authentication successful!'
    });
  }

  console.warn(`[Auth] ❌ Login FAILED. Attempted password does not match.`);
  return res.status(401).json({
    success: false,
    error: `Incorrect Password. (Tip: emergency fallback password is: ${DEFAULT_FALLBACK_PASSWORD})`
  });
});

// Verify existing token endpoint
router.get('/verify', (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.headers['x-access-token'];
  const cleanInput = String(token || '').trim().replace(/^["']|["']$/g, '');
  const validPasswords = getAuthorizedPasswords();

  if (cleanInput && validPasswords.includes(cleanInput)) {
    return res.json({ success: true, valid: true });
  }

  return res.status(401).json({ success: false, valid: false });
});

export default router;

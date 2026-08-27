import express from 'express';
import { getAuthorizedPasswords } from '../middleware/auth.js';

const router = express.Router();

// Login endpoint
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, error: 'Password or Access Key is required.' });
  }

  const validPasswords = getAuthorizedPasswords();
  if (validPasswords.includes(password.trim())) {
    return res.json({
      success: true,
      token: password.trim(),
      message: 'Authentication successful!'
    });
  }

  return res.status(401).json({
    success: false,
    error: 'Incorrect Password or Access Key.'
  });
});

// Verify existing token endpoint
router.get('/verify', (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.headers['x-access-token'];
  const validPasswords = getAuthorizedPasswords();

  if (token && validPasswords.includes(token.trim())) {
    return res.json({ success: true, valid: true });
  }

  return res.status(401).json({ success: false, valid: false });
});

export default router;

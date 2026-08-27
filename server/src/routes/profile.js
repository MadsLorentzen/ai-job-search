import express from 'express';
import multer from 'multer';
import { storageService } from '../services/storageService.js';
import { claudeService } from '../services/claudeService.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Get candidate profile
router.get('/', (req, res) => {
  try {
    const profile = storageService.getProfile();
    res.json({ success: true, profile });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update candidate profile
router.post('/', (req, res) => {
  try {
    const updated = storageService.saveProfile(req.body);
    res.json({ success: true, profile: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload and auto-parse CV file or raw text
router.post('/upload-cv', upload.single('cvFile'), async (req, res) => {
  try {
    let rawText = req.body.rawText || '';

    if (req.file) {
      const buffer = req.file.buffer;
      // Extract plain text from buffer
      rawText = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
    }

    if (!rawText || rawText.trim().length < 50) {
      return res.status(400).json({
        success: false,
        error: 'Please provide valid resume text or upload a readable file with at least 50 characters.'
      });
    }

    console.log('Parsing uploaded resume text...');
    const parsed = await claudeService.parseResumeText(rawText);
    
    // Merge with existing profile
    const existing = storageService.getProfile();
    const merged = {
      ...existing,
      ...parsed,
      identity: { ...existing.identity, ...parsed.identity },
      skills: { ...existing.skills, ...parsed.skills }
    };

    storageService.saveProfile(merged);
    res.json({ success: true, profile: merged, message: 'Resume successfully parsed and profile updated!' });
  } catch (err) {
    console.error('Error parsing uploaded CV:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

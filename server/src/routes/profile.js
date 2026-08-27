import express from 'express';
import multer from 'multer';
import { storageService } from '../services/storageService.js';
import { claudeService } from '../services/claudeService.js';
import { extractTextFromBuffer } from '../utils/pdfExtractor.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

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
      console.log(`Extracting text from uploaded file: ${req.file.originalname} (${req.file.mimetype}, ${req.file.size} bytes)...`);
      rawText = extractTextFromBuffer(req.file.buffer, req.file.mimetype, req.file.originalname);
      console.log(`Extracted ${rawText.length} characters of text.`);
    }

    if (!rawText || rawText.trim().length < 30) {
      return res.status(400).json({
        success: false,
        error: 'Unable to extract text from the uploaded file. Please paste your resume text directly.'
      });
    }

    console.log('Parsing candidate resume with AI engine...');
    const parsed = await claudeService.parseResumeText(rawText);
    
    // Save new profile
    const existing = storageService.getProfile();
    const updatedProfile = {
      ...existing,
      ...parsed,
      identity: {
        ...existing.identity,
        ...(parsed.identity || {})
      },
      skills: {
        ...existing.skills,
        ...(parsed.skills || {})
      }
    };

    storageService.saveProfile(updatedProfile);
    console.log(`Profile successfully updated for candidate: ${updatedProfile.identity?.name || 'Candidate'}`);

    res.json({
      success: true,
      profile: updatedProfile,
      message: 'Resume successfully parsed and profile updated!'
    });
  } catch (err) {
    console.error('Error parsing uploaded CV:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

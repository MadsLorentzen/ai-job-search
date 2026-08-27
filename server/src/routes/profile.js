import express from 'express';
import multer from 'multer';
import { storageService } from '../services/storageService.js';
import { claudeService } from '../services/claudeService.js';
import { extractTextFromBuffer } from '../utils/pdfExtractor.js';

const router = express.Router();

const ALLOWED_UPLOAD_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown'
]);
const ALLOWED_EXTENSIONS = /\.(pdf|docx|doc|txt|md)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_UPLOAD_TYPES.has(file.mimetype) || ALLOWED_EXTENSIONS.test(file.originalname || '')) {
      return cb(null, true);
    }
    const err = new Error('Unsupported file type. Upload a PDF, DOCX, TXT or Markdown file.');
    err.statusCode = 400;
    cb(err);
  }
});

router.get('/', (req, res, next) => {
  try {
    res.json({ success: true, profile: storageService.getProfile() });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const profile = await storageService.saveProfile(req.body);
    res.json({ success: true, profile });
  } catch (err) {
    next(err);
  }
});

router.post('/upload-cv', upload.single('cvFile'), async (req, res, next) => {
  try {
    let rawText = req.body?.rawText || '';

    if (req.file) {
      rawText = extractTextFromBuffer(req.file.buffer, req.file.mimetype, req.file.originalname);
    }

    if (!rawText || rawText.trim().length < 30) {
      return res.status(400).json({
        success: false,
        error: 'Could not extract readable text from that file. If it is a scanned PDF, paste the text directly instead.'
      });
    }

    const parsed = await claudeService.parseResumeText(rawText);

    const existing = storageService.getProfile();
    const updatedProfile = {
      ...existing,
      ...parsed,
      identity: { ...existing.identity, ...(parsed.identity || {}) },
      skills: { ...existing.skills, ...(parsed.skills || {}) }
    };
    delete updatedProfile.source;

    await storageService.saveProfile(updatedProfile);

    res.json({
      success: true,
      profile: updatedProfile,
      source: parsed.source,
      message: parsed.source === 'local-parser'
        ? 'Parsed with the built-in extractor (no AI provider reachable). Check the fields and fill in any gaps.'
        : 'Resume parsed and profile updated.'
    });
  } catch (err) {
    next(err);
  }
});

export default router;

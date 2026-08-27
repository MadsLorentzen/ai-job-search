import express from 'express';
import multer from 'multer';
import { storageService } from '../services/storageService.js';
import { claudeService } from '../services/claudeService.js';
import { extractTextFromBuffer } from '../utils/pdfExtractor.js';
import { validateBody } from '../middleware/validate.js';
import { profileBody, uploadCvBody } from '../validation/schemas.js';
import { loggerFor } from '../config/logger.js';
import { ValidationError } from '../errors.js';

const router = express.Router();
const log = loggerFor('profile');

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
    cb(new ValidationError('Unsupported file type. Upload a PDF, DOCX, TXT or Markdown file.'));
  }
});

router.get('/', (req, res, next) => {
  try {
    res.json({ success: true, profile: storageService.getProfile() });
  } catch (err) {
    next(err);
  }
});

/** Download a portable, user-owned copy of the profile and tracker data. */
router.get('/export', (req, res, next) => {
  try {
    const exportedAt = new Date().toISOString();
    const payload = {
      schemaVersion: 1,
      exportedAt,
      profile: storageService.getProfile(),
      applications: storageService.getApplications()
    };
    res.setHeader('Content-Disposition', `attachment; filename="oppertunex-backup-${exportedAt.slice(0, 10)}.json"`);
    res.type('application/json').send(JSON.stringify(payload, null, 2));
  } catch (err) {
    next(err);
  }
});

router.post('/', validateBody(profileBody), (req, res, next) => {
  try {
    res.json({ success: true, profile: storageService.saveProfile(req.body) });
  } catch (err) {
    next(err);
  }
});

/**
 * Parse an uploaded CV without saving it.
 *
 * The onboarding wizard shows the parsed fields for confirmation before
 * anything is written, which is the moment a user can still catch an
 * extraction error against the source document.
 */
router.post('/parse-cv', upload.single('cvFile'), validateBody(uploadCvBody), async (req, res, next) => {
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
    log.info({ source: parsed.source }, 'parsed a resume');

    res.json({
      success: true,
      parsed,
      source: parsed.source,
      message: parsed.source === 'local-parser'
        ? 'Parsed with the built-in extractor (no AI provider reachable). Check every field before saving.'
        : 'Parsed. Check the fields before saving.'
    });
  } catch (err) {
    next(err);
  }
});

/** Parse and save in one step, for the non-wizard path. */
router.post('/upload-cv', upload.single('cvFile'), validateBody(uploadCvBody), async (req, res, next) => {
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

    storageService.saveProfile(updatedProfile);

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

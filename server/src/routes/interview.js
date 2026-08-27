import express from 'express';
import { claudeService } from '../services/claudeService.js';
import { storageService } from '../services/storageService.js';
import { validateBody } from '../middleware/validate.js';
import { interviewBody } from '../validation/schemas.js';

const router = express.Router();

router.post('/generate', validateBody(interviewBody), async (req, res, next) => {
  try {
    const { job } = req.body;
    const prep = await claudeService.generateInterviewPrep(storageService.getProfile(), job);

    res.json({
      success: true,
      jobTitle: job.title,
      company: job.company,
      source: prep.source,
      prep
    });
  } catch (err) {
    next(err);
  }
});

export default router;

import express from 'express';
import { claudeService } from '../services/claudeService.js';
import { storageService } from '../services/storageService.js';
import { validateBody } from '../middleware/validate.js';
import { evaluateBody } from '../validation/schemas.js';

const router = express.Router();

router.post('/', validateBody(evaluateBody), async (req, res, next) => {
  try {
    const { job } = req.body;
    const evaluation = await claudeService.evaluateJobFit(storageService.getProfile(), job);

    res.json({
      success: true,
      jobTitle: job.title,
      company: job.company,
      // Lets the client distinguish a real evaluation from an
      // "AI unavailable" placeholder instead of rendering both the same.
      source: evaluation.source,
      evaluation
    });
  } catch (err) {
    next(err);
  }
});

export default router;

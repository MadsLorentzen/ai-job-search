import express from 'express';
import { claudeService } from '../services/claudeService.js';
import { storageService } from '../services/storageService.js';

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const { job } = req.body || {};
    if (!job || !job.title || !job.description) {
      return res.status(400).json({
        success: false,
        error: 'Job title and description are required for a fit evaluation.'
      });
    }

    const profile = storageService.getProfile();
    const evaluation = await claudeService.evaluateJobFit(profile, job);

    res.json({
      success: true,
      jobTitle: job.title,
      company: job.company,
      // Surfaced so the client can tell a real evaluation from an
      // "AI unavailable" placeholder instead of rendering both the same.
      source: evaluation.source,
      evaluation
    });
  } catch (err) {
    next(err);
  }
});

export default router;

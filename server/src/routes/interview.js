import express from 'express';
import { claudeService } from '../services/claudeService.js';
import { storageService } from '../services/storageService.js';

const router = express.Router();

router.post('/generate', async (req, res, next) => {
  try {
    const { job } = req.body || {};
    if (!job || !job.title) {
      return res.status(400).json({ success: false, error: 'Job title is required.' });
    }

    const profile = storageService.getProfile();
    const prep = await claudeService.generateInterviewPrep(profile, job);

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

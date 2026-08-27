import express from 'express';
import { claudeService } from '../services/claudeService.js';
import { storageService } from '../services/storageService.js';

const router = express.Router();

// Score and evaluate a target job posting against candidate profile
router.post('/', async (req, res) => {
  try {
    const { job } = req.body;
    if (!job || !job.title || !job.description) {
      return res.status(400).json({
        success: false,
        error: 'Job details (title, company, description) are required for fit evaluation.'
      });
    }

    const profile = storageService.getProfile();
    console.log(`Evaluating job fit for: ${job.company} - ${job.title}`);

    const evaluation = await claudeService.evaluateJobFit(profile, job);

    res.json({
      success: true,
      jobTitle: job.title,
      company: job.company,
      evaluation
    });
  } catch (err) {
    console.error('Evaluation API error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

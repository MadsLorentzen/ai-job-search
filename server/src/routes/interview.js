import express from 'express';
import { claudeService } from '../services/claudeService.js';
import { storageService } from '../services/storageService.js';

const router = express.Router();

// Generate role and company specific interview preparation
router.post('/generate', async (req, res) => {
  try {
    const { job } = req.body;
    if (!job || !job.title) {
      return res.status(400).json({ success: false, error: 'Job details are required.' });
    }

    const profile = storageService.getProfile();
    console.log(`Generating STAR interview preparation for: ${job.company} - ${job.title}`);

    const prep = await claudeService.generateInterviewPrep(profile, job);

    res.json({
      success: true,
      jobTitle: job.title,
      company: job.company,
      prep
    });
  } catch (err) {
    console.error('Interview prep error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

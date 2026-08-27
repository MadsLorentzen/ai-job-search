import express from 'express';
import { scraperService } from '../services/scraperService.js';

const router = express.Router();

// Get list of supported portals
router.get('/portals', (req, res) => {
  try {
    const portals = scraperService.getAvailablePortals();
    res.json({ success: true, portals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Search job openings across portals
router.get('/search', async (req, res) => {
  try {
    const { query = '', location = 'Remote', portal = 'freehire-search', limit = 10, remote = 'all' } = req.query;
    
    const jobs = await scraperService.searchJobs({
      query: String(query).trim(),
      location: String(location).trim(),
      portal: String(portal),
      limit: parseInt(limit, 10) || 10,
      remote: String(remote)
    });

    res.json({
      success: true,
      count: jobs.length,
      portal,
      query,
      location,
      jobs
    });
  } catch (err) {
    console.error('Job search API error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

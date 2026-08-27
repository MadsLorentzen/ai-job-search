import express from 'express';
import { scraperService } from '../services/scraperService.js';

const router = express.Router();

router.get('/portals', (req, res, next) => {
  try {
    res.json({ success: true, portals: scraperService.getAvailablePortals() });
  } catch (err) {
    next(err);
  }
});

router.get('/search', async (req, res, next) => {
  try {
    const { query = '', location = 'Remote', portal = 'freehire-search', remote = 'all' } = req.query;

    const result = await scraperService.searchJobs({
      query: String(query).trim(),
      location: String(location).trim(),
      portal: String(portal),
      remote: String(remote)
    });

    res.json({
      success: true,
      count: result.jobs.length,
      portal,
      query,
      location,
      // Explicit provenance so the UI can distinguish live results from
      // anything else, rather than rendering them identically.
      source: result.source,
      isSample: result.isSample,
      warning: result.warning,
      jobs: result.jobs
    });
  } catch (err) {
    next(err);
  }
});

export default router;

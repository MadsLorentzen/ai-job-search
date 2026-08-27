import express from 'express';
import { scraperService } from '../services/scraperService.js';
import { storageService } from '../services/storageService.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { searchQuery, detailQuery, jobStateBody } from '../validation/schemas.js';

const router = express.Router();

router.get('/portals', (req, res, next) => {
  try {
    res.json({
      success: true,
      portals: scraperService.getAvailablePortals(),
      detailAvailable: scraperService.hasBun()
    });
  } catch (err) {
    next(err);
  }
});

router.get('/search', validateQuery(searchQuery), async (req, res, next) => {
  try {
    const { query, location, portal, remote, hideSeen } = req.query;
    const result = await scraperService.searchJobs({ query, location, portal, remote });

    // Remember what came back so a second search can tell new from already-seen.
    storageService.markJobsSeen(result.jobs);
    const states = storageService.getJobStates(result.jobs.map(j => j.id));

    let jobs = result.jobs.map(job => ({
      ...job,
      seenState: states[job.id]?.state || 'seen',
      isNew: !states[job.id] || states[job.id].firstSeen === states[job.id].lastSeen
    }));

    const totalBeforeFilter = jobs.length;
    if (hideSeen === 'true') {
      jobs = jobs.filter(job => job.seenState !== 'dismissed' && job.seenState !== 'applied');
    }

    res.json({
      success: true,
      count: jobs.length,
      totalBeforeFilter,
      portal,
      query,
      location,
      source: result.source,
      isSample: result.isSample,
      warning: result.warning,
      detailAvailable: scraperService.hasBun(),
      jobs
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Fetch a posting's full text through the portal skill's own detail command.
 * Search results are a stub on several portals, and evaluating a stub yields
 * a meaningless score.
 */
router.get('/detail', validateQuery(detailQuery), async (req, res, next) => {
  try {
    const { portal, url, id } = req.query;
    const result = await scraperService.fetchJobDetail({ portal, url, id });

    if (!result.ok) {
      return res.status(200).json({ success: false, error: result.reason });
    }
    res.json({ success: true, detail: result.detail });
  } catch (err) {
    next(err);
  }
});

router.patch('/jobs/:id/state', validateBody(jobStateBody), (req, res, next) => {
  try {
    const result = storageService.setJobState(req.params.id, req.body.state);
    if (!result.updated) {
      return res.status(404).json({ success: false, error: 'Job not found in search history.' });
    }
    res.json({ success: true, state: req.body.state });
  } catch (err) {
    next(err);
  }
});

export default router;

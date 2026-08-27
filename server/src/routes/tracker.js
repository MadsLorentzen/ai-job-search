import express from 'express';
import { storageService, APPLICATION_STATUSES, CLOSED_STATUSES } from '../services/storageService.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { applicationBody, statusBody, trackerQuery } from '../validation/schemas.js';

const router = express.Router();

router.get('/', validateQuery(trackerQuery), (req, res, next) => {
  try {
    const applications = storageService.getApplications(req.query);
    const now = new Date().toISOString();

    res.json({
      success: true,
      statuses: APPLICATION_STATUSES,
      closedStatuses: CLOSED_STATUSES,
      // Surfaced so the client can flag what needs chasing without
      // recomputing the rule in two places.
      dueFollowUps: applications
        .filter(a => a.followUpAt && a.followUpAt <= now && !CLOSED_STATUSES.includes(a.status))
        .map(a => a.id),
      applications
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', validateBody(applicationBody), (req, res, next) => {
  try {
    // Zod strips unknown keys, so server-owned columns cannot arrive from a
    // client at all: they are absent from the schema, not merely ignored.
    res.json({ success: true, application: storageService.saveApplication(req.body) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', validateBody(applicationBody.partial().omit({ id: true })), (req, res, next) => {
  try {
    const { id } = req.params;
    if (!storageService.getApplication(id)) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }
    res.json({ success: true, application: storageService.saveApplication({ id, ...req.body }) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/status', validateBody(statusBody), (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const existing = storageService.getApplication(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    const update = { id, status };
    if (status === 'Applied' && !existing.appliedAt) {
      update.appliedAt = new Date().toISOString();
    }

    res.json({ success: true, application: storageService.saveApplication(update) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const result = storageService.deleteApplication(req.params.id);
    if (!result.deleted) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }
    res.json({ success: true, message: 'Application deleted.' });
  } catch (err) {
    next(err);
  }
});

export default router;

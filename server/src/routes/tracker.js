import express from 'express';
import { storageService, APPLICATION_STATUSES, CLOSED_STATUSES } from '../services/storageService.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { applicationBody, statusBody, trackerQuery } from '../validation/schemas.js';

const router = express.Router();

router.get('/', validateQuery(trackerQuery), (req, res, next) => {
  try {
    const context = { organizationId: req.organizationId, candidateId: req.user?.id, role: req.role };
    const applications = storageService.getApplications(req.query, context);
    const now = new Date().toISOString();

    res.json({
      success: true,
      statuses: APPLICATION_STATUSES,
      closedStatuses: CLOSED_STATUSES,
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
    const context = { organizationId: req.organizationId, candidateId: req.user?.id, role: req.role, req };
    res.json({ success: true, application: storageService.saveApplication(req.body, context) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', validateBody(applicationBody.partial().omit({ id: true })), (req, res, next) => {
  try {
    const { id } = req.params;
    const context = { organizationId: req.organizationId, candidateId: req.user?.id, role: req.role, req };
    if (!storageService.getApplication(id, context)) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }
    res.json({ success: true, application: storageService.saveApplication({ id, ...req.body }, context) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/status', validateBody(statusBody), (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const context = { organizationId: req.organizationId, candidateId: req.user?.id, role: req.role, req };

    const existing = storageService.getApplication(id, context);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    const update = { id, status };
    if (status === 'Applied' && !existing.appliedAt) {
      update.appliedAt = new Date().toISOString();
    }

    res.json({ success: true, application: storageService.saveApplication(update, context) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const context = { organizationId: req.organizationId, candidateId: req.user?.id, role: req.role, req };
    const result = storageService.deleteApplication(req.params.id, context);
    if (!result.deleted) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }
    res.json({ success: true, message: 'Application deleted.' });
  } catch (err) {
    next(err);
  }
});

export default router;

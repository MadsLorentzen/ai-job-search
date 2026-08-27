import express from 'express';
import { storageService, APPLICATION_STATUSES } from '../services/storageService.js';

const router = express.Router();

router.get('/', (req, res, next) => {
  try {
    res.json({
      success: true,
      statuses: APPLICATION_STATUSES,
      applications: storageService.getApplications()
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    // Strips server-owned fields (notably the PDF paths) before anything is
    // persisted, so a client cannot point a record at an arbitrary file.
    const clean = storageService.sanitizeApplicationInput(req.body);
    const saved = await storageService.saveApplication(clean);
    res.json({ success: true, application: saved });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!status) {
      return res.status(400).json({ success: false, error: 'Status is required.' });
    }
    if (!APPLICATION_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Unknown status "${status}". Expected one of: ${APPLICATION_STATUSES.join(', ')}.`
      });
    }

    const existing = storageService.getApplications().find(a => a.id === id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    const update = { id, status };
    if (status === 'Applied' && !existing.appliedAt) {
      update.appliedAt = new Date().toISOString();
    }

    const saved = await storageService.saveApplication(update);
    res.json({ success: true, application: saved });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await storageService.deleteApplication(req.params.id);
    if (result.deleted === 0) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }
    res.json({ success: true, message: 'Application deleted.' });
  } catch (err) {
    next(err);
  }
});

export default router;

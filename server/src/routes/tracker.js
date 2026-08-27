import express from 'express';
import { storageService } from '../services/storageService.js';

const router = express.Router();

// Get all applications
router.get('/', (req, res) => {
  try {
    const apps = storageService.getApplications();
    res.json({ success: true, applications: apps });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update or add an application
router.post('/', (req, res) => {
  try {
    const saved = storageService.saveApplication(req.body);
    res.json({ success: true, application: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update status of an application (e.g. Drafted -> Applied -> Interviewing -> Offer)
router.patch('/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ success: false, error: 'Status is required.' });
    }

    const apps = storageService.getApplications();
    const app = apps.find(a => a.id === id);

    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    app.status = status;
    if (status === 'Applied' && !app.appliedAt) {
      app.appliedAt = new Date().toISOString();
    }
    app.updatedAt = new Date().toISOString();

    storageService.saveApplication(app);
    res.json({ success: true, application: app });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete an application
router.delete('/:id', (req, res) => {
  try {
    storageService.deleteApplication(req.params.id);
    res.json({ success: true, message: 'Application deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

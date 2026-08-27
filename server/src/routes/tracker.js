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

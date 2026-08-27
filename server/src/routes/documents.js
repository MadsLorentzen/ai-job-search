import express from 'express';
import { getDb } from '../db/database.js';
import { storageService } from '../services/storageService.js';
import { recordAuditLog } from '../services/auditService.js';
import crypto from 'node:crypto';

const router = express.Router();

/**
 * Get all documents for current user / organization.
 */
router.get('/', (req, res, next) => {
  try {
    const { candidateId } = req.query;
    const effectiveCandidateId = candidateId && ['coach', 'recruiter', 'team_manager', 'support_admin', 'platform_admin'].includes(req.role)
      ? candidateId
      : req.user.id;

    const docs = storageService.getDocuments({
      organizationId: req.organizationId,
      candidateId: effectiveCandidateId
    });

    res.json({ success: true, documents: docs });
  } catch (err) {
    next(err);
  }
});

/**
 * Get single document with versions
 */
router.get('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND organization_id = ?').get(req.params.id, req.organizationId);
    if (!doc) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    let versions = [];
    if (doc.application_id) {
      versions = storageService.getDocumentVersions(doc.application_id, doc.doc_type);
    }

    res.json({ success: true, document: doc, versions });
  } catch (err) {
    next(err);
  }
});

/**
 * Update document review status
 */
router.patch('/:id/status', (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['draft', 'review_requested', 'approved', 'archived'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid document status' });
    }

    const db = getDb();
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT * FROM documents WHERE id = ? AND organization_id = ?').get(req.params.id, req.organizationId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    db.prepare('UPDATE documents SET status = ?, updated_at = ? WHERE id = ?').run(status, now, req.params.id);

    recordAuditLog({
      organizationId: req.organizationId,
      actorUserId: req.user.id,
      actorRole: req.role,
      action: 'document.status_change',
      entityType: 'document',
      entityId: req.params.id,
      diff: { oldStatus: existing.status, newStatus: status },
      req
    });

    res.json({ success: true, message: `Document status updated to ${status}` });
  } catch (err) {
    next(err);
  }
});

/**
 * Compare two LaTeX document versions
 */
router.post('/compare', (req, res) => {
  const { v1Latex = '', v2Latex = '' } = req.body;

  const lines1 = String(v1Latex).split('\n');
  const lines2 = String(v2Latex).split('\n');

  const diff = [];
  const maxLines = Math.max(lines1.length, lines2.length);

  for (let i = 0; i < maxLines; i++) {
    const l1 = lines1[i];
    const l2 = lines2[i];

    if (l1 === l2) {
      if (l1 !== undefined) diff.push({ type: 'unchanged', text: l1, line: i + 1 });
    } else {
      if (l1 !== undefined) diff.push({ type: 'removed', text: l1, line: i + 1 });
      if (l2 !== undefined) diff.push({ type: 'added', text: l2, line: i + 1 });
    }
  }

  res.json({
    success: true,
    totalChanges: diff.filter(d => d.type !== 'unchanged').length,
    diff
  });
});

export default router;

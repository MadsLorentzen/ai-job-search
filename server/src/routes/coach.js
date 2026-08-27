import express from 'express';
import { storageService } from '../services/storageService.js';
import { requireRole } from '../middleware/auth.js';
import { recordAuditLog } from '../services/auditService.js';
import { getDb } from '../db/database.js';
import crypto from 'node:crypto';

const router = express.Router();

// Coach routes require coach, recruiter, team_manager, support_admin, or platform_admin role
router.use(requireRole(['coach', 'recruiter', 'team_manager', 'support_admin', 'platform_admin']));

/**
 * Get assigned candidates for the calling coach/recruiter.
 */
router.get('/candidates', (req, res, next) => {
  try {
    const coachUserId = req.user.id;
    const organizationId = req.organizationId;
    const candidates = storageService.getAssignedCandidates(coachUserId, organizationId);
    res.json({ success: true, candidates });
  } catch (err) {
    next(err);
  }
});

/**
 * Get detailed pipeline, notes, and tasks for a specific candidate.
 */
router.get('/candidates/:candidateId', (req, res, next) => {
  try {
    const { candidateId } = req.params;
    const organizationId = req.organizationId;

    const profile = storageService.getProfile({ organizationId, userId: candidateId });
    const applications = storageService.getApplications({}, { organizationId, candidateId });
    const collaboration = storageService.getCandidateCollaboration(candidateId, organizationId);

    res.json({
      success: true,
      candidate: {
        id: candidateId,
        profile,
        applications,
        notes: collaboration.notes,
        tasks: collaboration.tasks
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Add a collaboration note / review feedback.
 */
router.post('/notes', (req, res, next) => {
  try {
    const { candidateId, applicationId, note, visibility } = req.body;
    if (!candidateId || !note) {
      return res.status(400).json({ success: false, error: 'candidateId and note are required' });
    }

    const created = storageService.addCollaborationNote({
      organizationId: req.organizationId,
      candidateId,
      applicationId,
      authorId: req.user.id,
      note,
      visibility: visibility || 'shared'
    });

    recordAuditLog({
      organizationId: req.organizationId,
      actorUserId: req.user.id,
      actorRole: req.role,
      action: 'coach.add_note',
      entityType: 'collaboration_note',
      entityId: created.id,
      diff: { candidateId, visibility },
      req
    });

    res.status(201).json({ success: true, note: created });
  } catch (err) {
    next(err);
  }
});

/**
 * Assign a task to a candidate.
 */
router.post('/tasks', (req, res, next) => {
  try {
    const { candidateId, title, description, dueDate } = req.body;
    if (!candidateId || !title) {
      return res.status(400).json({ success: false, error: 'candidateId and title are required' });
    }

    const task = storageService.addCollaborationTask({
      organizationId: req.organizationId,
      candidateId,
      assignerId: req.user.id,
      title,
      description,
      dueDate
    });

    recordAuditLog({
      organizationId: req.organizationId,
      actorUserId: req.user.id,
      actorRole: req.role,
      action: 'coach.assign_task',
      entityType: 'collaboration_task',
      entityId: task.id,
      diff: { candidateId, title, dueDate },
      req
    });

    res.status(201).json({ success: true, task });
  } catch (err) {
    next(err);
  }
});

/**
 * Update a task's status.
 */
router.patch('/tasks/:taskId', (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, error: 'status is required' });
    }

    storageService.updateCollaborationTask(taskId, { status });
    res.json({ success: true, message: 'Task updated' });
  } catch (err) {
    next(err);
  }
});

/**
 * Assign a candidate to a coach (Team Managers and Admins).
 */
router.post('/assign', requireRole(['team_manager', 'support_admin', 'platform_admin']), (req, res, next) => {
  try {
    const { candidateId, coachUserId } = req.body;
    if (!candidateId || !coachUserId) {
      return res.status(400).json({ success: false, error: 'candidateId and coachUserId are required' });
    }

    const db = getDb();
    const assignmentId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO candidate_coach_assignments
        (id, organization_id, candidate_id, coach_user_id, status, created_at)
      VALUES (?, ?, ?, ?, 'active', ?)
    `).run(assignmentId, req.organizationId, candidateId, coachUserId, now);

    recordAuditLog({
      organizationId: req.organizationId,
      actorUserId: req.user.id,
      actorRole: req.role,
      action: 'coach.assign_candidate',
      entityType: 'assignment',
      entityId: assignmentId,
      diff: { candidateId, coachUserId },
      req
    });

    res.status(201).json({ success: true, assignmentId });
  } catch (err) {
    next(err);
  }
});

export default router;

import express from 'express';
import { requireRole } from '../middleware/auth.js';
import { getAuditLogs, recordAuditLog } from '../services/auditService.js';
import { claudeService } from '../services/claudeService.js';
import { getDb } from '../db/database.js';
import { scraperService } from '../services/scraperService.js';

const router = express.Router();

// Admin routes require support_admin or platform_admin role
router.use(requireRole(['support_admin', 'platform_admin']));

/**
 * Platform Overview Metrics
 */
router.get('/overview', (req, res, next) => {
  try {
    const db = getDb();
    const totalOrgs = db.prepare('SELECT COUNT(*) as n FROM organizations WHERE deleted_at IS NULL').get().n;
    const totalUsers = db.prepare('SELECT COUNT(*) as n FROM users WHERE deleted_at IS NULL').get().n;
    const totalCandidates = db.prepare('SELECT COUNT(*) as n FROM candidate_profiles').get().n;
    const totalApps = db.prepare('SELECT COUNT(*) as n FROM applications WHERE deleted_at IS NULL').get().n;
    const totalDocVersions = db.prepare('SELECT COUNT(*) as n FROM document_versions').get().n;

    res.json({
      success: true,
      metrics: {
        totalOrganizations: totalOrgs,
        totalUsers,
        totalCandidates,
        totalApplications: totalApps,
        totalDocumentsGenerated: totalDocVersions,
        aiProvider: claudeService.getProviderName(),
        aiConfigured: claudeService.isConfigured()
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * List & search users
 */
router.get('/users', (req, res, next) => {
  try {
    const db = getDb();
    const search = req.query.search ? `%${req.query.search}%` : null;

    let query = `
      SELECT u.id, u.email, u.full_name, u.status, u.mfa_enabled, u.created_at, u.updated_at,
             m.role, o.id as organization_id, o.name as organization_name
      FROM users u
      LEFT JOIN memberships m ON m.user_id = u.id
      LEFT JOIN organizations o ON o.id = m.organization_id
      WHERE u.deleted_at IS NULL
    `;
    const params = [];
    if (search) {
      query += ' AND (u.email LIKE ? OR u.full_name LIKE ?)';
      params.push(search, search);
    }
    query += ' ORDER BY u.created_at DESC LIMIT 100';

    const users = db.prepare(query).all(...params);
    res.json({ success: true, users });
  } catch (err) {
    next(err);
  }
});

/**
 * Update user status or role
 */
router.patch('/users/:userId', (req, res, next) => {
  try {
    const { userId } = req.params;
    const { status, role } = req.body;
    const db = getDb();
    const now = new Date().toISOString();

    if (status) {
      db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, now, userId);
    }
    if (role) {
      db.prepare('UPDATE memberships SET role = ?, updated_at = ? WHERE user_id = ?').run(role, now, userId);
    }

    recordAuditLog({
      organizationId: req.organizationId,
      actorUserId: req.user.id,
      actorRole: req.role,
      action: 'admin.user_update',
      entityType: 'user',
      entityId: userId,
      diff: { status, role },
      req
    });

    res.json({ success: true, message: 'User updated successfully' });
  } catch (err) {
    next(err);
  }
});

/**
 * List organizations
 */
router.get('/organizations', (req, res, next) => {
  try {
    const db = getDb();
    const orgs = db.prepare(`
      SELECT o.*,
             (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id) as members_count,
             (SELECT COUNT(*) FROM candidate_profiles cp WHERE cp.organization_id = o.id) as candidates_count
      FROM organizations o
      WHERE o.deleted_at IS NULL
      ORDER BY o.created_at DESC
    `).all();

    res.json({ success: true, organizations: orgs });
  } catch (err) {
    next(err);
  }
});

/**
 * Query audit logs
 */
router.get('/audit-logs', (req, res, next) => {
  try {
    const { organizationId, entityType, entityId, actorUserId, limit, offset } = req.query;
    const logs = getAuditLogs({
      organizationId: organizationId || null,
      entityType: entityType || null,
      entityId: entityId || null,
      actorUserId: actorUserId || null,
      limit: Number(limit) || 50,
      offset: Number(offset) || 0
    });

    res.json({ success: true, logs });
  } catch (err) {
    next(err);
  }
});

/**
 * Job portal health and integration diagnostics
 */
router.get('/portals', (req, res, next) => {
  try {
    const availablePortals = scraperService.getAvailablePortals();
    res.json({
      success: true,
      portals: availablePortals,
      totalConfigured: availablePortals.length
    });
  } catch (err) {
    next(err);
  }
});

/**
 * AI Provider & token statistics
 */
router.get('/ai-stats', (req, res) => {
  res.json({
    success: true,
    provider: claudeService.getProviderName(),
    isConfigured: claudeService.isConfigured(),
    timestamp: new Date().toISOString()
  });
});

export default router;

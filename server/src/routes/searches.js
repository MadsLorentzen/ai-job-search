import express from 'express';
import { getDb } from '../db/database.js';
import { recordAuditLog } from '../services/auditService.js';
import crypto from 'node:crypto';

const router = express.Router();

/**
 * Get all saved searches & alert rules for the calling candidate.
 */
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const searches = db.prepare(`
      SELECT * FROM saved_searches
      WHERE organization_id = ? AND user_id = ?
      ORDER BY created_at DESC
    `).all(req.organizationId, req.user.id);

    res.json({
      success: true,
      searches: searches.map(s => ({
        ...s,
        title: s.name,
        portals: (() => { try { return JSON.parse(s.portals || '[]'); } catch { return []; } })(),
        filters: (() => { try { return JSON.parse(s.filters || '{}'); } catch { return {}; } })()
      }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Save a search query / alert rule.
 */
router.post('/', (req, res, next) => {
  try {
    const { title, query, location, portal, portals, filters = {}, alertFrequency = 'daily' } = req.body;
    if (!query) {
      return res.status(400).json({ success: false, error: 'query is required' });
    }

    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const portalsList = Array.isArray(portals) ? portals : [portal || 'freehire-search'];

    db.prepare(`
      INSERT INTO saved_searches
        (id, organization_id, user_id, name, query, location, portals, filters, alert_frequency, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      req.organizationId,
      req.user.id,
      title || query,
      query,
      location || '',
      JSON.stringify(portalsList),
      JSON.stringify(filters),
      alertFrequency,
      now,
      now
    );

    recordAuditLog({
      organizationId: req.organizationId,
      actorUserId: req.user.id,
      actorRole: req.role,
      action: 'saved_search.create',
      entityType: 'saved_search',
      entityId: id,
      diff: { query, location, alertFrequency },
      req
    });

    res.status(201).json({
      success: true,
      savedSearch: { id, title: title || query, query, location, portals: portalsList, alertFrequency, createdAt: now }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Update a saved search alert rule.
 */
router.patch('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const { alertFrequency, name, title } = req.body;
    const db = getDb();
    const now = new Date().toISOString();

    const assignments = ['updated_at = ?'];
    const params = [now];

    if (alertFrequency !== undefined) {
      assignments.push('alert_frequency = ?');
      params.push(alertFrequency);
    }
    if (name || title) {
      assignments.push('name = ?');
      params.push(name || title);
    }

    params.push(id, req.organizationId, req.user.id);
    db.prepare(`
      UPDATE saved_searches SET ${assignments.join(', ')}
      WHERE id = ? AND organization_id = ? AND user_id = ?
    `).run(...params);

    res.json({ success: true, message: 'Saved search updated' });
  } catch (err) {
    next(err);
  }
});

/**
 * Delete a saved search.
 */
router.delete('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDb();
    db.prepare(`
      DELETE FROM saved_searches
      WHERE id = ? AND organization_id = ? AND user_id = ?
    `).run(id, req.organizationId, req.user.id);

    res.json({ success: true, message: 'Saved search removed' });
  } catch (err) {
    next(err);
  }
});

export default router;

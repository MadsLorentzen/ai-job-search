import crypto from 'node:crypto';
import { getDb } from '../db/database.js';
import { loggerFor } from '../config/logger.js';

const log = loggerFor('audit');

/**
 * Audit Logging Service
 * Records mutations with actor attribution, entity linkage, and change diffs.
 */
export function recordAuditLog({
  organizationId = null,
  actorUserId = null,
  actorRole = null,
  action,
  entityType,
  entityId = null,
  diff = {},
  req = null,
  impersonatorId = null
}) {
  try {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const ipAddress = req?.ip || req?.headers?.['x-forwarded-for'] || null;
    const userAgent = req?.headers?.['user-agent'] || null;
    const orgId = organizationId || req?.organizationId || null;
    const userId = actorUserId || req?.user?.id || null;
    const role = actorRole || req?.role || null;
    const impersonator = impersonatorId || req?.impersonatorId || null;

    // Sanitize diff to prevent logging passwords/tokens
    /** @type {Record<string, any>} */
    const cleanDiff = { ...diff };
    delete cleanDiff.password;
    delete cleanDiff.password_hash;
    delete cleanDiff.token;
    delete cleanDiff.mfa_secret;

    db.prepare(`
      INSERT INTO audit_logs
        (id, organization_id, actor_user_id, actor_role, action, entity_type, entity_id, diff, ip_address, user_agent, impersonator_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      orgId,
      userId,
      role,
      action,
      entityType,
      entityId ? String(entityId) : null,
      JSON.stringify(cleanDiff),
      ipAddress,
      userAgent,
      impersonator,
      now
    );

    log.info({ action, entityType, entityId, userId, orgId }, 'audit log recorded');
    return id;
  } catch (err) {
    log.warn({ err: err.message, action, entityType }, 'failed to record audit log');
    return null;
  }
}

/**
 * Retrieve audit logs with optional filters and pagination.
 */
export function getAuditLogs({
  organizationId = null,
  entityType = null,
  entityId = null,
  actorUserId = null,
  limit = 50,
  offset = 0
} = {}) {
  const db = getDb();
  let query = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];

  if (organizationId) {
    query += ' AND organization_id = ?';
    params.push(organizationId);
  }
  if (entityType) {
    query += ' AND entity_type = ?';
    params.push(entityType);
  }
  if (entityId) {
    query += ' AND entity_id = ?';
    params.push(entityId);
  }
  if (actorUserId) {
    query += ' AND actor_user_id = ?';
    params.push(actorUserId);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Math.min(Math.max(1, Number(limit) || 50), 200), Math.max(0, Number(offset) || 0));

  const rows = db.prepare(query).all(...params);
  return rows.map(r => ({
    ...r,
    diff: (() => {
      try { return JSON.parse(r.diff); } catch (_) { return {}; }
    })()
  }));
}

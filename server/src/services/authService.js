import crypto from 'node:crypto';
import { getDb } from '../db/database.js';
import { hashPassword, verifyAgainstHash, verifyPassword as verifyLegacyPassword, issueToken, verifyToken } from '../middleware/auth.js';
import { recordAuditLog } from './auditService.js';
import { loggerFor } from '../config/logger.js';

const log = loggerFor('auth-service');

async function verifyUserPassword(password, storedHash) {
  if (!storedHash) return false;
  if (storedHash === 'legacy') {
    return verifyLegacyPassword(password);
  }
  return verifyAgainstHash(password, storedHash);
}

/**
 * Register a new user and create their primary organization (or join an existing one).
 */
export async function registerUser({
  email,
  password,
  fullName = '',
  organizationName = null,
  role = 'candidate',
  req = null
}) {
  const db = getDb();
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('Valid email address is required');
  }
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    throw new Error('A user with this email address already exists');
  }

  const userId = crypto.randomUUID();
  const orgId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);

  const orgName = organizationName || (fullName ? `${fullName}'s Workspace` : `${normalizedEmail.split('@')[0]}'s Workspace`);
  const orgSlug = `${normalizedEmail.split('@')[0].replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now().toString(36)}`;

  // Insert user
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, status, email_verified_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(userId, normalizedEmail, passwordHash, fullName, now, now, now);

  // Insert organization
  db.prepare(`
    INSERT INTO organizations (id, name, slug, type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(orgId, orgName, orgSlug, role === 'candidate' ? 'personal' : 'coaching_firm', now, now);

  // Insert membership
  db.prepare(`
    INSERT INTO memberships (id, organization_id, user_id, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(membershipId, orgId, userId, role, now, now);

  // Insert empty candidate profile if user is a candidate
  if (role === 'candidate') {
    db.prepare(`
      INSERT INTO candidate_profiles (id, organization_id, user_id, data, completeness_score, ats_score, created_at, updated_at)
      VALUES (?, ?, ?, '{}', 0, 0, ?, ?)
    `).run(profileId, orgId, userId, now, now);
  }

  recordAuditLog({
    organizationId: orgId,
    actorUserId: userId,
    actorRole: role,
    action: 'auth.register',
    entityType: 'user',
    entityId: userId,
    diff: { email: normalizedEmail, fullName, role, orgName },
    req
  });

  return {
    userId,
    organizationId: orgId,
    email: normalizedEmail,
    fullName,
    role
  };
}

/**
 * Authenticate a user by email and password.
 */
export async function authenticateUser({ email, password, req = null }) {
  const db = getDb();
  const normalizedEmail = (email || '').trim().toLowerCase();

  const user = db.prepare(`
    SELECT u.*, m.organization_id, m.role, o.name as organization_name
    FROM users u
    LEFT JOIN memberships m ON m.user_id = u.id
    LEFT JOIN organizations o ON o.id = m.organization_id
    WHERE u.email = ? AND u.deleted_at IS NULL
  `).get(normalizedEmail);

  if (!user) {
    recordAuditLog({
      action: 'auth.login_failed',
      entityType: 'user',
      diff: { email: normalizedEmail, reason: 'user_not_found' },
      req
    });
    return null;
  }

  if (user.status === 'suspended') {
    throw new Error('Account is suspended. Please contact support.');
  }

  const valid = await verifyUserPassword(password, user.password_hash);
  if (!valid) {
    recordAuditLog({
      organizationId: user.organization_id,
      actorUserId: user.id,
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: user.id,
      diff: { email: normalizedEmail, reason: 'invalid_password' },
      req
    });
    return null;
  }

  // Issue session token
  const { token, expiresAt } = issueToken();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO user_sessions (id, user_id, token_hash, ip_address, user_agent, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    user.id,
    tokenHash,
    req?.ip || null,
    req?.headers?.['user-agent'] || null,
    new Date(expiresAt).toISOString(),
    now
  );

  recordAuditLog({
    organizationId: user.organization_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'auth.login_success',
    entityType: 'user',
    entityId: user.id,
    req
  });

  return {
    token,
    expiresAt,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      avatarUrl: user.avatar_url,
      organizationId: user.organization_id,
      organizationName: user.organization_name,
      role: user.role || 'candidate',
      mfaEnabled: Boolean(user.mfa_enabled)
    }
  };
}

/**
 * Resolve authenticated user and tenant context from token.
 */
export function resolveUserFromToken(token) {
  if (!token || !verifyToken(token)) return null;

  const db = getDb();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const session = db.prepare(`
    SELECT s.id as session_id, s.expires_at, u.id as user_id, u.email, u.full_name, u.status,
           m.organization_id, m.role, m.permissions, o.name as organization_name, o.slug as organization_slug
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN memberships m ON m.user_id = u.id
    LEFT JOIN organizations o ON o.id = m.organization_id
    WHERE s.token_hash = ? AND u.deleted_at IS NULL
  `).get(tokenHash);

  if (!session) return null;
  if (session.status === 'suspended') return null;

  return {
    user: {
      id: session.user_id,
      email: session.email,
      fullName: session.full_name
    },
    organizationId: session.organization_id,
    organizationName: session.organization_name,
    organizationSlug: session.organization_slug,
    role: session.role || 'candidate',
    permissions: (() => {
      try { return JSON.parse(session.permissions || '[]'); } catch (_) { return []; }
    })(),
    sessionId: session.session_id
  };
}

/**
 * Revoke a user session (logout).
 */
export function revokeSession(token) {
  if (!token) return;
  const db = getDb();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(tokenHash);
}

import { getDb, transaction } from '../db/database.js';
import { ROOT_DIR } from '../config/env.js';
import { recordAuditLog } from './auditService.js';

export const APPLICATION_STATUSES = Object.freeze([
  'Drafted', 'Applied', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn'
]);

/** Statuses that represent a finished application, shown in a collapsed lane. */
export const CLOSED_STATUSES = Object.freeze(['Rejected', 'Withdrawn']);

export const SEEN_STATES = Object.freeze(['seen', 'applied', 'dismissed']);

const DEFAULT_PROFILE = {
  identity: {
    name: '', title: '', email: '', phone: '', location: '',
    linkedin: '', github: '', portfolio: '', summary: '',
    status: 'Actively Looking', languages: []
  },
  education: [],
  experience: [],
  skills: { primary: [], secondary: [], domain: [], tools: [] },
  starStories: [],
  targetQueries: [],
  salary: { minimum: '', target: '', currency: '' },
  onboardingComplete: false
};

export function calculateProfileCompleteness(profile) {
  let score = 0;
  const missing = [];

  const identity = profile.identity || {};
  if (identity.name && identity.name.trim()) score += 5; else missing.push('Full name');
  if (identity.email && identity.email.trim()) score += 5; else missing.push('Email address');
  if (identity.phone && identity.phone.trim()) score += 5; else missing.push('Phone number');
  if (identity.title && identity.title.trim()) score += 5; else missing.push('Job title');
  if (identity.summary && identity.summary.trim().length > 30) score += 5; else missing.push('Professional summary');

  if (Array.isArray(profile.experience) && profile.experience.length > 0) {
    score += 15;
    const hasHighlights = profile.experience.some(e => Array.isArray(e.highlights) && e.highlights.length > 0);
    if (hasHighlights) score += 15; else missing.push('Achievements and bullet points');
  } else {
    missing.push('Work experience history');
  }

  const primarySkills = profile.skills?.primary || [];
  if (Array.isArray(primarySkills) && primarySkills.length >= 3) {
    score += 15;
  } else {
    missing.push('At least 3 core technical skills');
  }
  if (profile.skills?.tools && Array.isArray(profile.skills.tools) && profile.skills.tools.length > 0) {
    score += 5;
  }

  if (Array.isArray(profile.education) && profile.education.length > 0) {
    score += 10;
  } else {
    missing.push('Education details');
  }

  if (Array.isArray(profile.starStories) && profile.starStories.length > 0) {
    score += 5;
  }

  if (Array.isArray(profile.targetQueries) && profile.targetQueries.length > 0) {
    score += 5;
  }

  if (profile.salary?.target) {
    score += 5;
  }

  const finalScore = Math.min(100, score);
  return {
    score: finalScore,
    missing,
    atsScore: Math.min(100, Math.round(finalScore * 0.85 + (primarySkills.length >= 5 ? 15 : 5)))
  };
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** Map a database row onto the shape the API and client speak. */
function rowToApplication(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    candidateId: row.candidate_id,
    jobTitle: row.job_title,
    company: row.company,
    location: row.location,
    jobUrl: row.job_url,
    status: row.status,
    fitScore: row.fit_score,
    reviewScore: row.review_score,
    cvLatex: row.cv_latex,
    coverLetterLatex: row.cover_letter_latex,
    auditsPassed: parseJson(row.audits_passed, []),
    revisionsApplied: parseJson(row.revisions_applied, []),
    notes: row.notes,
    followUpAt: row.follow_up_at,
    source: row.source,
    appliedAt: row.applied_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Columns a caller may set, and the API field each maps from. */
const APPLICATION_COLUMNS = {
  jobTitle: 'job_title',
  company: 'company',
  location: 'location',
  jobUrl: 'job_url',
  status: 'status',
  fitScore: 'fit_score',
  reviewScore: 'review_score',
  cvLatex: 'cv_latex',
  coverLetterLatex: 'cover_letter_latex',
  auditsPassed: 'audits_passed',
  revisionsApplied: 'revisions_applied',
  notes: 'notes',
  followUpAt: 'follow_up_at',
  source: 'source',
  appliedAt: 'applied_at',
  organizationId: 'organization_id',
  candidateId: 'candidate_id'
};

const JSON_FIELDS = new Set(['auditsPassed', 'revisionsApplied']);

export const storageService = {
  // ---- Profile ---------------------------------------------------------

  getProfile(context = {}) {
    const db = getDb();
    const { organizationId, userId } = context;

    if (organizationId && userId) {
      const candidateRow = db.prepare(`
        SELECT data, completeness_score, ats_score FROM candidate_profiles
        WHERE organization_id = ? AND user_id = ?
      `).get(organizationId, userId);

      if (candidateRow) {
        const prof = { ...structuredClone(DEFAULT_PROFILE), ...parseJson(candidateRow.data, {}) };
        prof.completeness = calculateProfileCompleteness(prof);
        return prof;
      }
    }

    const row = db.prepare('SELECT data FROM profile WHERE id = 1').get();
    if (!row) {
      const def = structuredClone(DEFAULT_PROFILE);
      def.completeness = calculateProfileCompleteness(def);
      return def;
    }
    const prof = { ...structuredClone(DEFAULT_PROFILE), ...parseJson(row.data, {}) };
    prof.completeness = calculateProfileCompleteness(prof);
    return prof;
  },

  saveProfile(profileData, context = {}) {
    const now = new Date().toISOString();
    const { organizationId, userId, req } = context;
    const completeness = calculateProfileCompleteness(profileData);

    return transaction((conn) => {
      // Always update single-tenant profile row for backward compatibility
      conn.prepare(`
        INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
      `).run(JSON.stringify(profileData), now);

      // If multi-tenant context present, also update candidate_profiles
      if (organizationId && userId) {
        conn.prepare(`
          INSERT INTO candidate_profiles (id, organization_id, user_id, data, completeness_score, ats_score, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data, completeness_score = excluded.completeness_score, ats_score = excluded.ats_score, updated_at = excluded.updated_at
        `).run(
          `prof-${userId}`,
          organizationId,
          userId,
          JSON.stringify(profileData),
          completeness.score,
          completeness.atsScore,
          now,
          now
        );
      }

      recordAuditLog({
        organizationId,
        actorUserId: userId,
        action: 'profile.update',
        entityType: 'profile',
        entityId: userId || '1',
        diff: { completenessScore: completeness.score },
        req
      });

      const res = { ...profileData, completeness };
      return res;
    });
  },

  // ---- Applications ----------------------------------------------------

  /** @param {{ status?: string, search?: string, followUpBefore?: string }} [filters] */
  getApplications({ status, search, followUpBefore } = {}, context = {}) {
    const where = ['deleted_at IS NULL'];
    const params = [];
    const { organizationId, candidateId, role } = context;

    if (organizationId) {
      where.push('organization_id = ?');
      params.push(organizationId);
    }
    if (candidateId && role === 'candidate') {
      where.push('candidate_id = ?');
      params.push(candidateId);
    }

    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    if (search) {
      where.push('(job_title LIKE ? OR company LIKE ? OR notes LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (followUpBefore) {
      where.push('follow_up_at IS NOT NULL AND follow_up_at <= ?');
      params.push(followUpBefore);
    }

    const sql = `SELECT * FROM applications
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY created_at DESC`;
    return getDb().prepare(sql).all(...params).map(rowToApplication);
  },

  getApplication(id, context = {}) {
    const { organizationId } = context;
    let sql = 'SELECT * FROM applications WHERE id = ? AND deleted_at IS NULL';
    const params = [id];
    if (organizationId) {
      sql += ' AND organization_id = ?';
      params.push(organizationId);
    }
    const row = getDb().prepare(sql).get(...params);
    return row ? rowToApplication(row) : null;
  },

  /**
   * Insert or update. Only the fields present in `fields` are written, so a
   * partial update cannot blank out columns it did not mention.
   */
  saveApplication(fields, context = {}) {
    const now = new Date().toISOString();
    const { organizationId, candidateId, req } = context;

    return transaction((conn) => {
      const exists = conn.prepare('SELECT status, organization_id, candidate_id FROM applications WHERE id = ?').get(fields.id);

      const assignments = [];
      const params = [];
      for (const [apiField, column] of Object.entries(APPLICATION_COLUMNS)) {
        if (fields[apiField] === undefined) continue;
        assignments.push(`${column} = ?`);
        const value = fields[apiField];
        params.push(JSON_FIELDS.has(apiField) ? JSON.stringify(value ?? []) : value);
      }

      if (exists) {
        assignments.push('updated_at = ?');
        params.push(now, fields.id);
        conn.prepare(`UPDATE applications SET ${assignments.join(', ')} WHERE id = ?`).run(...params);

        if (fields.status && fields.status !== exists.status) {
          recordAuditLog({
            organizationId: organizationId || exists.organization_id,
            actorUserId: candidateId,
            action: 'application.status_change',
            entityType: 'application',
            entityId: fields.id,
            diff: { oldStatus: exists.status, newStatus: fields.status },
            req
          });
        }
      } else {
        const orgId = fields.organizationId || organizationId || '00000000-0000-0000-0000-000000000001';
        const candId = fields.candidateId || candidateId || '00000000-0000-0000-0000-000000000002';
        conn.prepare(`
          INSERT INTO applications (id, organization_id, candidate_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        `).run(fields.id, orgId, candId, now, now);

        if (assignments.length) {
          assignments.push('updated_at = ?');
          params.push(now, fields.id);
          conn.prepare(`UPDATE applications SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
        }

        recordAuditLog({
          organizationId: orgId,
          actorUserId: candId,
          action: 'application.create',
          entityType: 'application',
          entityId: fields.id,
          diff: { jobTitle: fields.jobTitle, company: fields.company },
          req
        });
      }

      const row = conn.prepare('SELECT * FROM applications WHERE id = ?').get(fields.id);
      return rowToApplication(row);
    });
  },

  deleteApplication(id, context = {}) {
    const { organizationId, req } = context;
    return transaction((conn) => {
      const now = new Date().toISOString();
      const info = conn.prepare('UPDATE applications SET deleted_at = ? WHERE id = ?').run(now, id);
      recordAuditLog({
        organizationId,
        action: 'application.delete',
        entityType: 'application',
        entityId: id,
        req
      });
      return { success: true, deleted: Number(info.changes) };
    });
  },

  // ---- Document versions & Document Center --------------------------------

  addDocumentVersion(applicationId, docType, latex, context = {}) {
    const now = new Date().toISOString();
    const { organizationId, candidateId, userId, title } = context;

    return transaction((conn) => {
      conn.prepare(`
        INSERT INTO document_versions (application_id, doc_type, latex, created_at)
        VALUES (?, ?, ?, ?)
      `).run(applicationId, docType, latex, now);

      // Register in documents table for central document management
      if (organizationId && candidateId) {
        const docId = `doc-${crypto.randomUUID()}`;
        conn.prepare(`
          INSERT INTO documents
            (id, organization_id, candidate_id, application_id, doc_type, status, title, content_latex, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
        `).run(
          docId,
          organizationId,
          candidateId,
          applicationId,
          docType,
          title || `${docType.toUpperCase()} for ${applicationId}`,
          latex,
          userId || candidateId,
          now,
          now
        );
      }
    });
  },

  getDocumentVersions(applicationId, docType) {
    return getDb().prepare(`
      SELECT id, doc_type AS docType, latex, created_at AS createdAt
      FROM document_versions
      WHERE application_id = ? AND doc_type = ?
      ORDER BY id DESC
    `).all(applicationId, docType);
  },

  getDocuments(context = {}) {
    const db = getDb();
    const { organizationId, candidateId } = context;
    let query = 'SELECT * FROM documents WHERE 1=1';
    const params = [];
    if (organizationId) {
      query += ' AND organization_id = ?';
      params.push(organizationId);
    }
    if (candidateId) {
      query += ' AND candidate_id = ?';
      params.push(candidateId);
    }
    query += ' ORDER BY updated_at DESC';
    return db.prepare(query).all(...params);
  },

  // ---- Coach & Recruiter Collaboration ----------------------------------

  getAssignedCandidates(coachUserId, organizationId) {
    const db = getDb();
    return db.prepare(`
      SELECT u.id, u.email, u.full_name, u.status, cp.completeness_score, cp.ats_score,
             ca.status as assignment_status, ca.created_at as assigned_at,
             (SELECT COUNT(*) FROM applications a WHERE a.candidate_id = u.id AND a.deleted_at IS NULL) as applications_count,
             (SELECT COUNT(*) FROM applications a WHERE a.candidate_id = u.id AND a.status = 'Interviewing' AND a.deleted_at IS NULL) as interviews_count,
             (SELECT COUNT(*) FROM collaboration_tasks t WHERE t.candidate_id = u.id AND t.status != 'completed') as pending_tasks_count
      FROM candidate_coach_assignments ca
      JOIN users u ON u.id = ca.candidate_id
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id AND cp.organization_id = ca.organization_id
      WHERE ca.coach_user_id = ? AND ca.organization_id = ?
      ORDER BY ca.created_at DESC
    `).all(coachUserId, organizationId);
  },

  getCandidateCollaboration(candidateId, organizationId) {
    const db = getDb();
    const notes = db.prepare(`
      SELECT n.*, u.full_name as author_name
      FROM collaboration_notes n
      JOIN users u ON u.id = n.author_id
      WHERE n.candidate_id = ? AND n.organization_id = ?
      ORDER BY n.created_at DESC
    `).all(candidateId, organizationId);

    const tasks = db.prepare(`
      SELECT t.*, u.full_name as assigner_name
      FROM collaboration_tasks t
      JOIN users u ON u.id = t.assigner_id
      WHERE t.candidate_id = ? AND t.organization_id = ?
      ORDER BY t.created_at DESC
    `).all(candidateId, organizationId);

    return { notes, tasks };
  },

  addCollaborationNote({ organizationId, candidateId, applicationId, authorId, note, visibility = 'shared' }) {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO collaboration_notes
        (id, organization_id, candidate_id, application_id, author_id, note, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, organizationId, candidateId, applicationId || null, authorId, note, visibility, now, now);
    return { id, candidateId, authorId, note, visibility, createdAt: now };
  },

  addCollaborationTask({ organizationId, candidateId, assignerId, title, description = '', dueDate = null }) {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO collaboration_tasks
        (id, organization_id, candidate_id, assigner_id, title, description, status, due_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(id, organizationId, candidateId, assignerId, title, description, dueDate, now, now);
    return { id, candidateId, assignerId, title, description, status: 'pending', dueDate, createdAt: now };
  },

  updateCollaborationTask(taskId, { status }) {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE collaboration_tasks SET status = ?, updated_at = ? WHERE id = ?
    `).run(status, now, taskId);
    return { success: true };
  },

  // ---- Seen jobs -------------------------------------------------------

  /** Record that these postings were returned by a search. */
  markJobsSeen(jobs) {
    if (!jobs.length) return;
    const now = new Date().toISOString();

    transaction((conn) => {
      const stmt = conn.prepare(`
        INSERT INTO seen_jobs (id, portal, title, company, url, state, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, 'seen', ?, ?)
        ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen
      `);
      for (const job of jobs) {
        if (!job?.id) continue;
        stmt.run(job.id, job.portal || '', job.title || '', job.company || '', job.url || '', now, now);
      }
    });
  },

  setJobState(id, state) {
    const now = new Date().toISOString();
    return transaction((conn) => {
      const info = conn.prepare('UPDATE seen_jobs SET state = ?, last_seen = ? WHERE id = ?')
        .run(state, now, id);
      return { updated: Number(info.changes) };
    });
  },

  /** Map of job id to state, for the ids supplied. */
  getJobStates(ids) {
    if (!ids.length) return {};
    const placeholders = ids.map(() => '?').join(',');
    const rows = getDb()
      .prepare(`SELECT id, state, first_seen FROM seen_jobs WHERE id IN (${placeholders})`)
      .all(...ids);
    return Object.fromEntries(rows.map(r => [r.id, { state: r.state, firstSeen: r.first_seen }]));
  },

  getRootDir() {
    return ROOT_DIR;
  }
};

import { getDb, transaction } from '../db/database.js';
import { ROOT_DIR } from '../config/env.js';

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
  appliedAt: 'applied_at'
};

const JSON_FIELDS = new Set(['auditsPassed', 'revisionsApplied']);

export const storageService = {
  // ---- Profile ---------------------------------------------------------

  getProfile() {
    const row = getDb().prepare('SELECT data FROM profile WHERE id = 1').get();
    if (!row) return structuredClone(DEFAULT_PROFILE);
    return { ...structuredClone(DEFAULT_PROFILE), ...parseJson(row.data, {}) };
  },

  saveProfile(profileData) {
    const now = new Date().toISOString();
    return transaction((conn) => {
      conn.prepare(`
        INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
      `).run(JSON.stringify(profileData), now);
      return profileData;
    });
  },

  // ---- Applications ----------------------------------------------------

  /** @param {{ status?: string, search?: string, followUpBefore?: string }} [filters] */
  getApplications({ status, search, followUpBefore } = {}) {
    const where = [];
    const params = [];

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

  getApplication(id) {
    const row = getDb().prepare('SELECT * FROM applications WHERE id = ?').get(id);
    return row ? rowToApplication(row) : null;
  },

  /**
   * Insert or update. Only the fields present in `fields` are written, so a
   * partial update cannot blank out columns it did not mention.
   *
   * Filesystem paths are deliberately absent from APPLICATION_COLUMNS: they
   * are derived from the application id at read time, never stored from input.
   */
  saveApplication(fields) {
    const now = new Date().toISOString();

    return transaction((conn) => {
      const exists = conn.prepare('SELECT 1 FROM applications WHERE id = ?').get(fields.id);

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
      } else {
        conn.prepare(`
          INSERT INTO applications (id, created_at, updated_at) VALUES (?, ?, ?)
        `).run(fields.id, now, now);

        if (assignments.length) {
          assignments.push('updated_at = ?');
          params.push(now, fields.id);
          conn.prepare(`UPDATE applications SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
        }
      }

      const row = conn.prepare('SELECT * FROM applications WHERE id = ?').get(fields.id);
      return rowToApplication(row);
    });
  },

  deleteApplication(id) {
    return transaction((conn) => {
      const info = conn.prepare('DELETE FROM applications WHERE id = ?').run(id);
      return { success: true, deleted: Number(info.changes) };
    });
  },

  // ---- Document versions ----------------------------------------------

  addDocumentVersion(applicationId, docType, latex) {
    return transaction((conn) => {
      conn.prepare(`
        INSERT INTO document_versions (application_id, doc_type, latex, created_at)
        VALUES (?, ?, ?, ?)
      `).run(applicationId, docType, latex, new Date().toISOString());
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

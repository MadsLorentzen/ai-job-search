import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ensureDir } from '../config/env.js';
import { loggerFor } from '../config/logger.js';

const log = loggerFor('db');

const DB_FILE = process.env.DATABASE_FILE || path.join(DATA_DIR, 'jobsearch.db');
const LEGACY_PROFILE = path.join(DATA_DIR, 'profile.json');
const LEGACY_APPLICATIONS = path.join(DATA_DIR, 'applications.json');

let db = null;

/**
 * Schema.
 *
 * Replaces a pair of JSON files that were read, edited in memory and written
 * back whole on every mutation. That model lost records under concurrent
 * writes (worked around previously by serializing every write through one
 * promise chain), could not be queried, and kept no history. SQLite gives
 * real transactions, so the concurrency problem stops existing rather than
 * being managed.
 *
 * Documents are stored as JSON text in a single-row `profile` table and typed
 * columns elsewhere, which keeps the profile flexible while letting the
 * tracker and job-memory features query properly.
 */
const MIGRATIONS = [
  {
    version: 1,
    up: (conn) => {
      conn.exec(`
        CREATE TABLE profile (
          id         INTEGER PRIMARY KEY CHECK (id = 1),
          data       TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE applications (
          id                  TEXT PRIMARY KEY,
          job_title           TEXT NOT NULL DEFAULT '',
          company             TEXT NOT NULL DEFAULT '',
          location            TEXT NOT NULL DEFAULT '',
          job_url             TEXT NOT NULL DEFAULT '',
          status              TEXT NOT NULL DEFAULT 'Drafted',
          fit_score           INTEGER,
          review_score        INTEGER,
          cv_latex            TEXT,
          cover_letter_latex  TEXT,
          audits_passed       TEXT NOT NULL DEFAULT '[]',
          revisions_applied   TEXT NOT NULL DEFAULT '[]',
          notes               TEXT NOT NULL DEFAULT '',
          follow_up_at        TEXT,
          source              TEXT,
          applied_at          TEXT,
          created_at          TEXT NOT NULL,
          updated_at          TEXT NOT NULL
        );

        CREATE INDEX idx_applications_status ON applications(status);
        CREATE INDEX idx_applications_follow_up ON applications(follow_up_at);

        -- Remembers which postings have already been looked at, so searching
        -- twice does not present the same roles as though they were new.
        CREATE TABLE seen_jobs (
          id         TEXT PRIMARY KEY,
          portal     TEXT NOT NULL DEFAULT '',
          title      TEXT NOT NULL DEFAULT '',
          company    TEXT NOT NULL DEFAULT '',
          url        TEXT NOT NULL DEFAULT '',
          state      TEXT NOT NULL DEFAULT 'seen',
          first_seen TEXT NOT NULL,
          last_seen  TEXT NOT NULL
        );

        CREATE INDEX idx_seen_jobs_state ON seen_jobs(state);

        -- Every generated version of a document, so regenerating never
        -- silently discards hand edits.
        CREATE TABLE document_versions (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          application_id TEXT NOT NULL,
          doc_type       TEXT NOT NULL,
          latex          TEXT NOT NULL,
          created_at     TEXT NOT NULL,
          FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_doc_versions_app ON document_versions(application_id, doc_type);
      `);
    }
  },
  {
    version: 2,
    up: (conn) => {
      conn.exec(`
        -- Multi-tenant core tables
        CREATE TABLE IF NOT EXISTS organizations (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          slug       TEXT UNIQUE NOT NULL,
          type       TEXT NOT NULL DEFAULT 'personal',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS users (
          id                TEXT PRIMARY KEY,
          email             TEXT UNIQUE NOT NULL,
          password_hash     TEXT NOT NULL,
          full_name         TEXT NOT NULL DEFAULT '',
          avatar_url        TEXT,
          email_verified_at TEXT,
          mfa_secret        TEXT,
          mfa_enabled       INTEGER NOT NULL DEFAULT 0,
          status            TEXT NOT NULL DEFAULT 'active',
          created_at        TEXT NOT NULL,
          updated_at        TEXT NOT NULL,
          deleted_at        TEXT
        );

        CREATE TABLE IF NOT EXISTS memberships (
          id              TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          user_id         TEXT NOT NULL,
          role            TEXT NOT NULL DEFAULT 'candidate',
          permissions     TEXT NOT NULL DEFAULT '[]',
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL,
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS user_sessions (
          id          TEXT PRIMARY KEY,
          user_id     TEXT NOT NULL,
          token_hash  TEXT UNIQUE NOT NULL,
          ip_address  TEXT,
          user_agent  TEXT,
          expires_at  TEXT NOT NULL,
          created_at  TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS candidate_profiles (
          id                 TEXT PRIMARY KEY,
          organization_id    TEXT NOT NULL,
          user_id            TEXT NOT NULL,
          data               TEXT NOT NULL DEFAULT '{}',
          completeness_score INTEGER NOT NULL DEFAULT 0,
          ats_score          INTEGER NOT NULL DEFAULT 0,
          created_at         TEXT NOT NULL,
          updated_at         TEXT NOT NULL,
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS candidate_coach_assignments (
          id              TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          candidate_id    TEXT NOT NULL,
          coach_user_id   TEXT NOT NULL,
          status          TEXT NOT NULL DEFAULT 'active',
          created_at      TEXT NOT NULL,
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (candidate_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (coach_user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS collaboration_notes (
          id              TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          candidate_id    TEXT NOT NULL,
          application_id  TEXT,
          author_id       TEXT NOT NULL,
          note            TEXT NOT NULL,
          visibility      TEXT NOT NULL DEFAULT 'shared',
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS collaboration_tasks (
          id              TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          candidate_id    TEXT NOT NULL,
          assigner_id     TEXT NOT NULL,
          title           TEXT NOT NULL,
          description     TEXT NOT NULL DEFAULT '',
          status          TEXT NOT NULL DEFAULT 'pending',
          due_date        TEXT,
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS saved_searches (
          id              TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          user_id         TEXT NOT NULL,
          name            TEXT NOT NULL,
          query           TEXT NOT NULL DEFAULT '',
          location        TEXT NOT NULL DEFAULT '',
          portals         TEXT NOT NULL DEFAULT '[]',
          filters         TEXT NOT NULL DEFAULT '{}',
          alert_frequency TEXT NOT NULL DEFAULT 'none',
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS documents (
          id                 TEXT PRIMARY KEY,
          organization_id    TEXT NOT NULL,
          candidate_id       TEXT NOT NULL,
          application_id     TEXT,
          doc_type           TEXT NOT NULL,
          status             TEXT NOT NULL DEFAULT 'draft',
          title              TEXT NOT NULL DEFAULT '',
          content_latex      TEXT NOT NULL DEFAULT '',
          compiled_pdf_path  TEXT,
          version_number     INTEGER NOT NULL DEFAULT 1,
          created_by         TEXT,
          created_at         TEXT NOT NULL,
          updated_at         TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
          id              TEXT PRIMARY KEY,
          organization_id TEXT,
          actor_user_id   TEXT,
          actor_role      TEXT,
          action          TEXT NOT NULL,
          entity_type     TEXT NOT NULL,
          entity_id       TEXT,
          diff            TEXT NOT NULL DEFAULT '{}',
          ip_address      TEXT,
          user_agent      TEXT,
          impersonator_id TEXT,
          created_at      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS subscriptions (
          id              TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          plan            TEXT NOT NULL DEFAULT 'free',
          seat_count      INTEGER NOT NULL DEFAULT 1,
          ai_tokens_used  INTEGER NOT NULL DEFAULT 0,
          status          TEXT NOT NULL DEFAULT 'active',
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL
        );

        ALTER TABLE applications ADD COLUMN organization_id TEXT;
        ALTER TABLE applications ADD COLUMN candidate_id TEXT;
        ALTER TABLE applications ADD COLUMN deleted_at TEXT;

        ALTER TABLE seen_jobs ADD COLUMN organization_id TEXT;
        ALTER TABLE seen_jobs ADD COLUMN user_id TEXT;

        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_memberships_org_user ON memberships(organization_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_candidate_profiles_org_user ON candidate_profiles(organization_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_applications_org_candidate ON applications(organization_id, candidate_id);
        CREATE INDEX IF NOT EXISTS idx_documents_org_candidate ON documents(organization_id, candidate_id);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(organization_id);
      `);

      const defaultOrgId = '00000000-0000-0000-0000-000000000001';
      const defaultUserId = '00000000-0000-0000-0000-000000000002';
      const now = new Date().toISOString();

      conn.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, slug, type, created_at, updated_at)
        VALUES (?, 'Default Workspace', 'default', 'personal', ?, ?)
      `).run(defaultOrgId, now, now);

      conn.prepare(`
        INSERT OR IGNORE INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
        VALUES (?, 'admin@oppertunex.local', 'legacy', 'Default Admin', 'active', ?, ?)
      `).run(defaultUserId, now, now);

      conn.prepare(`
        INSERT OR IGNORE INTO memberships (id, organization_id, user_id, role, created_at, updated_at)
        VALUES ('00000000-0000-0000-0000-000000000003', ?, ?, 'platform_admin', ?, ?)
      `).run(defaultOrgId, defaultUserId, now, now);

      try {
        const legacyProf = conn.prepare('SELECT data FROM profile WHERE id = 1').get();
        if (legacyProf && legacyProf.data) {
          conn.prepare(`
            INSERT OR IGNORE INTO candidate_profiles (id, organization_id, user_id, data, created_at, updated_at)
            VALUES ('00000000-0000-0000-0000-000000000004', ?, ?, ?, ?, ?)
          `).run(defaultOrgId, defaultUserId, legacyProf.data, now, now);
        }
      } catch (_) {}

      conn.prepare(`
        UPDATE applications SET organization_id = ?, candidate_id = ?
        WHERE organization_id IS NULL OR organization_id = ''
      `).run(defaultOrgId, defaultUserId);

      conn.prepare(`
        UPDATE seen_jobs SET organization_id = ?, user_id = ?
        WHERE organization_id IS NULL OR organization_id = ''
      `).run(defaultOrgId, defaultUserId);
    }
  }
];

function currentVersion(conn) {
  return conn.prepare('PRAGMA user_version').get().user_version;
}

function runMigrations(conn) {
  for (const migration of MIGRATIONS) {
    if (currentVersion(conn) >= migration.version) continue;
    log.info({ version: migration.version }, 'applying migration');
    conn.exec('BEGIN');
    try {
      migration.up(conn);
      conn.exec(`PRAGMA user_version = ${migration.version}`);
      conn.exec('COMMIT');
    } catch (err) {
      conn.exec('ROLLBACK');
      throw err;
    }
  }
}

/**
 * One-time import of the pre-SQLite JSON files.
 * Renames them to .migrated afterwards so a later run does not re-import.
 */
function importLegacyJson(conn) {
  const hasProfile = conn.prepare('SELECT COUNT(*) AS n FROM profile').get().n > 0;
  const hasApps = conn.prepare('SELECT COUNT(*) AS n FROM applications').get().n > 0;
  if (hasProfile || hasApps) return;

  const now = new Date().toISOString();
  let imported = 0;

  if (fs.existsSync(LEGACY_PROFILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(LEGACY_PROFILE, 'utf-8'));
      conn.prepare('INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?)')
        .run(JSON.stringify(data), now);
      fs.renameSync(LEGACY_PROFILE, `${LEGACY_PROFILE}.migrated`);
      imported++;
    } catch (err) {
      log.warn({ err: err.message }, 'could not import legacy profile.json');
    }
  }

  if (fs.existsSync(LEGACY_APPLICATIONS)) {
    try {
      const apps = JSON.parse(fs.readFileSync(LEGACY_APPLICATIONS, 'utf-8'));
      const insert = conn.prepare(`
        INSERT OR REPLACE INTO applications
          (id, job_title, company, location, job_url, status, fit_score, review_score,
           cv_latex, cover_letter_latex, audits_passed, revisions_applied,
           notes, follow_up_at, source, applied_at, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      for (const a of Array.isArray(apps) ? apps : []) {
        if (!a?.id) continue;
        insert.run(
          a.id, a.jobTitle || '', a.company || '', a.location || '', a.jobUrl || '',
          a.status || 'Drafted',
          typeof a.fitScore === 'number' ? a.fitScore : null,
          typeof a.reviewScore === 'number' ? a.reviewScore : null,
          a.cvLatex || null, a.coverLetterLatex || null,
          JSON.stringify(a.auditsPassed || []), JSON.stringify(a.revisionsApplied || []),
          a.notes || '', a.followUpAt || null, a.source || null, a.appliedAt || null,
          a.createdAt || now, a.updatedAt || now
        );
        imported++;
      }
      fs.renameSync(LEGACY_APPLICATIONS, `${LEGACY_APPLICATIONS}.migrated`);
    } catch (err) {
      log.warn({ err: err.message }, 'could not import legacy applications.json');
    }
  }

  if (imported) log.info({ imported }, 'imported legacy JSON store into SQLite');
}

export function getDb() {
  if (db) return db;

  ensureDir(path.dirname(DB_FILE));
  db = new DatabaseSync(DB_FILE);

  // WAL lets reads proceed during a write; foreign_keys is off by default.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  runMigrations(db);
  importLegacyJson(db);
  return db;
}

/** Run fn inside a transaction, rolling back if it throws. */
export function transaction(fn) {
  const conn = getDb();
  conn.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(conn);
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

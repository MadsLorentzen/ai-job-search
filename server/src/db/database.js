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

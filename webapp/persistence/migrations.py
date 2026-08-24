from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
import json

from product.job_identity import (
    ApplicationIdentityResolution,
    compare_job_identities,
    job_identity,
)
from webapp.persistence.search_workspaces import DEFAULT_SEARCH_WORKSPACE_ID


SEARCH_WORKSPACES_MIGRATION_ID = "001_search_workspaces"
PROFILE_MANAGER_MIGRATION_ID = "002_evidence_profile_manager"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _execute_statements(conn: sqlite3.Connection, script: str) -> None:
    """Execute this migration's simple DDL without executescript's implicit commit."""

    for statement in script.split(";"):
        if statement.strip():
            conn.execute(statement)


def apply_migrations(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        "id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
    )
    conn.commit()
    migrations = (
        (SEARCH_WORKSPACES_MIGRATION_ID, _migrate_search_workspaces, True),
        (PROFILE_MANAGER_MIGRATION_ID, _migrate_evidence_profile_manager, False),
    )
    for migration_id, operation, disable_foreign_keys in migrations:
        if conn.execute(
            "SELECT 1 FROM schema_migrations WHERE id = ?", (migration_id,)
        ).fetchone():
            continue
        if disable_foreign_keys:
            conn.execute("PRAGMA foreign_keys = OFF")
        try:
            conn.execute("BEGIN IMMEDIATE")
            operation(conn)
            conn.execute(
                "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
                (migration_id, _now()),
            )
            violations = conn.execute("PRAGMA foreign_key_check").fetchall()
            if violations:
                raise sqlite3.IntegrityError(
                    f"migration {migration_id} created foreign-key violations: {violations!r}"
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            if disable_foreign_keys:
                conn.execute("PRAGMA foreign_keys = ON")


def _migrate_evidence_profile_manager(conn: sqlite3.Connection) -> None:
    _execute_statements(
        conn,
        """
        CREATE TABLE profile_source_settings (
            source_path TEXT PRIMARY KEY,
            included INTEGER NOT NULL CHECK (included IN (0, 1)),
            updated_at TEXT NOT NULL
        );

        CREATE TABLE profile_source_entries (
            entry_id TEXT PRIMARY KEY,
            source_path TEXT NOT NULL,
            entry_kind TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            occurrence INTEGER NOT NULL CHECK (occurrence >= 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (source_path, entry_kind, fingerprint, occurrence)
        );

        CREATE INDEX idx_profile_source_entries_lookup
            ON profile_source_entries(source_path, entry_kind, fingerprint, occurrence);
        """,
    )


def _migrate_search_workspaces(conn: sqlite3.Connection) -> None:
    now = _now()
    _execute_statements(conn,
        """
        CREATE TABLE search_workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
            revision INTEGER NOT NULL CHECK (revision >= 1),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            archived_at TEXT
        );

        CREATE TABLE search_workspace_user_profiles (
            search_workspace_id TEXT PRIMARY KEY REFERENCES search_workspaces(id),
            current_version_id TEXT NOT NULL REFERENCES user_profile_versions(id),
            revision INTEGER NOT NULL CHECK (revision >= 1),
            updated_at TEXT NOT NULL
        );

        CREATE TABLE search_workspace_user_profile_history (
            id TEXT PRIMARY KEY,
            search_workspace_id TEXT NOT NULL REFERENCES search_workspaces(id),
            version_id TEXT NOT NULL REFERENCES user_profile_versions(id),
            previous_version_id TEXT REFERENCES user_profile_versions(id),
            assigned_at TEXT NOT NULL
        );

        CREATE INDEX idx_search_workspace_profile_history
            ON search_workspace_user_profile_history(search_workspace_id, assigned_at);
        """
    )
    conn.execute(
        "INSERT INTO search_workspaces "
        "(id, name, status, revision, created_at, updated_at, archived_at) "
        "VALUES (?, 'Default search', 'active', 1, ?, ?, NULL)",
        (DEFAULT_SEARCH_WORKSPACE_ID, now, now),
    )
    legacy_pointer = conn.execute(
        "SELECT version_id, updated_at FROM current_user_profile WHERE id = 'current'"
    ).fetchone()
    if legacy_pointer:
        conn.execute(
            "INSERT INTO search_workspace_user_profiles "
            "(search_workspace_id, current_version_id, revision, updated_at) "
            "VALUES (?, ?, 1, ?)",
            (
                DEFAULT_SEARCH_WORKSPACE_ID,
                legacy_pointer["version_id"],
                legacy_pointer["updated_at"],
            ),
        )
        conn.execute(
            "INSERT INTO search_workspace_user_profile_history "
            "(id, search_workspace_id, version_id, previous_version_id, assigned_at) "
            "VALUES ('swuph_default_initial', ?, ?, NULL, ?)",
            (
                DEFAULT_SEARCH_WORKSPACE_ID,
                legacy_pointer["version_id"],
                legacy_pointer["updated_at"],
            ),
        )

    _rebuild_discovery_tables(conn)
    _execute_statements(conn,
        """
        CREATE TABLE application_workspace_job_identities (
            id TEXT PRIMARY KEY,
            application_workspace_id TEXT NOT NULL REFERENCES workspaces(id),
            source_record_key TEXT,
            canonical_url_key TEXT,
            weak_fallback_key TEXT NOT NULL,
            source_record_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (
                application_workspace_id, source_record_key,
                canonical_url_key, weak_fallback_key
            )
        );

        CREATE INDEX idx_application_identity_source_record
            ON application_workspace_job_identities(source_record_key);
        CREATE INDEX idx_application_identity_url
            ON application_workspace_job_identities(canonical_url_key);
        CREATE INDEX idx_application_identity_weak
            ON application_workspace_job_identities(weak_fallback_key);

        CREATE TABLE application_job_identity_conflicts (
            identity_key TEXT NOT NULL,
            key_type TEXT NOT NULL,
            application_workspace_id TEXT NOT NULL REFERENCES workspaces(id),
            detected_at TEXT NOT NULL,
            PRIMARY KEY (identity_key, application_workspace_id)
        );

        CREATE TABLE application_workspace_origins (
            id TEXT PRIMARY KEY,
            application_workspace_id TEXT NOT NULL REFERENCES workspaces(id),
            search_workspace_id TEXT NOT NULL REFERENCES search_workspaces(id),
            discovery_candidate_id TEXT NOT NULL,
            discovery_occurrence_id TEXT NOT NULL,
            discovery_run_id TEXT,
            promoted_at TEXT NOT NULL,
            UNIQUE (application_workspace_id, discovery_candidate_id),
            FOREIGN KEY (discovery_candidate_id, search_workspace_id)
                REFERENCES discovery_candidates(id, search_workspace_id),
            FOREIGN KEY (discovery_occurrence_id, search_workspace_id)
                REFERENCES discovery_occurrences(id, search_workspace_id),
            FOREIGN KEY (discovery_run_id, search_workspace_id)
                REFERENCES discovery_runs(id, search_workspace_id)
        );
        """
    )
    _backfill_application_identities(conn, now)
    _backfill_application_origins(conn, now)


def _rebuild_discovery_tables(conn: sqlite3.Connection) -> None:
    _execute_statements(conn,
        """
        CREATE TABLE discovery_runs_new (
            id TEXT PRIMARY KEY,
            search_workspace_id TEXT NOT NULL REFERENCES search_workspaces(id),
            user_profile_version_id TEXT NOT NULL REFERENCES user_profile_versions(id),
            user_profile_content_id TEXT NOT NULL,
            request_json TEXT NOT NULL,
            source_status_json TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            UNIQUE (id, search_workspace_id)
        );
        INSERT INTO discovery_runs_new
        SELECT id, 'search_default', user_profile_version_id, user_profile_content_id,
               request_json, source_status_json, status, created_at, completed_at
        FROM discovery_runs;

        CREATE TABLE discovery_candidates_new (
            id TEXT PRIMARY KEY,
            search_workspace_id TEXT NOT NULL REFERENCES search_workspaces(id),
            company TEXT NOT NULL,
            title TEXT NOT NULL,
            location TEXT,
            lifecycle_status TEXT NOT NULL,
            canonical_occurrence_id TEXT,
            promoted_workspace_id TEXT REFERENCES workspaces(id),
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (id, search_workspace_id)
        );
        INSERT INTO discovery_candidates_new
        SELECT id, 'search_default', company, title, location, lifecycle_status,
               canonical_occurrence_id, promoted_workspace_id, first_seen_at,
               last_seen_at, updated_at
        FROM discovery_candidates;

        CREATE TABLE discovery_occurrences_new (
            id TEXT PRIMARY KEY,
            search_workspace_id TEXT NOT NULL REFERENCES search_workspaces(id),
            candidate_id TEXT NOT NULL,
            run_id TEXT,
            source TEXT NOT NULL,
            source_record_id TEXT,
            source_url TEXT,
            source_record_json TEXT NOT NULL,
            captured_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (id, search_workspace_id),
            FOREIGN KEY (candidate_id, search_workspace_id)
                REFERENCES discovery_candidates_new(id, search_workspace_id),
            FOREIGN KEY (run_id, search_workspace_id)
                REFERENCES discovery_runs_new(id, search_workspace_id)
        );
        INSERT INTO discovery_occurrences_new
        SELECT id, 'search_default', candidate_id, run_id, source, source_record_id,
               source_url, source_record_json, captured_at, created_at
        FROM discovery_occurrences;

        CREATE TABLE discovery_candidate_keys_new (
            search_workspace_id TEXT NOT NULL REFERENCES search_workspaces(id),
            identity_key TEXT NOT NULL,
            candidate_id TEXT NOT NULL,
            key_type TEXT NOT NULL,
            PRIMARY KEY (search_workspace_id, identity_key),
            FOREIGN KEY (candidate_id, search_workspace_id)
                REFERENCES discovery_candidates_new(id, search_workspace_id)
        );
        INSERT INTO discovery_candidate_keys_new
        SELECT 'search_default', identity_key, candidate_id, key_type
        FROM discovery_candidate_keys;

        CREATE TABLE discovery_fit_results_new (
            id TEXT PRIMARY KEY,
            search_workspace_id TEXT NOT NULL REFERENCES search_workspaces(id),
            candidate_id TEXT NOT NULL,
            occurrence_id TEXT NOT NULL,
            request_json TEXT NOT NULL,
            result_json TEXT NOT NULL,
            fingerprints_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (id, search_workspace_id),
            FOREIGN KEY (candidate_id, search_workspace_id)
                REFERENCES discovery_candidates_new(id, search_workspace_id),
            FOREIGN KEY (occurrence_id, search_workspace_id)
                REFERENCES discovery_occurrences_new(id, search_workspace_id)
        );
        INSERT INTO discovery_fit_results_new
        SELECT id, 'search_default', candidate_id, occurrence_id, request_json,
               result_json, fingerprints_json, created_at
        FROM discovery_fit_results;

        CREATE TABLE current_discovery_fits_new (
            search_workspace_id TEXT NOT NULL REFERENCES search_workspaces(id),
            candidate_id TEXT PRIMARY KEY,
            fit_id TEXT NOT NULL,
            FOREIGN KEY (candidate_id, search_workspace_id)
                REFERENCES discovery_candidates_new(id, search_workspace_id),
            FOREIGN KEY (fit_id, search_workspace_id)
                REFERENCES discovery_fit_results_new(id, search_workspace_id)
        );
        INSERT INTO current_discovery_fits_new
        SELECT 'search_default', candidate_id, fit_id FROM current_discovery_fits;

        DROP TABLE current_discovery_fits;
        DROP TABLE discovery_fit_results;
        DROP TABLE discovery_candidate_keys;
        DROP TABLE discovery_occurrences;
        DROP TABLE discovery_candidates;
        DROP TABLE discovery_runs;

        ALTER TABLE discovery_runs_new RENAME TO discovery_runs;
        ALTER TABLE discovery_candidates_new RENAME TO discovery_candidates;
        ALTER TABLE discovery_occurrences_new RENAME TO discovery_occurrences;
        ALTER TABLE discovery_candidate_keys_new RENAME TO discovery_candidate_keys;
        ALTER TABLE discovery_fit_results_new RENAME TO discovery_fit_results;
        ALTER TABLE current_discovery_fits_new RENAME TO current_discovery_fits;

        CREATE INDEX idx_discovery_runs_workspace
            ON discovery_runs(search_workspace_id, created_at);
        CREATE INDEX idx_discovery_occurrences_candidate
            ON discovery_occurrences(search_workspace_id, candidate_id, created_at);
        CREATE INDEX idx_discovery_candidates_status
            ON discovery_candidates(search_workspace_id, lifecycle_status, updated_at);
        """
    )


def _source_record_from_job_snapshot(snapshot: dict) -> dict:
    ingestion = snapshot.get("metadata", {}).get("ingestion", {})
    record = {
        "source": snapshot.get("source", ""),
        "company": snapshot.get("company", ""),
        "title": snapshot.get("title", ""),
        "location": snapshot.get("location", ""),
    }
    if ingestion.get("source_record_id"):
        record["source_record_id"] = ingestion["source_record_id"]
    if snapshot.get("source_url"):
        record["source_url"] = snapshot["source_url"]
    # Preserve the fields used by the conservative weak-only identity
    # fingerprint.  Older application workspaces retain the normalized job
    # snapshot rather than the original source record, so omitting these
    # values would make an exact post-migration resubmission look ambiguous.
    for field in ("description", "raw_text", "employment_type"):
        if snapshot.get(field) is not None:
            record[field] = snapshot[field]
    return record


def _backfill_application_identities(conn: sqlite3.Connection, detected_at: str) -> None:
    rows = conn.execute(
        "SELECT w.id AS workspace_id, a.payload_json "
        "FROM workspaces w "
        "JOIN current_artifacts c ON c.workspace_id = w.id "
        "JOIN artifacts a ON a.id = c.artifact_id "
        "WHERE w.kind = 'job' AND c.artifact_type = 'job_posting_snapshot' "
        "ORDER BY w.created_at, w.id"
    ).fetchall()
    identities: list[tuple[str, dict, object]] = []
    for row in rows:
        source_record = _source_record_from_job_snapshot(json.loads(row["payload_json"]))
        identity = job_identity(source_record)
        identities.append((row["workspace_id"], source_record, identity))
        conn.execute(
            "INSERT INTO application_workspace_job_identities "
            "(id, application_workspace_id, source_record_key, canonical_url_key, "
            "weak_fallback_key, source_record_json, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                f"appident_migrated_{row['workspace_id']}",
                row["workspace_id"],
                identity.source_record_key,
                identity.canonical_url_key,
                identity.weak_fallback_key,
                json.dumps(source_record, ensure_ascii=False, sort_keys=True),
                detected_at,
            ),
        )

    for index, (left_workspace, _, left) in enumerate(identities):
        for right_workspace, _, right in identities[index + 1 :]:
            if compare_job_identities(left, right) is not ApplicationIdentityResolution.SAME:
                continue
            if left.source_record_key and left.source_record_key == right.source_record_key:
                key_type, identity_key = "source_record", left.source_record_key
            elif left.canonical_url_key and left.canonical_url_key == right.canonical_url_key:
                key_type, identity_key = "canonical_url", left.canonical_url_key
            else:
                key_type, identity_key = "normalized_fallback", left.weak_fallback_key
            for workspace_id in (left_workspace, right_workspace):
                conn.execute(
                    "INSERT OR IGNORE INTO application_job_identity_conflicts "
                    "(identity_key, key_type, application_workspace_id, detected_at) "
                    "VALUES (?, ?, ?, ?)",
                    (identity_key, key_type, workspace_id, detected_at),
                )


def _backfill_application_origins(conn: sqlite3.Connection, promoted_at: str) -> None:
    rows = conn.execute(
        "SELECT c.id AS candidate_id, c.promoted_workspace_id, "
        "c.canonical_occurrence_id, o.run_id "
        "FROM discovery_candidates c "
        "JOIN discovery_occurrences o ON o.id = c.canonical_occurrence_id "
        "WHERE c.promoted_workspace_id IS NOT NULL"
    ).fetchall()
    for row in rows:
        conn.execute(
            "INSERT OR IGNORE INTO application_workspace_origins "
            "(id, application_workspace_id, search_workspace_id, discovery_candidate_id, "
            "discovery_occurrence_id, discovery_run_id, promoted_at) "
            "VALUES (?, ?, 'search_default', ?, ?, ?, ?)",
            (
                f"apporigin_migrated_{row['candidate_id']}",
                row["promoted_workspace_id"],
                row["candidate_id"],
                row["canonical_occurrence_id"],
                row["run_id"],
                promoted_at,
            ),
        )

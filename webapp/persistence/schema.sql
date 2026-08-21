-- webapp/persistence/schema.sql
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'job',   -- 'job' or 'profile' — see Task 4/9 note
    company TEXT NOT NULL,
    title TEXT NOT NULL,
    workflow_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    artifact_type TEXT NOT NULL,
    content_id TEXT,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_workspace_type
    ON artifacts(workspace_id, artifact_type);

CREATE TABLE IF NOT EXISTS current_artifacts (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    artifact_type TEXT NOT NULL,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    PRIMARY KEY (workspace_id, artifact_type)
);

CREATE TABLE IF NOT EXISTS review_decisions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    review_item_type TEXT NOT NULL,
    source_artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    domain_item_id TEXT,
    disposition TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_decisions_workspace
    ON review_decisions(workspace_id, source_artifact_id);

CREATE TABLE IF NOT EXISTS workflow_events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    previous_status TEXT,
    new_status TEXT NOT NULL,
    effective_date TEXT NOT NULL,
    note TEXT,
    submitted_pack_artifact_id TEXT REFERENCES artifacts(id),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_events_workspace
    ON workflow_events(workspace_id);

-- Dependency fingerprints: for every artifact we persist, record the exact
-- content_id (or internal hash) of every direct upstream input that was
-- CONSUMED to produce it, captured at the moment of production. This is the
-- source of truth staleness reads from — never re-derived by guessing which
-- identity fields happen to exist inside a domain payload. See Task 8.
CREATE TABLE IF NOT EXISTS dependency_fingerprints (
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    upstream_artifact_type TEXT NOT NULL,
    upstream_content_id TEXT NOT NULL,
    PRIMARY KEY (artifact_id, upstream_artifact_type)
);

CREATE TABLE IF NOT EXISTS provider_audits (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    stage TEXT NOT NULL,
    request_artifact_id TEXT REFERENCES artifacts(id),
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_audits_workspace_stage
    ON provider_audits(workspace_id, stage);

-- User Profile is mutable search intent, deliberately separate from the
-- source-backed Evidence Profile and its claim artifacts. Versions are
-- append-only so discovery runs can fingerprint the exact preferences used.
CREATE TABLE IF NOT EXISTS user_profile_versions (
    id TEXT PRIMARY KEY,
    content_id TEXT NOT NULL UNIQUE,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS current_user_profile (
    id TEXT PRIMARY KEY CHECK (id = 'current'),
    version_id TEXT NOT NULL REFERENCES user_profile_versions(id),
    updated_at TEXT NOT NULL
);

-- Discovery records are deliberately separate from application workspaces.
-- A workspace is created only when the user explicitly promotes a candidate.
CREATE TABLE IF NOT EXISTS discovery_runs (
    id TEXT PRIMARY KEY,
    user_profile_version_id TEXT NOT NULL REFERENCES user_profile_versions(id),
    user_profile_content_id TEXT NOT NULL,
    request_json TEXT NOT NULL,
    source_status_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS discovery_candidates (
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    title TEXT NOT NULL,
    location TEXT,
    lifecycle_status TEXT NOT NULL,
    canonical_occurrence_id TEXT,
    promoted_workspace_id TEXT REFERENCES workspaces(id),
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discovery_occurrences (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES discovery_candidates(id),
    run_id TEXT REFERENCES discovery_runs(id),
    source TEXT NOT NULL,
    source_record_id TEXT,
    source_url TEXT,
    source_record_json TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_occurrences_candidate
    ON discovery_occurrences(candidate_id, created_at);

CREATE TABLE IF NOT EXISTS discovery_candidate_keys (
    identity_key TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES discovery_candidates(id),
    key_type TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_candidates_status
    ON discovery_candidates(lifecycle_status, updated_at);

CREATE TABLE IF NOT EXISTS discovery_fit_results (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES discovery_candidates(id),
    occurrence_id TEXT NOT NULL REFERENCES discovery_occurrences(id),
    request_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    fingerprints_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS current_discovery_fits (
    candidate_id TEXT PRIMARY KEY REFERENCES discovery_candidates(id),
    fit_id TEXT NOT NULL REFERENCES discovery_fit_results(id)
);

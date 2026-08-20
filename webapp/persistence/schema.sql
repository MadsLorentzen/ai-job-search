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

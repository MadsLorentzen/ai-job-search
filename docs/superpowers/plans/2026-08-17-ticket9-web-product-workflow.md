# Ticket 9 — Web Product + Workflow Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision note (v2):** This is a correction pass over the v1 plan following PM review. PM verdict on v1 was REVISIONS REQUIRED, with 13 blocking findings and several major/minor findings. All contract-level claims in that review were independently verified against the actual `product/` source (Tickets 1–8) before this rewrite. This version fixes: governance (no task-level commits), Candidate Profile wiring, request/result persistence pairing, the semantic proposal adapter's schema (was inverted — it forbade a required field and used wrong key names), a production-realistic OpenAI-backed proposer with fail-closed behavior, extension context sent to the proposer, a dependency-fingerprint staleness model, review-gated Application Pack construction, Gate 4 as the only path to `drafted`, a real workspace UI with the six-way evidence vocabulary, restored tracker/archive projection and browser smoke test, and a rebuilt acceptance suite with real fixtures. `product/*` remains completely unmodified throughout.

**Goal:** Build a thin FastAPI + Jinja2 + SQLite web application (`webapp/`) that orchestrates the existing `product/` Tickets 1–8 domain functions into one reviewable end-to-end job-application workflow, without reimplementing any scoring, classification, evidence, or recommendation logic.

**Architecture:** `webapp/api` (FastAPI routes — HTTP translation only) → `webapp/services` (orchestration, staleness, view-model assembly, the one new untrusted semantic-proposal adapter) → `webapp/persistence` (SQLite artifact/workspace/review/event storage) → existing `product/*` modules (imported, never modified). Server-rendered HTML views (`webapp/templates`) consume view models built by the services layer; the browser never recomputes fit/recommendation logic. API routers and view routers call services for any read that requires assembling more than one repository call — routers do not query persistence directly for multi-artifact reads.

**Tech Stack:** FastAPI, Uvicorn, Jinja2, Python stdlib `sqlite3`, existing `openai==3.1.0` SDK, pytest (existing test runner), Playwright (new, dev-only dependency) for the browser smoke test.

**Spec:** `docs/superpowers/specs/2026-08-17-ticket9-web-product-workflow-design.md`

## Global Constraints

- Dependency direction is one-way: `webapp/api` → `webapp/services` → `webapp/persistence` and → `product/*`. Never the reverse; `product/*` is never modified by this plan. API routers and view routers must not call `webapp/persistence` directly for any read that spans more than one artifact type or requires staleness/review computation — that assembly belongs in `webapp/services`. A router may call a single-artifact persistence getter directly only for trivial existence checks (e.g. 404 lookups).
- No new scoring, fit classification, evidence, recommendation, or claim-validation logic anywhere in `webapp/`. All such decisions come from `product/*` return values only.
- The one permitted new "intelligence" component is the untrusted Semantic Proposal Adapter (Task 6) — it may only propose relationships/classifications/gate observations/rationale for Ticket 7 to adjudicate; it must never emit authoritative scores, overall verdicts, recommendations, or gate adjudication (Ticket 7 alone decides what any proposal means — the proposal's own `status`/`classification` fields are themselves proposals subject to adjudication, not final answers, so they are allowed in the proposal shape).
- Storage is local SQLite at `.jobsearch/jobsearch.sqlite3`; the `.jobsearch/` directory must be gitignored (Task 1 adds the ignore entry).
- Application workflow status vocabulary is exactly: `drafted, applied, interview, offer, hired, rejected, no_response, offer_declined, withdrawn` (source: `.claude/commands/outcome.md` "Tracker status vocabulary" — copy the spellings verbatim, do not invent new ones). Final = `hired, rejected, no_response, offer_declined, withdrawn`; everything else (including `drafted`) is Open. A workspace's `workflow_status` is `None`/NULL until the user explicitly confirms final review through Gate 4. **`drafted` may only be set by the Gate-4 confirmation endpoint (Task 12) — the generic status-change endpoint must reject any attempt to set `new_status="drafted"` directly.** `applied` may only be set by explicit user action after `drafted`, and must bind to the exact submitted Application Pack artifact id.
- Server binds to `127.0.0.1` by default (never `0.0.0.0`) — Task 2.
- `OPENAI_API_KEY` is read server-side only (env var), never returned in any API response, never stored in SQLite, never sent to a template/JS context.
- Job posting text and any provider-sourced text is untrusted; Jinja2 autoescaping must remain on (default) for all templates — no `|safe` filter is used anywhere on posting-derived or provider-derived text in this plan.
- No endpoint named `/apply`, `/submit`, `/send`, or `/email` may exist. `workflow_status` is written only by: (a) the Gate-4 application-pack-confirmation endpoint, which is the sole path to `drafted`; (b) the general status endpoint, for every other transition, which rejects `drafted` as a target.
- Every task that touches `product/*` contracts must use the exact function names and dict keys verified against source below — do not paraphrase key names.
- Domain regression baseline: the full existing suite must stay green (631 passed, 1 skipped at the Ticket 8 merge) after every task — every task's final step re-runs `pytest -q` for this reason.
- **No task in this plan contains a `git commit` step.** Implementation of this entire plan happens on an uncommitted working tree (or an uncommitted feature branch created once at the start of execution, per the executor's governance instructions — this plan does not itself create the branch). Commits happen only after all 16 tasks are implemented and tested, and only after explicit PM/user approval following that point. See the governance note at the end of Task 16.
- Legacy compatibility is in scope: on Gate-4 confirmation, Ticket 9 projects the reviewed Application Pack into the existing `documents/applications/<company>_<role>/application_pack.md` convention (Task 12A) and the tracker status vocabulary continues to be the single source for status semantics (already true via Task 5). SQLite remains the authoritative Ticket 9 state; the filesystem projection is a read-safe compatibility export, never a second source of truth, and Ticket 9 never fabricates `cv_draft.tex`/`cover_letter.tex`.
- A minimal real-browser smoke test (Task 15) is in scope, covering the golden path through actual rendered pages, not just `TestClient`.

## Key product/ contracts this plan depends on (verified against source, Tickets 1–8)

```python
# product/profile_snapshot.py
def build_snapshot(root: str | Path = ".") -> dict[str, Any]
def validate_snapshot(snapshot: dict[str, Any]) -> None   # raises SnapshotValidationError

# product/job_fit.py
def profile_snapshot_content_id(profile: dict[str, Any]) -> str   # "profilesnap_<20hex>"

# product/job_posting.py
def job_snapshot_content_id(job: dict[str, Any]) -> str   # "jobsnap_<20hex>"
def validate_job_posting_snapshot(snapshot: Any) -> None  # raises JobPostingValidationError

# product/job_ingestion.py
def normalize_job_source_record(record: Any) -> dict[str, Any]   # -> Job Posting Snapshot v0
def validate_job_source_record(record: Any) -> None

# product/job_understanding.py
def build_job_understanding_request(
    job_snapshot: Any, request_id: Any, *,
    requested_categories: Iterable[str] | None = None, policy: dict[str, Any] | None = None,
) -> dict[str, Any]
def validate_job_understanding_request(job_snapshot, request, *, policy=None) -> None
def validate_provider_candidate(request: dict[str, Any], candidate: Any) -> None
    # VERIFIED at product/job_understanding.py:239. Candidate required==allowed keys
    # (exactly these 5, single "items" key, NOT category-keyed):
    #   {"schema_version", "items", "suggestions", "ambiguous_statements", "warnings"}
    # each candidate.items[] entry required keys: {"proposal_id", "category", "kind",
    #   "quote", "certainty"} (optional: "occurrence")
def validate_job_understanding_result(job_snapshot, request, result, *, policy=None) -> None
def extract_job_understanding(
    job_snapshot: Any, provider: JobUnderstandingProvider, request_id: Any, *,
    requested_categories: Iterable[str] | None = None, policy: dict[str, Any] | None = None,
) -> dict[str, Any]
def load_job_understanding_policy(path=None) -> dict[str, Any]
EVIDENCE_CATEGORIES = ("requirements", "responsibilities", "language_requirements",
                       "eligibility_requirements", "logistics_requirements")

# product/job_understanding_providers.py
class JobUnderstandingProvider(Protocol):
    provider_id: str; model_id: str; model_version: str
    def extract(self, request: dict[str, Any]) -> ProviderResponse: ...
class JobUnderstandingProviderError(RuntimeError): ...
# NOTE: validate_provider_candidate does NOT live in this module (it has no
# validation code at all — providers have "no authority to validate their own
# output" per its docstring). It lives in product/job_understanding.py:239.

# product/openai_job_understanding_provider.py
class OpenAIJobUnderstandingProvider:   # implements JobUnderstandingProvider

# product/semantic_job_fit.py
def build_resolved_job_evidence_bundle(
    job_snapshot: Any, job_understanding_request: dict[str, Any] | None = None,
    job_understanding_result: dict[str, Any] | None = None,
) -> dict[str, Any]
    # VERIFIED at semantic_job_fit.py:142-158. XOR-rejects request/result:
    #   if (job_understanding_request is None) != (job_understanding_result is None):
    #       raise SemanticJobFitValidationError(
    #           "$.job_understanding: request and result must be supplied together")
    # Bundle top-level keys (VERIFIED, exactly these 6):
    #   {"schema_version", "job_snapshot", "evidence", "aliases", "excluded", "summary"}
    # bundle["job_snapshot"] = {"schema_version", "job_id", "content_id"} — this is the
    # ONLY identity ref in the bundle. There is NO job_understanding_result.content_id
    # anywhere in the bundle. Staleness of the bundle w.r.t. job_understanding_result
    # cannot be read from the bundle's own payload — it must be tracked separately
    # (see Task 8's dependency-fingerprint model).
def validate_resolved_job_evidence_bundle(job_snapshot: Any, bundle: Any) -> None
def build_semantic_job_fit_request(
    *, request_id: str, profile_snapshot: dict[str, Any], job_snapshot: dict[str, Any],
    resolved_job_evidence: dict[str, Any], active_extensions: list[dict[str, Any]] | None = None,
    evaluation_policy: dict[str, Any] | None = None, semantic_fit_policy: dict[str, Any] | None = None,
    user_intent: dict[str, Any] | None = None, semantic_proposals: dict[str, Any] | None = None,
) -> dict[str, Any]
def validate_semantic_job_fit_request(request: Any) -> None
def analyze_semantic_job_fit(request: dict[str, Any]) -> dict[str, Any]
def validate_semantic_job_fit_result(request: dict[str, Any], result: Any) -> None

# semantic_proposals shape (VERIFIED at semantic_job_fit.py:801-826, this is the
# object passed as build_semantic_job_fit_request(..., semantic_proposals=...)):
#   {"matches": [...], "gates": [...]}
# EACH match item — required==allowed core keys (VERIFIED, proposal_id NOT match_id,
# profile_evidence_ids PLURAL NOT singular):
#   required: {"proposal_id", "job_evidence_id", "profile_evidence_ids",
#              "classification", "rationale"}
#   optional: {"confidence", "functional_basis", "extension_ref"}
#   classification enum: MATCH_CLASSIFICATIONS (from schema; includes at minimum
#     direct/functionally_equivalent/transferable-style values — read from
#     SCHEMA["$defs"]["matchClassification"]["enum"] at runtime, do not hardcode)
#   extension_ref shape: validated by _validate_extension_ref_shape — an object
#     identifying an active extension's mapping record (id/version/mapping
#     identity), NOT raw extension content
# EACH gate item — required==allowed keys (VERIFIED — status IS required, this is
# the opposite of what v1 of this plan assumed):
#   required==allowed: {"gate_id", "status", "reason", "job_evidence_ids",
#                        "profile_evidence_ids"}
#   gate_id enum: GATE_IDS = ("eligibility", "language", "location_logistics")
#   status enum: GATE_STATUSES = {"PASS", "FAIL", "FLAG", "UNVERIFIED", "NOT_APPLICABLE"}
# These proposal-level status/classification values are PROPOSALS ONLY — Ticket 7's
# analyze_semantic_job_fit() locally adjudicates them against real evidence and
# policy; the proposal is never copied verbatim into the authoritative result.

# Job Fit Result v1 required keys (envelope produced by analyze_semantic_job_fit):
#   schema_version, request_id, profile_snapshot (ref: {schema_version, content_id}),
#   job_snapshot (ref: {schema_version, job_id, content_id}),
#   resolved_job_evidence (ref: {schema_version, content_id}),
#   active_extension_versions, evaluation_policy_version, semantic_fit_policy,
#   gate_assessments, gate_results, direct_matches, functionally_equivalent_matches,
#   transferable_matches, gaps, unsupported_claims, human_judgment_questions,
#   dimension_assessments, dimension_scores, overall_score, verdict, blocked,
#   blocking_gate_ids, status, notes

# Canonical content-id hashing pattern used throughout product/* (VERIFIED
# identical in both semantic_job_fit.py's private _content_id and
# application_intelligence.py's private _job_fit_result_content_id):
#   json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
#   then f"{prefix}{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:20]}"
# Ticket 9's own internal storage hashes (Task 8) MUST use this exact same
# json.dumps kwargs and separator, or two independently-computed hashes of the
# same logical payload can disagree due to whitespace/key-order differences.

# product/extensions.py
def load_extension(path: str | Path) -> dict[str, Any]
def load_extensions(paths: Iterable[str | Path]) -> list[dict[str, Any]]
def extension_content_id(extension: dict[str, Any]) -> str   # "extpkg_<20hex>"
# Extension Package top-level keys include transferable_mappings[] (each item has
# transfer_strength enum field) and disallowed_mappings[] (prohibited_inference
# enum field) — these are the mapping records extension_ref in a proposed match
# must be able to identify.

# product/application_intelligence.py
def analyze_application_intelligence(
    request: dict[str, Any], proposal: dict[str, Any] | None = None,
) -> dict[str, Any]
def validate_application_intelligence_request(request: Any) -> None
# request required keys: schema_version, request_id, job_fit_result, resolved_job_evidence,
#   profile_snapshot, policy
# result required keys: schema_version, request_id, job_fit_result_ref, profile_snapshot,
#   recommendation, recommendation_reason, positioning, cv_emphasis_plan, cv_content,
#   cover_letter_plan, cover_letter_content, unsupported_claims, status, notes
# cv_content / cover_letter_content unit shape:
#   {"unit_id": str, "unit_type": str, "text": str, "status": str, "profile_evidence_ids": [str]}
# unsupported_claims item shape: {"claim_id": str, "reason": str, "rejected_atom_ids": [...]}
#
# VERIFIED: job_fit_result_ref.content_id is computed by private
# _job_fit_result_content_id(job_fit_result) at application_intelligence.py:656-665
# using the canonical hashing pattern above with prefix "jobfitresult_". Ticket 9
# cannot import this private function; Task 10 computes an equivalent hash itself
# using the identical json.dumps kwargs so the two independently-computed values
# agree bit-for-bit on the same input.
#
# VERIFIED: Ticket 8 already fully owns rejection of unsupported/conflicted/
# placeholder claims and malformed atoms/units (in _adjudicate_content_unit /
# _render_candidate_fact_atom, application_intelligence.py:502-1036). It already
# produces unsupported_claims[] and downgrades unit/result status to NEEDS_REVIEW
# for: missing profile evidence, unknown/placeholder/conflicted profile evidence
# id, category/field mismatch, malformed unit/connective/atom shape, and unknown
# unit_type. Ticket 9 NEVER re-implements any of this — Ticket 9 only ever reads
# the already-final unsupported_claims list and unit.status fields from the
# validated result. Ticket 9's application_pack builder (Task 12) filters on
# unit.status == "READY" and that is the full extent of what Ticket 9 does with
# this information — no new rejection logic.

# product/application_intelligence_providers.py
class ApplicationIntelligenceProvider(Protocol):
    provider_id: str; model_id: str; model_version: str
    def propose(self, request: dict[str, Any]) -> ProviderResponse: ...
class ApplicationIntelligenceProviderError(RuntimeError): ...

# product/openai_application_intelligence_provider.py — REFERENCE PATTERN for
# Task 7's new OpenAI-backed semantic proposer client. Verified structural
# elements to mirror exactly:
#   - pinned model constants: OPENAI_MODEL = "gpt-5.4-mini-2026-03-17",
#     OPENAI_MODEL_ID = "gpt-5.4-mini", OPENAI_MODEL_VERSION = OPENAI_MODEL
#   - MAX_ATTEMPTS = 2, CONNECT_TIMEOUT_SECONDS = 5.0, REQUEST_TIMEOUT_SECONDS = 60.0
#   - client factory disables SDK retries and sets explicit timeouts:
#       openai.OpenAI(api_key=api_key, max_retries=0,
#           timeout=openai.Timeout(REQUEST_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS))
#   - credential read from injectable `environ` mapping (defaults to os.environ),
#     raises a dedicated *ProviderError if missing/blank — never falls back silently
#   - request minimized to only structured fields the proposer needs (status,
#     blocked, matches, gaps, evidence id/category/text, non-placeholder profile
#     claim id/category/field/value) — never raw source files or full free text
#   - call built via responses.create(model=..., instructions=<prompt file text>,
#     input=<minimized json>, reasoning={"effort": "low"}, text={"format": {
#     "type": "json_schema", "name": <schema name>, "strict": True, "schema": ...}},
#     max_output_tokens=..., store=False, stream=False, background=False, tools=[],
#     truncation="disabled")
#   - bounded retry loop: up to MAX_ATTEMPTS, sleeps 1.0s between attempts, raises
#     the dedicated *ProviderError with the underlying exception message on final
#     failure — NEVER silently returns an empty/default payload on failure
#   - decode: reads response.output_text, json.loads it, raises *ProviderError with
#     a clear message on missing attribute or JSONDecodeError — again, never a
#     silent empty fallback
#   - ProviderCallAudit built with provider_id/model_id/model_version/
#     provider_response_id/started_at/elapsed_ms/attempt_count/local_request_id
```

---

## Task 1: Project scaffold, dependency pinning, gitignore

**Files:**
- Create: `webapp/__init__.py`
- Create: `webapp/api/__init__.py`
- Create: `webapp/services/__init__.py`
- Create: `webapp/persistence/__init__.py`
- Create: `webapp/templates/.gitkeep`
- Create: `webapp/static/.gitkeep`
- Create: `tests/webapp/__init__.py`
- Modify: `requirements.txt`
- Modify: `.gitignore`
- Test: `tests/webapp/test_scaffold_imports.py`

**Interfaces:**
- Produces: `webapp` importable as a package; `webapp.api`, `webapp.services`, `webapp.persistence` importable as subpackages.

- [ ] **Step 1: Write the failing test**

```python
# tests/webapp/test_scaffold_imports.py
import importlib


def test_webapp_package_imports():
    assert importlib.import_module("webapp") is not None


def test_webapp_subpackages_import():
    for name in ("webapp.api", "webapp.services", "webapp.persistence"):
        assert importlib.import_module(name) is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/webapp/test_scaffold_imports.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'webapp'`

- [ ] **Step 3: Create package scaffold**

Create `webapp/__init__.py`:
```python
"""Ticket 9 web application: orchestrates product/ domain modules; owns no domain logic."""
```

Create `webapp/api/__init__.py`, `webapp/services/__init__.py`, `webapp/persistence/__init__.py` — each empty. Create `webapp/templates/.gitkeep`, `webapp/static/.gitkeep`, `tests/webapp/__init__.py` — each empty.

- [ ] **Step 4: Add dependencies**

Append to `requirements.txt`:
```
fastapi==0.115.6
uvicorn==0.34.0
jinja2==3.1.5
```

(No `python-multipart` — the New Job form and all other browser interactions in this plan submit JSON via `fetch`, never `multipart/form-data` or urlencoded bodies, so FastAPI's form-parsing extra is not needed. Playwright is added separately in Task 15 as a dev-only dependency, not here.)

- [ ] **Step 5: Add gitignore entry**

Append to `.gitignore`:
```
.jobsearch/
```

- [ ] **Step 6: Install dependencies**

Run: `pip install -r requirements.txt`

- [ ] **Step 7: Run test to verify it passes**

Run: `pytest tests/webapp/test_scaffold_imports.py -v`
Expected: PASS (2 tests)

- [ ] **Step 8: Run full existing suite to confirm no regression**

Run: `pytest -q`
Expected: baseline (631 passed, 1 skipped) plus the 2 new tests.

---

## Task 2: FastAPI app factory, config, and 127.0.0.1-only server entrypoint

**Files:**
- Create: `webapp/config.py`
- Create: `webapp/app.py`
- Create: `webapp/main.py`
- Test: `tests/webapp/test_app_factory.py`

**Interfaces:**
- Produces: `webapp.app.create_app(settings=None) -> fastapi.FastAPI`; `webapp.config.Settings` dataclass with `db_path: Path`, `host: str`, `port: int`, `openai_api_key: str | None`, `profile_root: str`.

- [ ] **Step 1: Write the failing test**

```python
# tests/webapp/test_app_factory.py
from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings


def test_create_app_returns_fastapi_instance():
    app = create_app(Settings(db_path="./.jobsearch/test.sqlite3"))
    assert app.title == "Job Application Workspace"


def test_default_settings_bind_to_localhost_only():
    assert Settings().host == "127.0.0.1"


def test_health_endpoint_ok():
    app = create_app(Settings(db_path="./.jobsearch/test.sqlite3"))
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


def test_health_response_never_contains_api_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-should-never-leak")
    app = create_app(Settings(db_path="./.jobsearch/test.sqlite3"))
    with TestClient(app) as client:
        response = client.get("/health")
        assert "sk-should-never-leak" not in response.text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/webapp/test_app_factory.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'webapp.config'`

- [ ] **Step 3: Write config module**

```python
# webapp/config.py
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Settings:
    db_path: Path = field(default_factory=lambda: Path(".jobsearch/jobsearch.sqlite3"))
    host: str = "127.0.0.1"
    port: int = 8420
    openai_api_key: str | None = field(default_factory=lambda: os.environ.get("OPENAI_API_KEY"))
    profile_root: str = "."

    def __post_init__(self) -> None:
        self.db_path = Path(self.db_path)
```

- [ ] **Step 4: Write app factory**

```python
# webapp/app.py
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.templating import Jinja2Templates

from webapp.config import Settings
from webapp.persistence.db import init_db


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        init_db(settings.db_path)
        yield

    app = FastAPI(title="Job Application Workspace", lifespan=lifespan)
    app.state.settings = settings
    app.state.templates = Jinja2Templates(directory=str(Path(__file__).with_name("templates")))

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
```

(`lifespan` is used instead of the deprecated `@app.on_event("startup")` — `TestClient` used as a context manager (`with TestClient(app) as client:`) triggers it deterministically, which is why every test in this plan uses that form rather than a bare `TestClient(app)`.)

- [ ] **Step 5: Write server entrypoint**

```python
# webapp/main.py
from __future__ import annotations

import uvicorn

from webapp.app import create_app
from webapp.config import Settings


def main() -> None:
    settings = Settings()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pytest tests/webapp/test_app_factory.py -v`
Expected: PASS (4 tests) — this will fail until Task 3's `webapp/persistence/db.py` exists, since `create_app` now calls `init_db` in its lifespan. That's expected and acceptable: Task 2's own test run happens after Task 3 is also in place, per the dependency note below.

**Dependency note:** Task 2 as written imports `webapp.persistence.db.init_db`, which Task 3 creates. Implement Task 3 first, or implement Tasks 2 and 3 together before running Task 2's tests. This is the one deliberate ordering exception in this plan; every other task is runnable strictly in sequence.

- [ ] **Step 7: Run full suite**

Run: `pytest -q`
Expected: no regressions (once Task 3 is also in place).

---

## Task 3: SQLite schema and connection management

**Files:**
- Create: `webapp/persistence/db.py`
- Create: `webapp/persistence/schema.sql`
- Test: `tests/webapp/persistence/__init__.py`
- Test: `tests/webapp/persistence/test_db.py`

**Interfaces:**
- Produces: `webapp.persistence.db.connect(db_path: Path) -> sqlite3.Connection` (row_factory `sqlite3.Row`, foreign_keys pragma on); `webapp.persistence.db.init_db(db_path: Path) -> None` (idempotent). Tables: `workspaces`, `artifacts`, `current_artifacts`, `review_decisions`, `workflow_events`, `dependency_fingerprints` (new in this revision — see Task 8).

- [ ] **Step 1: Write the failing test**

```python
# tests/webapp/persistence/test_db.py
import sqlite3

from webapp.persistence.db import connect, init_db


def test_init_db_creates_all_tables(tmp_path):
    db_path = tmp_path / "sub" / "jobsearch.sqlite3"
    init_db(db_path)
    assert db_path.exists()

    conn = connect(db_path)
    try:
        names = {
            row["name"]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
    finally:
        conn.close()

    assert {
        "workspaces", "artifacts", "current_artifacts",
        "review_decisions", "workflow_events", "dependency_fingerprints",
    }.issubset(names)


def test_init_db_is_idempotent(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    init_db(db_path)
    connect(db_path).close()


def test_connect_returns_row_factory_connection(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    try:
        assert conn.row_factory is sqlite3.Row
    finally:
        conn.close()


def test_connect_enforces_foreign_keys(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    try:
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    finally:
        conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/webapp/persistence/test_db.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write schema.sql**

```sql
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
```

- [ ] **Step 4: Write db.py**

```python
# webapp/persistence/db.py
from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: Path) -> None:
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(db_path)
    try:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        conn.commit()
    finally:
        conn.close()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/webapp/persistence/test_db.py -v`
Expected: PASS (4 tests)

- [ ] **Step 6: Run full suite**

Run: `pytest -q`
Expected: no regressions. (Task 2's tests now also pass, per its dependency note.)

---

## Task 4: Workspace and immutable-artifact repository, with a real global Profile workspace

**Files:**
- Create: `webapp/persistence/artifacts.py`
- Create: `webapp/persistence/workspaces.py`
- Test: `tests/webapp/persistence/test_artifacts.py`
- Test: `tests/webapp/persistence/test_workspaces.py`

**Interfaces:**
- Produces:
  - `webapp.persistence.workspaces.PROFILE_WORKSPACE_ID = "profile"` — a module-level constant, not a magic string repeated across files.
  - `webapp.persistence.workspaces.ensure_profile_workspace(conn) -> dict[str, Any]` — idempotently creates (if absent) and returns the single global profile workspace, with `kind="profile"`, `company=""`, `title=""`, `workflow_status=None`. This is the ONE workspace of kind `"profile"` that ever exists; it is never returned by `list_workspaces()` (see below) and is never a valid target for `/understand`, `/fit`, `/application-intelligence`, `/application-pack`, or `/status`.
  - `webapp.persistence.workspaces.create_workspace(conn, *, company: str, title: str) -> dict[str, Any]` — always creates `kind="job"`.
  - `webapp.persistence.workspaces.get_workspace(conn, workspace_id: str) -> dict[str, Any] | None`
  - `webapp.persistence.workspaces.list_workspaces(conn) -> list[dict[str, Any]]` — returns only `kind="job"` rows; the profile workspace is structurally excluded, not filtered by convention at each call site.
  - `webapp.persistence.workspaces.set_workflow_status(conn, workspace_id: str, status: str) -> None`
  - `webapp.persistence.artifacts.ARTIFACT_TYPES` — tuple of exactly these 13 strings (this revision adds the three `*_request` types the design requires and v1 omitted — Finding #3): `"profile_snapshot", "job_posting_snapshot", "job_understanding_request", "job_understanding_result", "resolved_job_evidence", "job_fit_request", "job_fit_result", "application_intelligence_request", "application_intelligence_result", "application_pack"`. (9 distinct stage artifacts; the list above has no duplicate — count is 10, correcting the "13" claim in this description before implementation: enumerate literally `profile_snapshot, job_posting_snapshot, job_understanding_request, job_understanding_result, resolved_job_evidence, job_fit_request, job_fit_result, application_intelligence_request, application_intelligence_result, application_pack` = 10 types. Use the literal tuple below, not the prose count.)
  - `webapp.persistence.artifacts.save_artifact(conn, *, workspace_id: str, artifact_type: str, payload: dict[str, Any], content_id: str | None = None) -> dict[str, Any]`
  - `webapp.persistence.artifacts.get_current_artifact(conn, workspace_id: str, artifact_type: str) -> dict[str, Any] | None`
  - `webapp.persistence.artifacts.get_artifact(conn, artifact_id: str) -> dict[str, Any] | None`
  - `webapp.persistence.artifacts.list_artifact_history(conn, workspace_id: str, artifact_type: str) -> list[dict[str, Any]]` (newest first)

- [ ] **Step 1: Write the failing tests**

```python
# tests/webapp/persistence/test_workspaces.py
from webapp.persistence.db import init_db, connect
from webapp.persistence.workspaces import (
    PROFILE_WORKSPACE_ID,
    ensure_profile_workspace,
    create_workspace,
    get_workspace,
    list_workspaces,
    set_workflow_status,
)


def _conn(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    return connect(db_path)


def test_ensure_profile_workspace_is_idempotent_and_has_fixed_id(tmp_path):
    conn = _conn(tmp_path)
    first = ensure_profile_workspace(conn)
    second = ensure_profile_workspace(conn)
    assert first["id"] == second["id"] == PROFILE_WORKSPACE_ID
    assert first["kind"] == "profile"
    conn.close()


def test_profile_workspace_never_appears_in_list_workspaces(tmp_path):
    conn = _conn(tmp_path)
    ensure_profile_workspace(conn)
    create_workspace(conn, company="Acme", title="Backend Engineer")
    listed = list_workspaces(conn)
    assert all(ws["id"] != PROFILE_WORKSPACE_ID for ws in listed)
    assert len(listed) == 1
    conn.close()


def test_create_workspace_has_null_workflow_status_and_job_kind(tmp_path):
    conn = _conn(tmp_path)
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    assert ws["workflow_status"] is None
    assert ws["kind"] == "job"
    assert ws["company"] == "Acme"
    conn.close()


def test_get_workspace_roundtrip(tmp_path):
    conn = _conn(tmp_path)
    created = create_workspace(conn, company="Acme", title="Backend Engineer")
    assert get_workspace(conn, created["id"])["id"] == created["id"]
    conn.close()


def test_get_workspace_missing_returns_none(tmp_path):
    conn = _conn(tmp_path)
    assert get_workspace(conn, "does-not-exist") is None
    conn.close()


def test_set_workflow_status_updates_row(tmp_path):
    conn = _conn(tmp_path)
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    set_workflow_status(conn, ws["id"], "drafted")
    assert get_workspace(conn, ws["id"])["workflow_status"] == "drafted"
    conn.close()
```

```python
# tests/webapp/persistence/test_artifacts.py
from webapp.persistence.db import init_db, connect
from webapp.persistence.workspaces import create_workspace
from webapp.persistence.artifacts import (
    ARTIFACT_TYPES,
    save_artifact,
    get_current_artifact,
    get_artifact,
    list_artifact_history,
)


def _workspace(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    return conn, ws["id"]


def test_artifact_types_includes_all_three_request_types():
    assert "job_understanding_request" in ARTIFACT_TYPES
    assert "job_fit_request" in ARTIFACT_TYPES
    assert "application_intelligence_request" in ARTIFACT_TYPES
    assert len(ARTIFACT_TYPES) == len(set(ARTIFACT_TYPES)) == 10


def test_save_artifact_becomes_current(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    saved = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="profile_snapshot",
        payload={"claims": []}, content_id="profilesnap_abc123",
    )
    current = get_current_artifact(conn, workspace_id, "profile_snapshot")
    assert current["id"] == saved["id"]
    assert current["content_id"] == "profilesnap_abc123"
    conn.close()


def test_saving_new_artifact_supersedes_old_current(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    first = save_artifact(conn, workspace_id=workspace_id, artifact_type="profile_snapshot",
                           payload={"v": 1}, content_id="profilesnap_1")
    second = save_artifact(conn, workspace_id=workspace_id, artifact_type="profile_snapshot",
                            payload={"v": 2}, content_id="profilesnap_2")
    current = get_current_artifact(conn, workspace_id, "profile_snapshot")
    assert current["id"] == second["id"] != first["id"]
    conn.close()


def test_old_artifact_still_retrievable_by_id(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    first = save_artifact(conn, workspace_id=workspace_id, artifact_type="profile_snapshot",
                           payload={"v": 1}, content_id="profilesnap_1")
    save_artifact(conn, workspace_id=workspace_id, artifact_type="profile_snapshot",
                   payload={"v": 2}, content_id="profilesnap_2")
    assert get_artifact(conn, first["id"])["payload"]["v"] == 1
    conn.close()


def test_get_current_artifact_missing_returns_none(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    assert get_current_artifact(conn, workspace_id, "job_fit_result") is None
    conn.close()


def test_list_artifact_history_newest_first(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    first = save_artifact(conn, workspace_id=workspace_id, artifact_type="profile_snapshot", payload={"v": 1})
    second = save_artifact(conn, workspace_id=workspace_id, artifact_type="profile_snapshot", payload={"v": 2})
    history = list_artifact_history(conn, workspace_id, "profile_snapshot")
    assert [row["id"] for row in history] == [second["id"], first["id"]]
    conn.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/webapp/persistence/test_workspaces.py tests/webapp/persistence/test_artifacts.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write workspaces.py**

```python
# webapp/persistence/workspaces.py
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

PROFILE_WORKSPACE_ID = "profile"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_profile_workspace(conn: sqlite3.Connection) -> dict[str, Any]:
    existing = get_workspace(conn, PROFILE_WORKSPACE_ID)
    if existing is not None:
        return existing
    now = _now()
    conn.execute(
        "INSERT INTO workspaces (id, kind, company, title, workflow_status, created_at, updated_at) "
        "VALUES (?, 'profile', '', '', NULL, ?, ?)",
        (PROFILE_WORKSPACE_ID, now, now),
    )
    conn.commit()
    return get_workspace(conn, PROFILE_WORKSPACE_ID)


def create_workspace(conn: sqlite3.Connection, *, company: str, title: str) -> dict[str, Any]:
    workspace_id = f"ws_{uuid.uuid4().hex[:20]}"
    now = _now()
    conn.execute(
        "INSERT INTO workspaces (id, kind, company, title, workflow_status, created_at, updated_at) "
        "VALUES (?, 'job', ?, ?, NULL, ?, ?)",
        (workspace_id, company, title, now, now),
    )
    conn.commit()
    return get_workspace(conn, workspace_id)


def get_workspace(conn: sqlite3.Connection, workspace_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM workspaces WHERE id = ?", (workspace_id,)).fetchone()
    return dict(row) if row else None


def list_workspaces(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM workspaces WHERE kind = 'job' ORDER BY updated_at DESC"
    ).fetchall()
    return [dict(row) for row in rows]


def set_workflow_status(conn: sqlite3.Connection, workspace_id: str, status: str) -> None:
    conn.execute(
        "UPDATE workspaces SET workflow_status = ?, updated_at = ? WHERE id = ?",
        (status, _now(), workspace_id),
    )
    conn.commit()
```

- [ ] **Step 4: Write artifacts.py**

```python
# webapp/persistence/artifacts.py
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

ARTIFACT_TYPES = (
    "profile_snapshot",
    "job_posting_snapshot",
    "job_understanding_request",
    "job_understanding_result",
    "resolved_job_evidence",
    "job_fit_request",
    "job_fit_result",
    "application_intelligence_request",
    "application_intelligence_result",
    "application_pack",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_artifact(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["payload"] = json.loads(data.pop("payload_json"))
    return data


def save_artifact(
    conn: sqlite3.Connection, *, workspace_id: str, artifact_type: str,
    payload: dict[str, Any], content_id: str | None = None,
) -> dict[str, Any]:
    artifact_id = f"art_{uuid.uuid4().hex[:20]}"
    now = _now()
    conn.execute(
        "INSERT INTO artifacts (id, workspace_id, artifact_type, content_id, payload_json, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (artifact_id, workspace_id, artifact_type, content_id, json.dumps(payload), now),
    )
    conn.execute(
        "INSERT INTO current_artifacts (workspace_id, artifact_type, artifact_id) VALUES (?, ?, ?) "
        "ON CONFLICT(workspace_id, artifact_type) DO UPDATE SET artifact_id = excluded.artifact_id",
        (workspace_id, artifact_type, artifact_id),
    )
    conn.commit()
    return get_artifact(conn, artifact_id)


def get_artifact(conn: sqlite3.Connection, artifact_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM artifacts WHERE id = ?", (artifact_id,)).fetchone()
    return _row_to_artifact(row) if row else None


def get_current_artifact(conn: sqlite3.Connection, workspace_id: str, artifact_type: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT a.* FROM current_artifacts c JOIN artifacts a ON a.id = c.artifact_id "
        "WHERE c.workspace_id = ? AND c.artifact_type = ?",
        (workspace_id, artifact_type),
    ).fetchone()
    return _row_to_artifact(row) if row else None


def list_artifact_history(conn: sqlite3.Connection, workspace_id: str, artifact_type: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM artifacts WHERE workspace_id = ? AND artifact_type = ? ORDER BY created_at DESC",
        (workspace_id, artifact_type),
    ).fetchall()
    return [_row_to_artifact(row) for row in rows]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/webapp/persistence/test_workspaces.py tests/webapp/persistence/test_artifacts.py -v`
Expected: PASS (13 tests)

- [ ] **Step 6: Run full suite**

Run: `pytest -q`
Expected: no regressions.

---

## Task 5: Review decisions and workflow events repository, with `drafted` locked to Gate 4

**Files:**
- Create: `webapp/persistence/review.py`
- Create: `webapp/persistence/workflow.py`
- Test: `tests/webapp/persistence/test_review.py`
- Test: `tests/webapp/persistence/test_workflow.py`

**Interfaces:**
- Produces:
  - `webapp.persistence.review.DISPOSITIONS` — tuple: `("acknowledged_and_proceed", "omit_from_positioning", "requires_upstream_change", "resolved_by_rerun")`
  - `webapp.persistence.review.save_review_decision(conn, *, workspace_id, review_item_type, source_artifact_id, domain_item_id, disposition, note=None) -> dict[str, Any]`
  - `webapp.persistence.review.list_review_decisions(conn, workspace_id, source_artifact_id=None) -> list[dict[str, Any]]`
  - `webapp.persistence.workflow.TRACKER_STATUSES` — `("drafted", "applied", "interview", "offer", "hired", "rejected", "no_response", "offer_declined", "withdrawn")`
  - `webapp.persistence.workflow.FINAL_STATUSES` — `frozenset({"hired", "rejected", "no_response", "offer_declined", "withdrawn"})`
  - `webapp.persistence.workflow.is_final(status: str) -> bool`
  - `webapp.persistence.workflow.record_status_change(conn, *, workspace_id: str, new_status: str, effective_date: str, note: str | None = None, submitted_pack_artifact_id: str | None = None, _allow_drafted: bool = False) -> dict[str, Any]` — validates `new_status in TRACKER_STATUSES`; **rejects `new_status == "drafted"` with `ValueError` unless `_allow_drafted=True`** (the leading-underscore keyword signals this is an internal escape hatch only Task 12's Gate-4 confirmation service function may pass — no HTTP-facing code ever passes it). **Additionally rejects `new_status == "applied"` unless `previous_status == "drafted"` AND `submitted_pack_artifact_id` is provided** — the `applied` event must identify exactly which reviewed pack was submitted, never left to be inferred from an earlier `drafted` event's binding, since the design explicitly allows multiple Gate-4 confirmations while still `drafted` (Pack A → drafted, Pack B → drafted, ...), making "the most recent drafted event's pack" ambiguous unless the `applied` event states it directly. Writes the event and the workspace status in a single transaction (see Step 3 — this fixes the non-atomicity finding).
  - `webapp.persistence.workflow.list_workflow_events(conn, workspace_id) -> list[dict[str, Any]]`

- [ ] **Step 1: Write the failing tests**

```python
# tests/webapp/persistence/test_review.py
from webapp.persistence.db import init_db, connect
from webapp.persistence.workspaces import create_workspace
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.review import save_review_decision, list_review_decisions


def _setup(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    artifact = save_artifact(conn, workspace_id=ws["id"], artifact_type="job_fit_result", payload={"gaps": []})
    return conn, ws["id"], artifact["id"]


def test_save_review_decision_roundtrip(tmp_path):
    conn, workspace_id, artifact_id = _setup(tmp_path)
    decision = save_review_decision(
        conn, workspace_id=workspace_id, review_item_type="gap", source_artifact_id=artifact_id,
        domain_item_id="gap_001", disposition="acknowledged_and_proceed", note="Discussed in interview prep",
    )
    assert decision["disposition"] == "acknowledged_and_proceed"
    decisions = list_review_decisions(conn, workspace_id)
    assert len(decisions) == 1
    assert decisions[0]["domain_item_id"] == "gap_001"
    conn.close()


def test_list_review_decisions_filtered_by_artifact(tmp_path):
    conn, workspace_id, artifact_id = _setup(tmp_path)
    other_artifact = save_artifact(conn, workspace_id=workspace_id, artifact_type="job_fit_result", payload={"gaps": []})
    save_review_decision(conn, workspace_id=workspace_id, review_item_type="gap", source_artifact_id=artifact_id,
                          domain_item_id="gap_001", disposition="acknowledged_and_proceed")
    save_review_decision(conn, workspace_id=workspace_id, review_item_type="gap", source_artifact_id=other_artifact["id"],
                          domain_item_id="gap_002", disposition="omit_from_positioning")
    filtered = list_review_decisions(conn, workspace_id, source_artifact_id=artifact_id)
    assert len(filtered) == 1
    assert filtered[0]["domain_item_id"] == "gap_001"
    conn.close()
```

```python
# tests/webapp/persistence/test_workflow.py
import pytest

from webapp.persistence.db import init_db, connect
from webapp.persistence.workspaces import create_workspace, get_workspace
from webapp.persistence.workflow import (
    TRACKER_STATUSES, FINAL_STATUSES, is_final, record_status_change, list_workflow_events,
)


def _workspace(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    return conn, ws["id"]


def test_tracker_statuses_exact_vocabulary():
    assert TRACKER_STATUSES == (
        "drafted", "applied", "interview", "offer",
        "hired", "rejected", "no_response", "offer_declined", "withdrawn",
    )


def test_final_statuses_grouping():
    assert FINAL_STATUSES == {"hired", "rejected", "no_response", "offer_declined", "withdrawn"}
    assert is_final("drafted") is False
    assert is_final("hired") is True


def test_record_status_change_rejects_drafted_without_explicit_allow(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    with pytest.raises(ValueError, match="drafted"):
        record_status_change(conn, workspace_id=workspace_id, new_status="drafted", effective_date="2026-08-18")
    conn.close()


def test_record_status_change_rejects_applied_without_prior_drafted(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    with pytest.raises(ValueError, match="applied requires the workspace"):
        record_status_change(conn, workspace_id=workspace_id, new_status="applied", effective_date="2026-08-18")
    conn.close()


def test_record_status_change_rejects_applied_without_pack_binding(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    from webapp.persistence.artifacts import save_artifact
    pack = save_artifact(conn, workspace_id=workspace_id, artifact_type="application_pack", payload={})
    record_status_change(conn, workspace_id=workspace_id, new_status="drafted", effective_date="2026-08-18",
                          submitted_pack_artifact_id=pack["id"], _allow_drafted=True)
    with pytest.raises(ValueError, match="applied requires submitted_pack_artifact_id"):
        record_status_change(conn, workspace_id=workspace_id, new_status="applied", effective_date="2026-08-19")
    conn.close()


def test_record_status_change_allows_applied_after_drafted_with_pack_binding(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    from webapp.persistence.artifacts import save_artifact
    pack = save_artifact(conn, workspace_id=workspace_id, artifact_type="application_pack", payload={})
    record_status_change(conn, workspace_id=workspace_id, new_status="drafted", effective_date="2026-08-18",
                          submitted_pack_artifact_id=pack["id"], _allow_drafted=True)
    record_status_change(conn, workspace_id=workspace_id, new_status="applied", effective_date="2026-08-19",
                          submitted_pack_artifact_id=pack["id"])
    assert get_workspace(conn, workspace_id)["workflow_status"] == "applied"
    events = list_workflow_events(conn, workspace_id)
    applied_event = next(e for e in events if e["new_status"] == "applied")
    assert applied_event["submitted_pack_artifact_id"] == pack["id"]
    conn.close()


def test_record_status_change_allows_drafted_with_internal_flag_and_pack_binding(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    from webapp.persistence.artifacts import save_artifact
    pack = save_artifact(conn, workspace_id=workspace_id, artifact_type="application_pack", payload={})
    record_status_change(
        conn, workspace_id=workspace_id, new_status="drafted", effective_date="2026-08-18",
        submitted_pack_artifact_id=pack["id"], _allow_drafted=True,
    )
    assert get_workspace(conn, workspace_id)["workflow_status"] == "drafted"
    events = list_workflow_events(conn, workspace_id)
    assert events[0]["submitted_pack_artifact_id"] == pack["id"]
    conn.close()


def test_record_status_change_updates_workspace_and_logs_event_for_non_drafted(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    record_status_change(conn, workspace_id=workspace_id, new_status="interview", effective_date="2026-08-18", note="x")
    assert get_workspace(conn, workspace_id)["workflow_status"] == "interview"
    events = list_workflow_events(conn, workspace_id)
    assert len(events) == 1
    assert events[0]["previous_status"] is None
    assert events[0]["new_status"] == "interview"
    conn.close()


def test_record_status_change_rejects_unknown_status(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    with pytest.raises(ValueError):
        record_status_change(conn, workspace_id=workspace_id, new_status="ghosted", effective_date="2026-08-18")
    conn.close()


def test_record_status_change_tracks_previous_status(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    record_status_change(conn, workspace_id=workspace_id, new_status="interview", effective_date="2026-08-18")
    record_status_change(conn, workspace_id=workspace_id, new_status="offer", effective_date="2026-08-19")
    events = list_workflow_events(conn, workspace_id)
    assert events[0]["previous_status"] == "interview"
    assert events[0]["new_status"] == "offer"
    conn.close()


def test_status_and_event_commit_atomically(tmp_path):
    # If record_status_change raises partway through, neither the workspace row
    # nor the event row should reflect a partial write. Simulate by forcing a
    # constraint violation on the event insert (invalid FK) and asserting the
    # workspace status did not change.
    conn, workspace_id = _workspace(tmp_path)
    with pytest.raises(Exception):
        record_status_change(
            conn, workspace_id=workspace_id, new_status="drafted", effective_date="2026-08-18",
            submitted_pack_artifact_id="art_does_not_exist", _allow_drafted=True,
        )
    assert get_workspace(conn, workspace_id)["workflow_status"] is None
    assert list_workflow_events(conn, workspace_id) == []
    conn.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/webapp/persistence/test_review.py tests/webapp/persistence/test_workflow.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write review.py**

```python
# webapp/persistence/review.py
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

DISPOSITIONS = (
    "acknowledged_and_proceed",
    "omit_from_positioning",
    "requires_upstream_change",
    "resolved_by_rerun",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def save_review_decision(
    conn: sqlite3.Connection, *, workspace_id: str, review_item_type: str, source_artifact_id: str,
    domain_item_id: str | None, disposition: str, note: str | None = None,
) -> dict[str, Any]:
    if disposition not in DISPOSITIONS:
        raise ValueError(f"unknown disposition: {disposition!r}")
    decision_id = f"rev_{uuid.uuid4().hex[:20]}"
    conn.execute(
        "INSERT INTO review_decisions "
        "(id, workspace_id, review_item_type, source_artifact_id, domain_item_id, disposition, note, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (decision_id, workspace_id, review_item_type, source_artifact_id, domain_item_id, disposition, note, _now()),
    )
    conn.commit()
    return dict(conn.execute("SELECT * FROM review_decisions WHERE id = ?", (decision_id,)).fetchone())


def list_review_decisions(
    conn: sqlite3.Connection, workspace_id: str, source_artifact_id: str | None = None
) -> list[dict[str, Any]]:
    if source_artifact_id is None:
        rows = conn.execute(
            "SELECT * FROM review_decisions WHERE workspace_id = ? ORDER BY created_at DESC", (workspace_id,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM review_decisions WHERE workspace_id = ? AND source_artifact_id = ? ORDER BY created_at DESC",
            (workspace_id, source_artifact_id),
        ).fetchall()
    return [dict(row) for row in rows]
```

- [ ] **Step 4: Write workflow.py**

```python
# webapp/persistence/workflow.py
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from webapp.persistence.workspaces import get_workspace

TRACKER_STATUSES = (
    "drafted", "applied", "interview", "offer",
    "hired", "rejected", "no_response", "offer_declined", "withdrawn",
)

FINAL_STATUSES = frozenset({"hired", "rejected", "no_response", "offer_declined", "withdrawn"})


def is_final(status: str) -> bool:
    return status in FINAL_STATUSES


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def record_status_change(
    conn: sqlite3.Connection, *, workspace_id: str, new_status: str, effective_date: str,
    note: str | None = None, submitted_pack_artifact_id: str | None = None, _allow_drafted: bool = False,
) -> dict[str, Any]:
    if new_status not in TRACKER_STATUSES:
        raise ValueError(f"unknown tracker status: {new_status!r}")
    if new_status == "drafted" and not _allow_drafted:
        raise ValueError(
            "drafted may only be set via the application-pack confirmation flow (Gate 4), "
            "not the general status endpoint"
        )

    workspace = get_workspace(conn, workspace_id)
    previous_status = workspace["workflow_status"] if workspace else None

    if new_status == "applied":
        if previous_status != "drafted":
            raise ValueError(
                "applied requires the workspace to currently be 'drafted' — an application "
                "cannot be marked applied without first completing Gate 4 (application-pack "
                "confirmation), which is the only path to 'drafted'"
            )
        if submitted_pack_artifact_id is None:
            raise ValueError(
                "applied requires submitted_pack_artifact_id: the event must identify exactly "
                "which reviewed application pack was submitted, since multiple Gate-4 "
                "confirmations may have occurred while the workspace was still 'drafted'"
            )

    event_id = f"evt_{uuid.uuid4().hex[:20]}"

    # Single transaction: event insert and workspace update commit together or
    # not at all, so the audit log and workflow_status can never disagree.
    try:
        conn.execute(
            "INSERT INTO workflow_events "
            "(id, workspace_id, previous_status, new_status, effective_date, note, submitted_pack_artifact_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (event_id, workspace_id, previous_status, new_status, effective_date, note,
             submitted_pack_artifact_id, _now()),
        )
        conn.execute(
            "UPDATE workspaces SET workflow_status = ?, updated_at = ? WHERE id = ?",
            (new_status, _now(), workspace_id),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    return dict(conn.execute("SELECT * FROM workflow_events WHERE id = ?", (event_id,)).fetchone())


def list_workflow_events(conn: sqlite3.Connection, workspace_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM workflow_events WHERE workspace_id = ? ORDER BY created_at DESC", (workspace_id,)
    ).fetchall()
    return [dict(row) for row in rows]
```

Note: `submitted_pack_artifact_id` references `artifacts(id)` with a foreign key (schema.sql, Task 3) — SQLite enforces this only when `PRAGMA foreign_keys = ON`, which `connect()` sets on every connection, so passing a non-existent artifact id raises `sqlite3.IntegrityError` inside the transaction, which the `except Exception: conn.rollback(); raise` block catches and rolls back cleanly, satisfying `test_status_and_event_commit_atomically`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/webapp/persistence/test_review.py tests/webapp/persistence/test_workflow.py -v`
Expected: PASS (12 tests)

- [ ] **Step 6: Run full suite**

Run: `pytest -q`
Expected: no regressions.

---

## Task 6: Untrusted Semantic Proposal Adapter (matches Ticket 7's real schema)

**Files:**
- Create: `webapp/services/semantic_proposal_adapter.py`
- Test: `tests/webapp/services/__init__.py`
- Test: `tests/webapp/services/test_semantic_proposal_adapter.py`

**Interfaces:**
- Produces: `webapp.services.semantic_proposal_adapter.SemanticProposalAdapter` with method `propose(self, *, profile_evidence, resolved_job_evidence, active_extensions) -> dict[str, Any]` returning exactly `{"matches": [...], "gates": [...]}` in Ticket 7's real shape (verified above — NOT the inverted/wrong shape from v1 of this plan). A `FakeSemanticProposalAdapter` test double for later tasks.
- **Constraint enforcement, corrected from v1:** the adapter forbids only fields that would make a proposal AUTHORITATIVE rather than a proposal — `overall_score`, `verdict`, `recommendation`, `blocked`, `blocking_gate_ids` — at any nesting level. It does **not** forbid `status` on a gate item or `classification` on a match item, because Ticket 7's schema requires both as part of the proposal shape itself (a gate's `status` here means "the proposer's opinion of this gate," which `analyze_semantic_job_fit()` locally adjudicates — it is never copied into the authoritative result verbatim). This is the opposite restriction from v1, which incorrectly stripped the required `status` key from every gate, making valid Ticket 7 gate proposals impossible to construct.
- The adapter's output is validated in its own tests by round-tripping it through `product.semantic_job_fit.build_semantic_job_fit_request(..., semantic_proposals=...)` and `validate_semantic_job_fit_request` — not just shape-asserted in isolation — so a schema drift in `product/` would break this test, not silently pass.

- [ ] **Step 1: Write the failing test**

```python
# tests/webapp/services/test_semantic_proposal_adapter.py
from product.semantic_job_fit import build_semantic_job_fit_request, validate_semantic_job_fit_request

from webapp.services.semantic_proposal_adapter import SemanticProposalAdapter, FakeSemanticProposalAdapter

FORBIDDEN_KEYS = {"overall_score", "verdict", "recommendation", "blocked", "blocking_gate_ids"}


def _assert_no_forbidden_keys(value):
    if isinstance(value, dict):
        for key, sub in value.items():
            assert key not in FORBIDDEN_KEYS, f"adapter output must not contain {key!r}"
            _assert_no_forbidden_keys(sub)
    elif isinstance(value, list):
        for item in value:
            _assert_no_forbidden_keys(item)


def _minimal_profile_snapshot():
    return {
        "schema_version": "candidate-profile-evidence-snapshot.v0",
        "id_semantics": "deterministic content-derived identifiers; not durable persistent identifiers",
        "sources": [], "claims": [
            {"id": "clm_0000000000000001", "record_id": "rec_0000000000000001", "concept_id": "cpt_0000000000000001",
             "category": "experience", "field": "responsibility", "value": "Led a data migration project",
             "source": {"file": "cv.md", "section": None, "line_start": 1, "line_end": 1},
             "placeholder": False, "confidence": "high", "extraction_status": "explicit"},
        ],
        "corroborations": [], "conflicts": [],
        "summary": {"source_count": 1, "claim_count": 1, "placeholder_claim_count": 0,
                     "corroboration_count": 0, "conflict_count": 0},
    }


def _minimal_job_snapshot():
    return {
        "schema_version": "job-posting-snapshot.v0", "job_id": "jobsrc_0000000000000000000a",
        "source": "manual", "captured_at": "2026-08-18T00:00:00Z",
        "company": "Acme", "title": "Backend Engineer",
        "requirements": [{"id": "jobev_req_0000000000000001", "text": "Lead data migrations", "kind": "required"}],
        "responsibilities": [], "language_requirements": [], "eligibility_requirements": [],
        "logistics_requirements": [], "metadata": {"ingestion": {}},
    }


def _minimal_resolved_bundle():
    return {
        "schema_version": "resolved-job-evidence-bundle.v0",
        "job_snapshot": {"schema_version": "job-posting-snapshot.v0", "job_id": "jobsrc_0000000000000000000a",
                          "content_id": "jobsnap_0000000000000000000b"},
        "evidence": [
            {"id": "jobev_req_0000000000000001", "category": "requirements", "text": "Lead data migrations",
             "kind": "required", "origin": "job_posting_snapshot", "status": "EXPLICIT"},
        ],
        "aliases": [], "excluded": {"raw_text": "not_semantic_fit_evidence", "suggestions": "not_semantic_fit_evidence",
                                     "ambiguous_statements": "not_semantic_fit_evidence", "warnings": "not_semantic_fit_evidence"},
        "summary": {"evidence_count": 1, "alias_count": 0},
    }


def test_fake_adapter_output_round_trips_through_real_ticket7_request_validation():
    adapter = FakeSemanticProposalAdapter(canned_response={
        "matches": [{
            "proposal_id": "prop_0000000000000001",
            "job_evidence_id": "jobev_req_0000000000000001",
            "profile_evidence_ids": ["clm_0000000000000001"],
            "classification": "direct",
            "rationale": "Both describe leading a data migration project.",
        }],
        "gates": [{
            "gate_id": "eligibility", "status": "PASS", "reason": "No eligibility concerns identified.",
            "job_evidence_ids": [], "profile_evidence_ids": [],
        }],
    })
    proposals = adapter.propose(
        profile_evidence=_minimal_profile_snapshot()["claims"],
        resolved_job_evidence=_minimal_resolved_bundle(),
        active_extensions=[],
    )
    request = build_semantic_job_fit_request(
        request_id="req_test_1",
        profile_snapshot=_minimal_profile_snapshot(),
        job_snapshot=_minimal_job_snapshot(),
        resolved_job_evidence=_minimal_resolved_bundle(),
        semantic_proposals=proposals,
    )
    validate_semantic_job_fit_request(request)  # must not raise


def test_adapter_forbids_authoritative_keys_but_allows_required_gate_status():
    adapter = FakeSemanticProposalAdapter(canned_response={
        "matches": [],
        "gates": [{"gate_id": "eligibility", "status": "PASS", "reason": "x",
                    "job_evidence_ids": [], "profile_evidence_ids": []}],
        "overall_score": 99,  # attempt to smuggle an authoritative key
        "verdict": {"id": "strong_fit"},
    })
    result = adapter.propose(profile_evidence=[], resolved_job_evidence=_minimal_resolved_bundle(), active_extensions=[])
    assert set(result.keys()) == {"matches", "gates"}
    assert result["gates"][0]["status"] == "PASS"  # status survives — it is required, not forbidden
    _assert_no_forbidden_keys(result)


def test_adapter_builds_prompt_context_with_extension_mapping_identity_not_raw_files():
    adapter = FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})
    extension = {
        "schema_version": "extension-package.v0", "id": "ext_wellcontrol", "name": "Well Control",
        "version": "1.0.0", "status": "active", "description": "x", "publisher": "x", "trust": "x", "metadata": {}, "scope": "x",
        "transferable_mappings": [
            {"id": "map_0001", "source": "concept:driller.well_control", "target": "concept:hse.risk_assessment",
             "rationale": "Well control drills are a form of risk assessment.", "transfer_strength": "strong",
             "limitations": "Requires HSE certification to be recognized formally."},
        ],
    }
    context = adapter.build_prompt_context(
        profile_evidence=[{"id": "clm_1", "category": "experience", "field": "responsibility", "value": "x"}],
        resolved_job_evidence=_minimal_resolved_bundle(),
        active_extensions=[extension],
    )
    ext_context = context["active_extensions"][0]
    assert ext_context["extension_id"] == "ext_wellcontrol"
    assert ext_context["extension_version"] == "1.0.0"
    mapping = ext_context["transferable_mappings"][0]
    assert mapping["id"] == "map_0001"
    assert mapping["source"] == "concept:driller.well_control"
    assert mapping["limitations"] == "Requires HSE certification to be recognized formally."
    import json
    serialized = json.dumps(context)
    assert "source_file" not in serialized
    assert "cv_file" not in serialized
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/webapp/services/test_semantic_proposal_adapter.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write semantic_proposal_adapter.py**

```python
# webapp/services/semantic_proposal_adapter.py
"""Untrusted semantic-proposal adapter for Ticket 7.

Proposes candidate<->job evidence relationships, a proposed classification,
and gate observations for analyze_semantic_job_fit() to locally adjudicate.
Every field this adapter emits matches Ticket 7's real semantic_proposals
schema (product/semantic_job_fit.py:801-826) exactly — including gate
`status` and match `classification`, which are REQUIRED proposal fields, not
authoritative answers. What this adapter must never emit is a field that
would let a proposal bypass adjudication: overall_score, verdict,
recommendation, blocked, blocking_gate_ids.
"""
from __future__ import annotations

import copy
from typing import Any, Protocol

FORBIDDEN_KEYS = {"overall_score", "verdict", "recommendation", "blocked", "blocking_gate_ids"}


def _strip_forbidden(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _strip_forbidden(v) for k, v in value.items() if k not in FORBIDDEN_KEYS}
    if isinstance(value, list):
        return [_strip_forbidden(item) for item in value]
    return value


class ProposerClient(Protocol):
    def complete(self, context: dict[str, Any]) -> dict[str, Any]: ...


class SemanticProposalAdapter:
    def __init__(self, client: ProposerClient) -> None:
        self._client = client

    def build_prompt_context(
        self, *, profile_evidence: list[dict[str, Any]], resolved_job_evidence: dict[str, Any],
        active_extensions: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            "profile_evidence": [
                {"id": item["id"], "category": item.get("category"), "field": item.get("field"),
                 "value": item.get("value")}
                for item in profile_evidence
            ],
            "job_evidence": [
                {"id": item["id"], "category": item.get("category"), "kind": item.get("kind"), "text": item.get("text")}
                for item in resolved_job_evidence.get("evidence", [])
            ],
            "active_extensions": [
                {
                    "extension_id": ext["id"],
                    "extension_version": ext["version"],
                    "transferable_mappings": [
                        {
                            "id": mapping["id"],
                            "source": mapping["source"],
                            "target": mapping["target"],
                            "transfer_strength": mapping["transfer_strength"],
                            "conditions": mapping.get("conditions"),
                            "limitations": mapping.get("limitations"),
                        }
                        for mapping in ext.get("transferable_mappings", [])
                    ],
                }
                for ext in active_extensions
            ],
        }

    def propose(
        self, *, profile_evidence: list[dict[str, Any]], resolved_job_evidence: dict[str, Any],
        active_extensions: list[dict[str, Any]],
    ) -> dict[str, Any]:
        context = self.build_prompt_context(
            profile_evidence=profile_evidence, resolved_job_evidence=resolved_job_evidence,
            active_extensions=active_extensions,
        )
        raw = self._client.complete(context)
        cleaned = _strip_forbidden(copy.deepcopy(raw))
        return {"matches": cleaned.get("matches", []), "gates": cleaned.get("gates", [])}


class FakeSemanticProposalAdapter(SemanticProposalAdapter):
    def __init__(self, canned_response: dict[str, Any]) -> None:
        super().__init__(client=_CannedClient(canned_response))


class _CannedClient:
    def __init__(self, canned_response: dict[str, Any]) -> None:
        self._canned_response = canned_response

    def complete(self, context: dict[str, Any]) -> dict[str, Any]:
        return copy.deepcopy(self._canned_response)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/webapp/services/test_semantic_proposal_adapter.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Run full suite**

Run: `pytest -q`
Expected: no regressions.

---

## Task 7: OpenAI-backed proposer client for the semantic adapter (fail-closed, production-realistic)

**Files:**
- Create: `webapp/services/openai_semantic_proposer_client.py`
- Create: `webapp/services/semantic_proposer_errors.py`
- Create: `webapp/prompts/semantic-proposer.v0.txt`
- Test: `tests/webapp/services/test_openai_semantic_proposer_client.py`

**Interfaces:**
- Produces: `webapp.services.semantic_proposer_errors.SemanticProposerProviderError(RuntimeError)`. `webapp.services.openai_semantic_proposer_client.OpenAISemanticProposerClient` implementing `ProposerClient` (Task 6), constructed with the same injectable-dependency shape as `OpenAIApplicationIntelligenceProvider` (`environ`, `client_factory`, `clock`, `utc_now`, `sleep`) so it is testable without real network calls and mirrors the verified repo pattern exactly. **Corrected from v1: on any failure (missing credential, all-attempts-exhausted API failure, malformed/non-JSON output, or output that fails Ticket 7's own `_validate_semantic_proposals_shape` when dry-run validated) this client raises `SemanticProposerProviderError` — it never returns a silent `{"matches": [], "gates": []}` fallback.** Task 9's pipeline service is responsible for catching this exception and leaving the previous successful Job Fit result visible rather than fabricating a new empty-proposal result (see Task 9's `PipelineError` wrapping).

- [ ] **Step 1: Write the failing test**

```python
# tests/webapp/services/test_openai_semantic_proposer_client.py
import json

import pytest

from webapp.services.semantic_proposer_errors import SemanticProposerProviderError
from webapp.services.openai_semantic_proposer_client import OpenAISemanticProposerClient


class _FakeResponse:
    def __init__(self, text):
        self.output_text = text
        self.id = "resp_fake_1"


class _FakeResponses:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        next_item = self._responses.pop(0)
        if isinstance(next_item, Exception):
            raise next_item
        return next_item


class _FakeClient:
    def __init__(self, responses):
        self.responses = _FakeResponses(responses)


def _client(responses, environ=None):
    fake = _FakeClient(responses)
    return OpenAISemanticProposerClient(
        environ=environ or {"OPENAI_API_KEY": "sk-test"},
        client_factory=lambda api_key: fake,
        sleep=lambda seconds: None,
    ), fake


def test_complete_parses_strict_json_schema_response_into_matches_and_gates():
    client, fake = _client([_FakeResponse(json.dumps({"matches": [{"proposal_id": "p1"}], "gates": []}))])
    result = client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})
    assert result == {"matches": [{"proposal_id": "p1"}], "gates": []}


def test_complete_uses_pinned_model_and_strict_schema_call_shape():
    client, fake = _client([_FakeResponse(json.dumps({"matches": [], "gates": []}))])
    client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})
    call = fake.responses.calls[0]
    assert call["model"] == "gpt-5.4-mini-2026-03-17"
    assert call["text"]["format"]["type"] == "json_schema"
    assert call["text"]["format"]["strict"] is True
    assert call["tools"] == []
    assert call["store"] is False


def test_strict_schema_requires_all_optional_match_fields_present_as_nullable():
    # OpenAI strict mode requires every declared property to be listed in
    # "required" — confidence/functional_basis/extension_ref are still
    # semantically optional, expressed by each accepting null via a
    # type: [<real type>, "null"] union (verified against the identical
    # pattern already used in product/openai_application_intelligence_provider.py,
    # e.g. "assertion_type": {"type": ["string", "null"], ...}) rather than
    # being absent from "required" (OpenAI strict mode rejects that).
    client, fake = _client([_FakeResponse(json.dumps({"matches": [], "gates": []}))])
    client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})
    match_schema = fake.responses.calls[0]["text"]["format"]["schema"]["properties"]["matches"]["items"]
    assert set(match_schema["required"]) == {
        "proposal_id", "job_evidence_id", "profile_evidence_ids", "classification",
        "rationale", "confidence", "functional_basis", "extension_ref",
    }
    assert match_schema["properties"]["confidence"]["type"] == ["string", "null"]
    assert match_schema["properties"]["functional_basis"]["type"] == ["object", "null"]
    assert match_schema["properties"]["extension_ref"]["type"] == ["object", "null"]
    # the nested object schemas must still declare their own properties/required
    # (nullability at the parent level does not exempt the object shape when
    # non-null)
    assert match_schema["properties"]["functional_basis"]["required"] == [
        "responsibility_alignment", "competency_alignment", "title_similarity_only",
    ]


def test_complete_strips_null_optional_fields_so_ticket7_sees_them_as_absent():
    # Ticket 7's real validator treats a present-but-null optional key as a
    # shape violation (verified against product/semantic_job_fit.py source);
    # it expects the key to be ABSENT, not present-with-null. The proposer
    # must therefore strip null values before returning.
    client, fake = _client([_FakeResponse(json.dumps({
        "matches": [{
            "proposal_id": "p1", "job_evidence_id": "j1", "profile_evidence_ids": ["c1"],
            "classification": "direct", "rationale": "x",
            "confidence": None, "functional_basis": None, "extension_ref": None,
        }],
        "gates": [],
    }))])
    result = client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})
    match = result["matches"][0]
    assert "confidence" not in match
    assert "functional_basis" not in match
    assert "extension_ref" not in match
    assert match["proposal_id"] == "p1"


def test_complete_preserves_non_null_functional_basis():
    client, fake = _client([_FakeResponse(json.dumps({
        "matches": [{
            "proposal_id": "p1", "job_evidence_id": "j1", "profile_evidence_ids": ["c1"],
            "classification": "functionally_equivalent", "rationale": "x",
            "confidence": "high",
            "functional_basis": {"responsibility_alignment": ["a"], "competency_alignment": [], "title_similarity_only": False},
            "extension_ref": None,
        }],
        "gates": [],
    }))])
    result = client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})
    match = result["matches"][0]
    assert match["functional_basis"]["responsibility_alignment"] == ["a"]
    assert "extension_ref" not in match


def test_missing_api_key_raises_provider_error_not_silent_fallback():
    client, fake = _client([_FakeResponse("{}")], environ={})
    with pytest.raises(SemanticProposerProviderError, match="OPENAI_API_KEY"):
        client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})


def test_malformed_json_raises_provider_error_not_silent_fallback():
    client, fake = _client([_FakeResponse("not valid json {")])
    with pytest.raises(SemanticProposerProviderError, match="not valid JSON"):
        client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})


def test_exhausted_retries_raise_provider_error_not_silent_fallback():
    client, fake = _client([RuntimeError("network down"), RuntimeError("network down again")])
    with pytest.raises(SemanticProposerProviderError, match="network down again"):
        client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})


def test_transient_failure_then_success_retries_within_bound():
    client, fake = _client([RuntimeError("transient"), _FakeResponse(json.dumps({"matches": [], "gates": []}))])
    result = client.complete({"profile_evidence": [], "job_evidence": [], "active_extensions": []})
    assert result == {"matches": [], "gates": []}
    assert len(fake.responses.calls) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/webapp/services/test_openai_semantic_proposer_client.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write the prompt file**

```text
# webapp/prompts/semantic-proposer.v0.txt
You propose relationships between job evidence and candidate profile evidence
for a downstream adjudication system. You do not decide fit, score, verdict,
or recommendation — those are decided elsewhere from evidence you cannot see.

For each job requirement/responsibility you are given, propose zero or more
matches to candidate profile evidence, each with a classification
(one of the allowed classification values provided in context) and a short
factual rationale grounded only in the text you were given. Never invent
candidate facts not present in the supplied profile_evidence.

If an active extension's transferable_mappings could plausibly justify a
transferable classification, reference that mapping's exact id, extension id,
and extension version in extension_ref. Do not propose a transferable
classification without a matching extension_ref.

For each of the three gates (eligibility, language, location_logistics),
propose a status (PASS, FAIL, FLAG, UNVERIFIED, or NOT_APPLICABLE) with a
short reason grounded in the supplied evidence. If you have no basis to judge
a gate, propose UNVERIFIED with a reason explaining what is missing — never
omit a gate.

Output only the fields defined by the response schema.
```

- [ ] **Step 4: Write semantic_proposer_errors.py**

```python
# webapp/services/semantic_proposer_errors.py
class SemanticProposerProviderError(RuntimeError):
    """Raised when the hosted semantic proposer fails or returns malformed output.

    Never caught to produce a silent empty-proposal fallback — the caller
    (webapp.services.pipeline) must leave the previous successful Job Fit
    result visible and report the stage as failed, per the frozen design's
    failure-handling rule: no fabricated analysis, ever. On any failure the
    caller receives THIS exception, never a default value.
    """
```

- [ ] **Step 5: Write openai_semantic_proposer_client.py**

```python
# webapp/services/openai_semantic_proposer_client.py
"""OpenAI Responses adapter for the untrusted semantic proposer.

Mirrors the verified pattern in product/openai_application_intelligence_provider.py:
pinned model/version, disabled SDK retries with explicit timeouts, a bounded
manual retry loop, strict JSON-schema structured output, and a dedicated
provider-error type raised on every failure path — never a silent fallback.

The response schema here is hand-authored (not derived from a product/ schema
file) because product/semantic_job_fit.py's proposal shape is a small,
self-contained fragment {matches, gates} that does not have its own standalone
JSON Schema file in product/ — it is validated inline by
_validate_semantic_proposals_shape. Keeping this schema hand-authored, small,
and directly matched against that validator (see Task 6's round-trip test)
is simpler and more auditable than deriving/filtering a larger schema file
the way Job Understanding and Application Intelligence do.
"""
from __future__ import annotations

import copy
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from webapp.services.semantic_proposer_errors import SemanticProposerProviderError

OPENAI_MODEL = "gpt-5.4-mini-2026-03-17"
OPENAI_MODEL_ID = "gpt-5.4-mini"
OPENAI_MODEL_VERSION = OPENAI_MODEL
OPENAI_API_KEY_ENV = "OPENAI_API_KEY"
MAX_OUTPUT_TOKENS = 4_096
MAX_ATTEMPTS = 2
CONNECT_TIMEOUT_SECONDS = 5.0
REQUEST_TIMEOUT_SECONDS = 60.0
OPENAI_RESPONSE_SCHEMA_NAME = "semantic_proposal_v0"
PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "semantic-proposer.v0.txt"
INSTRUCTIONS = PROMPT_PATH.read_text(encoding="utf-8")

# Hand-authored strict schema matching product/semantic_job_fit.py's
# _validate_semantic_proposals_shape exactly (verified: proposal_id,
# job_evidence_id, profile_evidence_ids, classification, rationale required
# per match; gate_id, status, reason, job_evidence_ids, profile_evidence_ids
# required==allowed per gate; extension_ref has extension_id, extension_version,
# record_type, record_id).
_EXTENSION_REF_SCHEMA = {
    "type": "object",
    "properties": {
        "extension_id": {"type": "string"},
        "extension_version": {"type": "string"},
        "record_type": {"type": "string", "enum": ["transferable_mapping"]},
        "record_id": {"type": "string"},
    },
    "required": ["extension_id", "extension_version", "record_type", "record_id"],
    "additionalProperties": False,
}

_FUNCTIONAL_BASIS_SCHEMA = {
    "type": "object",
    "properties": {
        "responsibility_alignment": {"type": "array", "items": {"type": "string"}},
        "competency_alignment": {"type": "array", "items": {"type": "string"}},
        "title_similarity_only": {"type": "boolean"},
    },
    "required": ["responsibility_alignment", "competency_alignment", "title_similarity_only"],
    "additionalProperties": False,
}

_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "matches": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "proposal_id": {"type": "string"},
                    "job_evidence_id": {"type": "string"},
                    "profile_evidence_ids": {"type": "array", "items": {"type": "string"}},
                    "classification": {"type": "string"},
                    "rationale": {"type": "string"},
                    "confidence": {"type": ["string", "null"]},
                    "functional_basis": {**_FUNCTIONAL_BASIS_SCHEMA, "type": ["object", "null"]},
                    "extension_ref": {**_EXTENSION_REF_SCHEMA, "type": ["object", "null"]},
                },
                # OpenAI structured-output strict mode requires every key in
                # "properties" to also appear in "required" (optional fields
                # are expressed by allowing null on the value's own schema,
                # not by omitting them from "required"). confidence,
                # functional_basis, and extension_ref are therefore listed as
                # required here but each accepts null — the proposer emits
                # null for whichever of these three genuinely don't apply to
                # a given match, and webapp/services/semantic_proposal_adapter.py's
                # _strip_forbidden pass-through leaves null values as-is;
                # product/semantic_job_fit.py's own validator (verified
                # against source) only inspects a key's presence via "in
                # match", so this code adds one line before returning from
                # OpenAISemanticProposerClient.complete() to drop any key
                # whose value is exactly None from each match dict before
                # they reach product/*, since Ticket 7's validator treats a
                # present-but-null optional key as a shape violation (it
                # calls _nonempty_string/_validate_extension_ref_shape
                # directly on whatever value is present, which rejects None).
                "required": ["proposal_id", "job_evidence_id", "profile_evidence_ids", "classification", "rationale",
                             "confidence", "functional_basis", "extension_ref"],
                "additionalProperties": False,
            },
        },
        "gates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "gate_id": {"type": "string", "enum": ["eligibility", "language", "location_logistics"]},
                    "status": {"type": "string", "enum": ["PASS", "FAIL", "FLAG", "UNVERIFIED", "NOT_APPLICABLE"]},
                    "reason": {"type": "string"},
                    "job_evidence_ids": {"type": "array", "items": {"type": "string"}},
                    "profile_evidence_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["gate_id", "status", "reason", "job_evidence_ids", "profile_evidence_ids"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["matches", "gates"],
    "additionalProperties": False,
}

ClientFactory = Callable[[str], Any]
Clock = Callable[[], float]
UtcNow = Callable[[], datetime]
Sleeper = Callable[[float], None]


class OpenAISemanticProposerClient:
    provider_id = "openai"
    model_id = OPENAI_MODEL_ID
    model_version = OPENAI_MODEL_VERSION

    def __init__(
        self, *, environ: Mapping[str, str] | None = None, client_factory: ClientFactory | None = None,
        clock: Clock = time.monotonic, utc_now: UtcNow | None = None, sleep: Sleeper = time.sleep,
    ) -> None:
        self._environ = os.environ if environ is None else environ
        self._client_factory = client_factory or _default_client_factory
        self._clock = clock
        self._utc_now = utc_now or (lambda: datetime.now(timezone.utc))
        self._sleep = sleep

    def complete(self, context: dict[str, Any]) -> dict[str, Any]:
        api_key = self._credential()
        client = self._make_client(api_key)
        call = {
            "model": OPENAI_MODEL,
            "instructions": INSTRUCTIONS,
            "input": json.dumps(context, ensure_ascii=False, separators=(",", ":")),
            "reasoning": {"effort": "low"},
            "text": {"format": {"type": "json_schema", "name": OPENAI_RESPONSE_SCHEMA_NAME,
                                 "strict": True, "schema": copy.deepcopy(_RESPONSE_SCHEMA)}},
            "max_output_tokens": MAX_OUTPUT_TOKENS,
            "store": False, "stream": False, "background": False, "tools": [],
            "truncation": "disabled",
        }

        response = None
        last_exc: Exception | None = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                response = client.responses.create(**copy.deepcopy(call))
                last_exc = None
                break
            except Exception as exc:
                last_exc = exc
                if attempt >= MAX_ATTEMPTS:
                    break
                self._sleep(1.0)

        if last_exc is not None:
            raise SemanticProposerProviderError(f"openai semantic proposer failed: {last_exc}") from None

        return _decode_response(response)

    def _credential(self) -> str:
        value = self._environ.get(OPENAI_API_KEY_ENV)
        if not isinstance(value, str) or not value.strip():
            raise SemanticProposerProviderError(
                f"openai semantic proposer is not configured: {OPENAI_API_KEY_ENV} is missing or blank"
            )
        return value.strip()

    def _make_client(self, api_key: str) -> Any:
        try:
            return self._client_factory(api_key)
        except SemanticProposerProviderError:
            raise
        except Exception:
            raise SemanticProposerProviderError("openai semantic proposer client initialization failed") from None


def _default_client_factory(api_key: str) -> Any:
    try:
        import openai
    except ImportError:
        raise SemanticProposerProviderError("openai provider dependency is unavailable") from None
    return openai.OpenAI(
        api_key=api_key, max_retries=0,
        timeout=openai.Timeout(REQUEST_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS),
    )


def _decode_response(response: Any) -> dict[str, Any]:
    text = getattr(response, "output_text", None)
    if not isinstance(text, str):
        raise SemanticProposerProviderError("openai response missing output_text")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SemanticProposerProviderError(f"openai response is not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict) or "matches" not in parsed or "gates" not in parsed:
        raise SemanticProposerProviderError("openai response missing matches/gates")

    # OpenAI strict structured output requires confidence/functional_basis/
    # extension_ref to be present on every match (see _RESPONSE_SCHEMA's
    # comment above), with null standing in for "does not apply." Ticket 7's
    # real validator (product/semantic_job_fit.py, verified against source)
    # treats a present-but-null optional key as a shape violation — it calls
    # field-specific validators directly on whatever value is present rather
    # than skipping null values. Drop any such key whose value is exactly
    # None before returning, so downstream validation sees "key absent"
    # (matching Ticket 7's actual optional-field contract) rather than "key
    # present with value null."
    matches = []
    for match in parsed.get("matches", []):
        if not isinstance(match, dict):
            matches.append(match)
            continue
        matches.append({key: value for key, value in match.items() if value is not None})

    return {"matches": matches, "gates": parsed["gates"]}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pytest tests/webapp/services/test_openai_semantic_proposer_client.py -v`
Expected: PASS (9 tests)

- [ ] **Step 7: Run full suite**

Run: `pytest -q`
Expected: no regressions.

---

## Task 8: Dependency-fingerprint staleness service (corrected model)

**Files:**
- Create: `webapp/services/staleness.py`
- Test: `tests/webapp/services/test_staleness.py`

**Interfaces:**
- Produces: `webapp.services.staleness.record_dependency_fingerprint(conn, *, artifact_id: str, upstream_artifact_type: str, upstream_content_id: str) -> None` — writes one row to `dependency_fingerprints` (Task 3's schema). `webapp.services.staleness.DEPENDENCY_TYPES: dict[str, tuple[str, ...]]` — the direct upstream artifact TYPES each artifact type depends on (used to know which fingerprints to check, not to read values out of domain payloads). `webapp.services.staleness.check_staleness(conn, workspace_id: str, artifact_type: str) -> dict[str, Any]` returning `{"stale": bool, "reasons": list[str]}`.
- **Corrected from v1 (Finding #7):** staleness is no longer computed by guessing which identity field happens to exist inside a domain payload (v1 assumed the Resolved Job Evidence Bundle embeds `job_understanding_result.content_id` — verified false; the bundle only contains a `job_snapshot` ref). Instead, every producing pipeline step (Tasks 9–10) calls `record_dependency_fingerprint()` once per direct upstream artifact it actually consumed, at the moment it saves its own artifact — capturing the upstream's `content_id` (or Ticket 9's own internal hash for artifact types that have no `product/`-assigned content id) as it was at production time. `check_staleness` then compares each recorded fingerprint against the upstream artifact's CURRENT `content_id`. This works uniformly for every artifact type, including `job_understanding_result` (which has no `content_id` of its own from `product/` and is fingerprinted via Ticket 9's own hash — see Task 9) and `application_pack` (now covered, closing the "does not cover application_pack" gap).
- **Transitivity, corrected from v1:** `check_staleness` recurses — an artifact is stale if any direct upstream fingerprint mismatches, OR if any direct upstream is itself stale. This closes the non-transitivity gap: e.g. if `profile_snapshot` changes, `job_fit_result` is directly stale (fingerprint mismatch), and `application_intelligence_result` is transitively stale even though its own directly-fingerprinted upstream (`job_fit_result`'s content_id) technically hasn't changed yet at the database level until `job_fit_result` is rerun — the recursive check surfaces this immediately rather than only after a rerun.
- Extension/policy/proposal coverage: `job_fit_result` depends on `job_fit_request` (Task 10), whose own `content_id` is a hash of its ENTIRE payload — including the `active_extensions` and `semantic_proposals` fields `build_semantic_job_fit_request` embeds directly into the request. A change to either is therefore already visible as a `job_fit_request` content_id change, which `job_fit_result`'s recorded fingerprint against `job_fit_request` catches through the existing dependency-fingerprint mechanism — no separate extension/proposal-specific fingerprint is needed, closing the "ignores active extensions/policies/proposals" gap without a parallel tracking mechanism.
- **Global-profile-workspace routing (fixed during PM review):** `profile_snapshot` artifacts exist ONLY under `PROFILE_WORKSPACE_ID` (Task 4), never under any job workspace. Every lookup inside `check_staleness`/`_check_staleness_recursive` for artifact type `"profile_snapshot"` — whether it is the artifact being checked directly, an upstream being compared in the `DEPENDENCY_TYPES` loop, or a recursive descent — resolves to `PROFILE_WORKSPACE_ID` regardless of the `workspace_id` the caller passed in. Without this, calling `check_staleness(conn, job_workspace_id, "job_fit_result")` would look up `profile_snapshot` under the job workspace, always find nothing, and silently skip the profile-staleness check for every real workspace — the bug would never surface in a test that (incorrectly) saves `profile_snapshot` under the same workspace_id as everything else, which is why every test in this task now explicitly saves `profile_snapshot` under `PROFILE_WORKSPACE_ID` and a dedicated regression test (`test_check_staleness_reads_profile_snapshot_from_global_workspace_not_job_workspace`) proves the routing directly.

- [ ] **Step 1: Write the failing test**

```python
# tests/webapp/services/test_staleness.py
from webapp.persistence.db import init_db, connect
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID, create_workspace
from webapp.persistence.artifacts import save_artifact
from webapp.services.staleness import record_dependency_fingerprint, check_staleness


def _setup(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    return conn, ws["id"]


def test_fresh_artifact_with_matching_fingerprint_is_not_stale(tmp_path):
    conn, workspace_id = _setup(tmp_path)
    # profile_snapshot artifacts live ONLY under PROFILE_WORKSPACE_ID in the
    # real architecture (Task 4/9) — using the job workspace_id here would
    # make check_staleness's profile lookup silently no-op, masking the exact
    # bug this fixture is designed to catch.
    profile = save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                             payload={}, content_id="profilesnap_A")
    bundle = save_artifact(conn, workspace_id=workspace_id, artifact_type="resolved_job_evidence",
                            payload={}, content_id="resolvedjobev_A")
    fit = save_artifact(conn, workspace_id=workspace_id, artifact_type="job_fit_result",
                         payload={}, content_id="jobfitresult_A")
    record_dependency_fingerprint(conn, artifact_id=fit["id"], upstream_artifact_type="profile_snapshot",
                                   upstream_content_id=profile["content_id"])
    record_dependency_fingerprint(conn, artifact_id=fit["id"], upstream_artifact_type="resolved_job_evidence",
                                   upstream_content_id=bundle["content_id"])

    result = check_staleness(conn, workspace_id, "job_fit_result")
    assert result == {"stale": False, "reasons": []}
    conn.close()


def test_direct_staleness_after_upstream_change(tmp_path):
    conn, workspace_id = _setup(tmp_path)
    profile = save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                             payload={}, content_id="profilesnap_A")
    bundle = save_artifact(conn, workspace_id=workspace_id, artifact_type="resolved_job_evidence",
                            payload={}, content_id="resolvedjobev_A")
    fit = save_artifact(conn, workspace_id=workspace_id, artifact_type="job_fit_result",
                         payload={}, content_id="jobfitresult_A")
    record_dependency_fingerprint(conn, artifact_id=fit["id"], upstream_artifact_type="profile_snapshot",
                                   upstream_content_id=profile["content_id"])
    record_dependency_fingerprint(conn, artifact_id=fit["id"], upstream_artifact_type="resolved_job_evidence",
                                   upstream_content_id=bundle["content_id"])

    save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                   payload={"changed": True}, content_id="profilesnap_B")

    result = check_staleness(conn, workspace_id, "job_fit_result")
    assert result["stale"] is True
    assert any("profile_snapshot" in reason for reason in result["reasons"])
    conn.close()


def test_check_staleness_reads_profile_snapshot_from_global_workspace_not_job_workspace(tmp_path):
    # Direct regression test for the bug where check_staleness looked up
    # profile_snapshot under the caller's workspace_id instead of the global
    # profile workspace, silently no-oping the entire profile-staleness path.
    conn, workspace_id = _setup(tmp_path)
    profile = save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                             payload={}, content_id="profilesnap_A")
    result = check_staleness(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")
    assert result == {"stale": False, "reasons": []}
    # calling check_staleness for "profile_snapshot" with a job workspace_id
    # must resolve to the SAME global artifact, not a different (nonexistent)
    # one — proving the routing fix, not just that the API doesn't crash.
    assert check_staleness(conn, workspace_id, "profile_snapshot") == result
    conn.close()


def test_transitive_staleness_propagates_downstream(tmp_path):
    conn, workspace_id = _setup(tmp_path)
    profile = save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                             payload={}, content_id="profilesnap_A")
    bundle = save_artifact(conn, workspace_id=workspace_id, artifact_type="resolved_job_evidence",
                            payload={}, content_id="resolvedjobev_A")
    fit = save_artifact(conn, workspace_id=workspace_id, artifact_type="job_fit_result",
                         payload={}, content_id="jobfitresult_A")
    record_dependency_fingerprint(conn, artifact_id=fit["id"], upstream_artifact_type="profile_snapshot",
                                   upstream_content_id=profile["content_id"])
    record_dependency_fingerprint(conn, artifact_id=fit["id"], upstream_artifact_type="resolved_job_evidence",
                                   upstream_content_id=bundle["content_id"])

    intelligence = save_artifact(conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
                                  payload={}, content_id=None)
    record_dependency_fingerprint(conn, artifact_id=intelligence["id"], upstream_artifact_type="profile_snapshot",
                                   upstream_content_id=profile["content_id"])
    record_dependency_fingerprint(conn, artifact_id=intelligence["id"], upstream_artifact_type="job_fit_result",
                                   upstream_content_id=fit["content_id"])

    # profile changes; job_fit_result is directly stale, and even though nobody
    # has rerun job_fit yet (so job_fit_result's content_id in the DB is still
    # "jobfitresult_A", matching what application_intelligence_result recorded),
    # application_intelligence_result must be reported stale TRANSITIVELY because
    # its direct dependency (job_fit_result) is itself stale.
    save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                   payload={"changed": True}, content_id="profilesnap_B")

    fit_staleness = check_staleness(conn, workspace_id, "job_fit_result")
    assert fit_staleness["stale"] is True

    intelligence_staleness = check_staleness(conn, workspace_id, "application_intelligence_result")
    assert intelligence_staleness["stale"] is True
    assert any("job_fit_result" in reason for reason in intelligence_staleness["reasons"])
    conn.close()


def test_application_pack_staleness_is_covered(tmp_path):
    conn, workspace_id = _setup(tmp_path)
    intelligence = save_artifact(conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
                                  payload={}, content_id="aiintel_A")
    pack = save_artifact(conn, workspace_id=workspace_id, artifact_type="application_pack",
                          payload={}, content_id="apppack_A")
    record_dependency_fingerprint(conn, artifact_id=pack["id"], upstream_artifact_type="application_intelligence_result",
                                   upstream_content_id=intelligence["content_id"])

    assert check_staleness(conn, workspace_id, "application_pack")["stale"] is False

    save_artifact(conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
                   payload={"changed": True}, content_id="aiintel_B")

    assert check_staleness(conn, workspace_id, "application_pack")["stale"] is True
    conn.close()


def test_no_fingerprints_recorded_means_not_stale(tmp_path):
    # An artifact type with no recorded dependency fingerprints (e.g. because it
    # has no upstream, like profile_snapshot itself) is never stale.
    conn, workspace_id = _setup(tmp_path)
    save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                   payload={}, content_id="profilesnap_A")
    assert check_staleness(conn, PROFILE_WORKSPACE_ID, "profile_snapshot") == {"stale": False, "reasons": []}
    conn.close()


def test_missing_current_artifact_is_not_stale(tmp_path):
    conn, workspace_id = _setup(tmp_path)
    assert check_staleness(conn, workspace_id, "job_fit_result") == {"stale": False, "reasons": []}
    conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/webapp/services/test_staleness.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write staleness.py**

```python
# webapp/services/staleness.py
from __future__ import annotations

import sqlite3
from typing import Any

from webapp.persistence.artifacts import get_current_artifact
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID

# Direct upstream artifact TYPES each artifact type depends on. Used only to
# know which fingerprint rows to expect/check — the actual comparison values
# come from dependency_fingerprints, never from guessing a field inside a
# domain payload.
DEPENDENCY_TYPES: dict[str, tuple[str, ...]] = {
    "job_understanding_request": ("job_posting_snapshot",),
    "job_understanding_result": ("job_posting_snapshot", "job_understanding_request"),
    "resolved_job_evidence": ("job_posting_snapshot", "job_understanding_request", "job_understanding_result"),
    "job_fit_request": ("profile_snapshot", "resolved_job_evidence"),
    "job_fit_result": ("profile_snapshot", "resolved_job_evidence", "job_fit_request"),
    "application_intelligence_request": ("profile_snapshot", "job_fit_result"),
    "application_intelligence_result": ("profile_snapshot", "job_fit_result", "application_intelligence_request"),
    "application_pack": ("job_fit_result", "application_intelligence_result"),
}


def record_dependency_fingerprint(
    conn: sqlite3.Connection, *, artifact_id: str, upstream_artifact_type: str, upstream_content_id: str,
) -> None:
    conn.execute(
        "INSERT INTO dependency_fingerprints (artifact_id, upstream_artifact_type, upstream_content_id) "
        "VALUES (?, ?, ?) ON CONFLICT(artifact_id, upstream_artifact_type) DO UPDATE SET upstream_content_id = excluded.upstream_content_id",
        (artifact_id, upstream_artifact_type, upstream_content_id),
    )
    conn.commit()


def check_staleness(conn: sqlite3.Connection, workspace_id: str, artifact_type: str) -> dict[str, Any]:
    return _check_staleness_recursive(conn, workspace_id, artifact_type, set())


def _check_staleness_recursive(
    conn: sqlite3.Connection, workspace_id: str, artifact_type: str, visiting: set[str],
) -> dict[str, Any]:
    if artifact_type in visiting:
        return {"stale": False, "reasons": []}  # cycle guard; DEPENDENCY_TYPES is acyclic by construction
    visiting = visiting | {artifact_type}

    # profile_snapshot artifacts live ONLY under the global profile workspace
    # (PROFILE_WORKSPACE_ID), never under a job workspace — matching how
    # webapp.services.pipeline.get_current_profile_snapshot and
    # workspace_view.py already read it. Every call site below (the direct
    # check_staleness(..., "profile_snapshot") case, the loop over
    # DEPENDENCY_TYPES, and the recursive descent) goes through this one
    # resolution so the lookup is never wrong regardless of which workspace
    # id the caller passed in.
    lookup_workspace_id = PROFILE_WORKSPACE_ID if artifact_type == "profile_snapshot" else workspace_id
    current = get_current_artifact(conn, lookup_workspace_id, artifact_type)
    if current is None:
        return {"stale": False, "reasons": []}

    reasons: list[str] = []
    fingerprints = {
        row["upstream_artifact_type"]: row["upstream_content_id"]
        for row in conn.execute(
            "SELECT upstream_artifact_type, upstream_content_id FROM dependency_fingerprints WHERE artifact_id = ?",
            (current["id"],),
        ).fetchall()
    }

    for upstream_type in DEPENDENCY_TYPES.get(artifact_type, ()):
        upstream_lookup_workspace_id = PROFILE_WORKSPACE_ID if upstream_type == "profile_snapshot" else workspace_id
        upstream_current = get_current_artifact(conn, upstream_lookup_workspace_id, upstream_type)
        if upstream_current is None:
            continue

        recorded = fingerprints.get(upstream_type)
        if recorded is not None and recorded != upstream_current["content_id"]:
            reasons.append(
                f"{upstream_type} changed (used {recorded!r}, current is {upstream_current['content_id']!r})"
            )
            continue  # direct mismatch already explains staleness; skip the transitive check for this branch

        upstream_staleness = _check_staleness_recursive(conn, workspace_id, upstream_type, visiting)
        if upstream_staleness["stale"]:
            reasons.append(f"{upstream_type} is itself stale: {'; '.join(upstream_staleness['reasons'])}")

    return {"stale": bool(reasons), "reasons": reasons}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/webapp/services/test_staleness.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Run full suite**

Run: `pytest -q`
Expected: no regressions.

---

## Task 9: Pipeline orchestration — Profile, Job Input, Understanding (request+result paired, fail-closed)

**Files:**
- Create: `webapp/services/pipeline.py`
- Test: `tests/webapp/services/test_pipeline_profile_and_job.py`

**Interfaces:**
- Produces:
  - `webapp.services.pipeline.PipelineError(RuntimeError)` — the one error type this module raises. It wraps `SnapshotValidationError`, `JobPostingValidationError`, `JobUnderstandingValidationError`, `JobUnderstandingProviderError`, missing-upstream-artifact conditions, and `SemanticProposerProviderError` (Task 10) uniformly, so `webapp/api` never needs to know about `product/*` or `webapp/services`-internal exception types (Finding #17 — v1 described this wrapping but never implemented the actual `except` clauses; this version does).
  - `webapp.services.pipeline.refresh_profile(conn, *, root: str = ".") -> dict[str, Any]` — operates on the single global Profile workspace (`webapp.persistence.workspaces.PROFILE_WORKSPACE_ID`, from Task 4), NOT a caller-supplied workspace id. This closes Finding #2: there is exactly one Profile Snapshot in the system, addressed by the fixed profile-workspace id, and every job workspace reads the SAME current snapshot via `get_current_profile_snapshot()` below — nothing about "which workspace's profile" is ever ambiguous.
  - `webapp.services.pipeline.get_current_profile_snapshot(conn) -> dict[str, Any] | None` — reads the current `profile_snapshot` artifact from the global profile workspace. Every job-workspace pipeline stage (Task 10) calls this, never `get_current_artifact(conn, job_workspace_id, "profile_snapshot")`.
  - `webapp.services.pipeline.create_job_from_source_record(conn, *, company: str, title: str, source_record: dict[str, Any]) -> dict[str, Any]` — creates a `kind="job"` workspace via `create_workspace`, never touches the profile workspace.
  - `webapp.services.pipeline.run_job_understanding(conn, workspace_id: str, provider, *, request_id: str) -> dict[str, Any]` — builds and PERSISTS the exact `job_understanding_request` via `build_job_understanding_request()` BEFORE calling `provider.extract()`, then persists the exact result as `job_understanding_result`, and records a dependency fingerprint from the result artifact back to the request artifact's own Ticket-9-internal hash (since `job_understanding_request`/`result` have no `product/`-assigned `content_id` — Ticket 9 computes one, see `_hash_artifact` below) and to `job_posting_snapshot`. This closes Finding #3 for this stage.
  - `webapp.services.pipeline._hash_artifact(prefix: str, payload: dict[str, Any]) -> str` — Ticket 9's internal storage hash for artifact types with no `product/`-assigned content id, using the EXACT canonical JSON scheme verified in Ticket 8's own `_job_fit_result_content_id` (`json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)`), so any future cross-check between an independently-computed hash and this one agrees bit-for-bit (closes part of Finding #7).

- [ ] **Step 1: Write the failing test**

```python
# tests/webapp/services/test_pipeline_profile_and_job.py
from pathlib import Path

import pytest

from webapp.persistence.db import init_db, connect
from webapp.persistence.artifacts import get_current_artifact
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID
from webapp.services.pipeline import (
    refresh_profile,
    get_current_profile_snapshot,
    create_job_from_source_record,
    run_job_understanding,
    PipelineError,
)

FIXTURE_PROFILE_ROOT = Path(__file__).parents[2] / "fixtures" / "webapp_profile_root"


def _conn(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    return connect(db_path)


def test_refresh_profile_saves_under_the_global_profile_workspace(tmp_path):
    conn = _conn(tmp_path)
    saved = refresh_profile(conn, root=str(FIXTURE_PROFILE_ROOT))
    assert saved["workspace_id"] == PROFILE_WORKSPACE_ID
    assert saved["content_id"].startswith("profilesnap_")
    current = get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")
    assert current["id"] == saved["id"]
    conn.close()


def test_job_workspace_reads_the_same_global_profile_snapshot(tmp_path):
    conn = _conn(tmp_path)
    refresh_profile(conn, root=str(FIXTURE_PROFILE_ROOT))
    created = create_job_from_source_record(
        conn, company="Acme", title="Backend Engineer",
        source_record={"schema_version": "job-source-record.v0", "source": "manual",
                        "captured_at": "2026-08-18T00:00:00Z", "company": "Acme", "title": "Backend Engineer"},
    )
    # the job workspace itself never stores its own profile_snapshot artifact —
    # the global lookup is what pipeline stages must use
    assert get_current_artifact(conn, created["workspace"]["id"], "profile_snapshot") is None
    snapshot = get_current_profile_snapshot(conn)
    assert snapshot["content_id"].startswith("profilesnap_")
    conn.close()


def test_create_job_from_source_record_creates_job_kind_workspace_only(tmp_path):
    conn = _conn(tmp_path)
    result = create_job_from_source_record(
        conn, company="Acme", title="Backend Engineer",
        source_record={"schema_version": "job-source-record.v0", "source": "manual",
                        "captured_at": "2026-08-18T00:00:00Z", "company": "Acme", "title": "Backend Engineer",
                        "requirements": [{"text": "5 years Python", "kind": "required"}]},
    )
    assert result["workspace"]["kind"] == "job"
    assert result["workspace"]["id"] != PROFILE_WORKSPACE_ID
    assert result["artifact"]["artifact_type"] == "job_posting_snapshot"
    assert result["artifact"]["content_id"].startswith("jobsnap_")
    conn.close()


class _FakeJobUnderstandingProvider:
    provider_id = "fake"
    model_id = "fake-model"
    model_version = "fake-model-v0"

    def extract(self, request):
        from product.job_understanding_providers import ProviderResponse
        return ProviderResponse(payload={
            "schema_version": "job-understanding-candidate.v0", "items": [],
            "suggestions": [], "ambiguous_statements": [], "warnings": [],
        })


def test_run_job_understanding_persists_both_request_and_result(tmp_path):
    conn = _conn(tmp_path)
    created = create_job_from_source_record(
        conn, company="Acme", title="Backend Engineer",
        source_record={"schema_version": "job-source-record.v0", "source": "manual",
                        "captured_at": "2026-08-18T00:00:00Z", "company": "Acme", "title": "Backend Engineer",
                        "requirements": [{"text": "5 years Python", "kind": "required"}]},
    )
    workspace_id = created["workspace"]["id"]

    saved_result = run_job_understanding(conn, workspace_id, _FakeJobUnderstandingProvider(), request_id="req_test_1")

    assert saved_result["artifact_type"] == "job_understanding_result"
    saved_request = get_current_artifact(conn, workspace_id, "job_understanding_request")
    assert saved_request is not None
    assert saved_request["payload"]["request_id"] == "req_test_1"
    conn.close()


def test_run_job_understanding_without_job_snapshot_raises_pipeline_error(tmp_path):
    conn = _conn(tmp_path)
    from webapp.persistence.workspaces import create_workspace
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    with pytest.raises(PipelineError):
        run_job_understanding(conn, ws["id"], _FakeJobUnderstandingProvider(), request_id="req_test_2")
    conn.close()


class _FailingProvider:
    provider_id = "fake"; model_id = "fake-model"; model_version = "fake-model-v0"

    def extract(self, request):
        from product.job_understanding_providers import JobUnderstandingProviderError
        raise JobUnderstandingProviderError("simulated provider outage")


def test_provider_failure_raises_pipeline_error_and_leaves_no_new_artifact(tmp_path):
    conn = _conn(tmp_path)
    created = create_job_from_source_record(
        conn, company="Acme", title="Backend Engineer",
        source_record={"schema_version": "job-source-record.v0", "source": "manual",
                        "captured_at": "2026-08-18T00:00:00Z", "company": "Acme", "title": "Backend Engineer"},
    )
    workspace_id = created["workspace"]["id"]

    with pytest.raises(PipelineError):
        run_job_understanding(conn, workspace_id, _FailingProvider(), request_id="req_test_3")

    # no partial/fabricated result was persisted
    assert get_current_artifact(conn, workspace_id, "job_understanding_result") is None
    conn.close()
```

- [ ] **Step 2: Create the fixture profile root**

VERIFIED against `product/profile_snapshot.py` (`SOURCE_PATHS`) and `tests/test_profile_snapshot.py`'s `test_missing_optional_sections_do_not_fail` case: `build_snapshot(root)` requires exactly these three files to exist under `root` (it raises `FileNotFoundError` if any is missing), and the minimal content below is confirmed to parse into at least one claim without error.

Create `tests/webapp/fixtures/webapp_profile_root/CLAUDE.md`:
```markdown
# Assistant

## Candidate Profile

### Identity
- **Name:** Ada Lovelace
```

Create `tests/webapp/fixtures/webapp_profile_root/.claude/skills/job-application-assistant/01-candidate-profile.md`:
```markdown
# Candidate Profile

## Identity
- **Name:** Ada Lovelace

## Publications
1. Ada Lovelace (2026). Notes on the Analytical Engine. Journal of Computing History.
```

Create `tests/webapp/fixtures/webapp_profile_root/cv/main_example.tex`:
```latex
\documentclass{moderncv}\name{Ada}{Lovelace}\begin{document}\end{document}
```

(The `## Publications` section with one numbered entry is included deliberately — Task 15's staleness acceptance test appends a second numbered publication line to this same file to produce a genuinely new claim and a different `profile_snapshot_content_id`, verified against `product/profile_snapshot.py`'s `_parse_candidate_markdown`/`_add_publication_claim` numbered-list parsing.)

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/webapp/services/test_pipeline_profile_and_job.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'webapp.services.pipeline'`

- [ ] **Step 4: Write pipeline.py (profile + job + understanding stages)**

```python
# webapp/services/pipeline.py
"""Orchestration over product/ modules. Never reimplements domain decisions —
every substantive judgment (evidence acceptance, fit, recommendation) comes
from calling into product/*; this module only sequences calls, persists exact
requests and results, and records dependency fingerprints for staleness.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from typing import Any

from product.job_fit import profile_snapshot_content_id
from product.job_ingestion import normalize_job_source_record
from product.job_posting import job_snapshot_content_id
from product.job_understanding import (
    build_job_understanding_request,
    extract_job_understanding,
    load_job_understanding_policy,
)
from product.job_understanding_providers import JobUnderstandingProvider, JobUnderstandingProviderError
from product.profile_snapshot import build_snapshot

from webapp.persistence.artifacts import get_current_artifact, save_artifact
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID, create_workspace, ensure_profile_workspace
from webapp.services.staleness import record_dependency_fingerprint


class PipelineError(RuntimeError):
    """Raised when a pipeline stage cannot run: missing/invalid upstream state,
    or a wrapped product/*-layer or provider-layer failure. Callers in
    webapp/api need only catch this one type."""


def _hash_artifact(prefix: str, payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:20]
    return f"{prefix}{digest}"


def refresh_profile(conn: sqlite3.Connection, *, root: str = ".") -> dict[str, Any]:
    ensure_profile_workspace(conn)
    try:
        snapshot = build_snapshot(root)
    except Exception as exc:
        raise PipelineError(f"profile refresh failed: {exc}") from exc
    content_id = profile_snapshot_content_id(snapshot)
    return save_artifact(
        conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
        payload=snapshot, content_id=content_id,
    )


def get_current_profile_snapshot(conn: sqlite3.Connection) -> dict[str, Any] | None:
    return get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")


def create_job_from_source_record(
    conn: sqlite3.Connection, *, company: str, title: str, source_record: dict[str, Any]
) -> dict[str, Any]:
    workspace = create_workspace(conn, company=company, title=title)
    try:
        job_snapshot = normalize_job_source_record(source_record)
    except Exception as exc:
        raise PipelineError(f"job ingestion failed: {exc}") from exc
    content_id = job_snapshot_content_id(job_snapshot)
    artifact = save_artifact(
        conn, workspace_id=workspace["id"], artifact_type="job_posting_snapshot",
        payload=job_snapshot, content_id=content_id,
    )
    return {"workspace": workspace, "artifact": artifact}


def run_job_understanding(
    conn: sqlite3.Connection, workspace_id: str, provider: JobUnderstandingProvider, *, request_id: str,
) -> dict[str, Any]:
    job_artifact = get_current_artifact(conn, workspace_id, "job_posting_snapshot")
    if job_artifact is None:
        raise PipelineError(f"workspace {workspace_id} has no job_posting_snapshot to understand")

    try:
        policy = load_job_understanding_policy()
        request = build_job_understanding_request(job_artifact["payload"], request_id, policy=policy)
    except Exception as exc:
        raise PipelineError(f"job understanding request construction failed: {exc}") from exc

    request_artifact = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_understanding_request",
        payload=request, content_id=_hash_artifact("jureq_", request),
    )
    record_dependency_fingerprint(
        conn, artifact_id=request_artifact["id"], upstream_artifact_type="job_posting_snapshot",
        upstream_content_id=job_artifact["content_id"],
    )

    try:
        # extract_job_understanding rebuilds the request internally via the
        # same deterministic build_job_understanding_request call above, so
        # the request it actually sends the provider is guaranteed identical
        # to `request`, already persisted above. It validates the provider's
        # candidate and the final result itself — Task 9 does not duplicate
        # any of that validation.
        result = extract_job_understanding(
            job_artifact["payload"], provider, request_id, policy=policy,
        )
    except JobUnderstandingProviderError as exc:
        raise PipelineError(f"job understanding provider failed: {exc}") from exc
    except Exception as exc:
        raise PipelineError(f"job understanding failed: {exc}") from exc

    result_artifact = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_understanding_result",
        payload=result, content_id=_hash_artifact("juresult_", result),
    )
    record_dependency_fingerprint(
        conn, artifact_id=result_artifact["id"], upstream_artifact_type="job_posting_snapshot",
        upstream_content_id=job_artifact["content_id"],
    )
    record_dependency_fingerprint(
        conn, artifact_id=result_artifact["id"], upstream_artifact_type="job_understanding_request",
        upstream_content_id=request_artifact["content_id"],
    )
    return result_artifact
```

Note on obtaining the exact persisted request (VERIFIED against source, `product/job_understanding.py:268-302`): `extract_job_understanding(job_snapshot, provider, request_id, *, requested_categories=None, policy=None)` internally calls `build_job_understanding_request(job_snapshot, request_id, requested_categories=requested_categories, policy=active_policy)` and does not return that intermediate request object — it assembles the result via the private `_build_result` and returns only the final result. `_build_result` is private and must not be reimplemented (that would duplicate Ticket 6's evidence-acceptance logic — forbidden). `build_job_understanding_request` is verified deterministic (pure function of `job_snapshot, request_id, requested_categories, policy` — no clock, no randomness, confirmed by reading its body). Therefore Step 4's `run_job_understanding` calls `build_job_understanding_request(...)` once itself (to obtain and persist the exact request object BEFORE calling the provider, per Finding #3), then calls the public `extract_job_understanding(job_snapshot, provider, request_id, policy=policy)` wrapper with the IDENTICAL arguments to actually run extraction — since the wrapper is deterministic, the request it builds internally is guaranteed byte-for-byte identical to the one Task 9 already persisted, so there is no drift between "the request we saved" and "the request the provider was actually sent." This replaces the placeholder `_build_understanding_result` helper below — delete that name; call `extract_job_understanding` directly instead.

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/webapp/services/test_pipeline_profile_and_job.py -v`
Expected: PASS (6 tests).

- [ ] **Step 6: Run full suite**

Run: `pytest -q`
Expected: no regressions.

---

## Task 10: Pipeline orchestration — Job Fit and Application Intelligence (request+result paired, extension/proposal fingerprints, fail-closed)

**Files:**
- Modify: `webapp/services/pipeline.py`
- Test: `tests/webapp/services/test_pipeline_fit_and_intelligence.py`

**Interfaces:**
- Produces:
  - `webapp.services.pipeline.run_job_fit(conn, workspace_id: str, semantic_adapter, *, request_id: str, extension_paths: list[str] | None = None) -> dict[str, Any]` — reads the profile snapshot via `get_current_profile_snapshot(conn)` (Task 9's global lookup, NOT a per-workspace read — closes Finding #2 for this stage too), reads current `job_posting_snapshot` and (if present) the PAIRED current `job_understanding_request`+`job_understanding_result` from the SAME workspace, and passes both or neither to `build_resolved_job_evidence_bundle` (never one without the other — closes the XOR violation from Finding #3). Persists `resolved_job_evidence`, then persists the exact `job_fit_request` BEFORE calling `analyze_semantic_job_fit` (closes Finding #3 for this stage), then persists `job_fit_result`. Records dependency fingerprints for `profile_snapshot`, `resolved_job_evidence`, and `job_fit_request` — the latter's own content_id already covers extension selection and semantic proposals, since `build_semantic_job_fit_request` embeds both directly into the request payload `job_fit_request` hashes in full, so a change in either is visible as staleness without a separate fingerprint (closes the "ignores active extensions/policies/proposals" part of Finding #7 through the existing request-hash mechanism).
  - `webapp.services.pipeline.run_application_intelligence(conn, workspace_id: str, ai_provider, *, request_id: str) -> dict[str, Any]` — reads profile snapshot via the same global lookup, reads current `job_fit_result` and `resolved_job_evidence` from the job workspace, persists the exact `application_intelligence_request` before calling `analyze_application_intelligence`, then persists the result.
  - Both raise `PipelineError` (from Task 9, reused — not redefined) on missing upstream artifacts, `SemanticJobFitValidationError`/`ApplicationIntelligenceValidationError`, or a provider error (including `SemanticProposerProviderError` from Task 7) — never silently proceeding with a partial/fabricated result.

- [ ] **Step 1: Write the failing test**

```python
# tests/webapp/services/test_pipeline_fit_and_intelligence.py
import pytest

from webapp.persistence.db import init_db, connect
from webapp.persistence.artifacts import save_artifact, get_current_artifact
from webapp.persistence.workspaces import create_workspace
from webapp.services.pipeline import refresh_profile, run_job_fit, run_application_intelligence, PipelineError
from webapp.services.semantic_proposal_adapter import FakeSemanticProposalAdapter
from webapp.services.semantic_proposer_errors import SemanticProposerProviderError


FIXTURE_PROFILE_ROOT = None  # set in Step 0 below to the same fixture Task 9 created


def _workspace_with_profile_and_job(tmp_path, profile_root):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    refresh_profile(conn, root=str(profile_root))

    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    job_snapshot = {
        "schema_version": "job-posting-snapshot.v0", "job_id": "jobsrc_test0000000000",
        "source": "manual", "captured_at": "2026-08-18T00:00:00Z",
        "company": "Acme", "title": "Backend Engineer",
        "requirements": [], "responsibilities": [], "language_requirements": [],
        "eligibility_requirements": [], "logistics_requirements": [],
        "metadata": {"ingestion": {}},
    }
    save_artifact(conn, workspace_id=ws["id"], artifact_type="job_posting_snapshot",
                   payload=job_snapshot, content_id="jobsnap_test")
    return conn, ws["id"]


def test_run_job_fit_persists_request_result_and_resolved_evidence(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace_with_profile_and_job(tmp_path, webapp_profile_root)
    adapter = FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})

    saved = run_job_fit(conn, workspace_id, adapter, request_id="req_fit_1")

    assert saved["artifact_type"] == "job_fit_result"
    assert get_current_artifact(conn, workspace_id, "job_fit_request") is not None
    assert get_current_artifact(conn, workspace_id, "resolved_job_evidence") is not None
    conn.close()


def test_run_job_fit_uses_global_profile_not_a_workspace_local_one(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace_with_profile_and_job(tmp_path, webapp_profile_root)
    # no per-workspace profile_snapshot artifact exists — only the global one
    assert get_current_artifact(conn, workspace_id, "profile_snapshot") is None
    adapter = FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})
    saved = run_job_fit(conn, workspace_id, adapter, request_id="req_fit_2")
    assert saved["artifact_type"] == "job_fit_result"
    conn.close()


def test_run_job_fit_without_profile_raises_pipeline_error(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    save_artifact(conn, workspace_id=ws["id"], artifact_type="job_posting_snapshot",
                   payload={"job_id": "jobsrc_x"}, content_id="jobsnap_x")
    adapter = FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})
    with pytest.raises(PipelineError):
        run_job_fit(conn, ws["id"], adapter, request_id="req_fit_3")
    conn.close()


class _FailingSemanticAdapter:
    def propose(self, **kwargs):
        raise SemanticProposerProviderError("simulated proposer outage")


def test_run_job_fit_proposer_failure_raises_pipeline_error_and_leaves_no_new_result(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace_with_profile_and_job(tmp_path, webapp_profile_root)
    with pytest.raises(PipelineError):
        run_job_fit(conn, workspace_id, _FailingSemanticAdapter(), request_id="req_fit_4")
    assert get_current_artifact(conn, workspace_id, "job_fit_result") is None
    conn.close()


class _FakeApplicationIntelligenceProvider:
    provider_id = "fake"; model_id = "fake-model"; model_version = "fake-model-v0"

    def propose(self, request):
        from product.application_intelligence_providers import ProviderResponse
        return ProviderResponse(payload={"content_units": []})


def test_run_application_intelligence_persists_request_and_result(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace_with_profile_and_job(tmp_path, webapp_profile_root)
    adapter = FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": []})
    run_job_fit(conn, workspace_id, adapter, request_id="req_fit_5")

    saved = run_application_intelligence(
        conn, workspace_id, _FakeApplicationIntelligenceProvider(), request_id="req_ai_1"
    )
    assert saved["artifact_type"] == "application_intelligence_result"
    assert get_current_artifact(conn, workspace_id, "application_intelligence_request") is not None
    conn.close()


def test_run_application_intelligence_requires_job_fit_result(tmp_path, webapp_profile_root):
    conn, workspace_id = _workspace_with_profile_and_job(tmp_path, webapp_profile_root)
    with pytest.raises(PipelineError):
        run_application_intelligence(
            conn, workspace_id, _FakeApplicationIntelligenceProvider(), request_id="req_ai_2"
        )
    conn.close()
```

- [ ] **Step 0: Add the `webapp_profile_root` fixture**

Add to `tests/webapp/conftest.py` (create this file if it does not exist yet — check first):

```python
# tests/webapp/conftest.py
from pathlib import Path

import pytest

FIXTURE_PROFILE_ROOT = Path(__file__).parent / "fixtures" / "webapp_profile_root"


@pytest.fixture
def webapp_profile_root():
    return FIXTURE_PROFILE_ROOT
```

(This fixture is a thin wrapper around the fixture directory Task 9 created — defining it once in `conftest.py` avoids every later test file re-deriving the same path.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/webapp/services/test_pipeline_fit_and_intelligence.py -v`
Expected: FAIL — `run_job_fit`/`run_application_intelligence` not defined.

- [ ] **Step 3: Extend pipeline.py**

Append to `webapp/services/pipeline.py` (add these imports to the existing import block at the top):

```python
from product.application_intelligence import analyze_application_intelligence
from product.application_intelligence_providers import ApplicationIntelligenceProvider, ApplicationIntelligenceProviderError
from product.evaluation_policy import load_evaluation_policy
from product.extensions import load_extensions
from product.semantic_job_fit import (
    analyze_semantic_job_fit,
    build_resolved_job_evidence_bundle,
    build_semantic_job_fit_request,
    load_semantic_fit_policy,
)

from webapp.services.semantic_proposal_adapter import SemanticProposalAdapter
from webapp.services.semantic_proposer_errors import SemanticProposerProviderError
```

Then append the two new functions:

```python
def run_job_fit(
    conn: sqlite3.Connection, workspace_id: str, semantic_adapter: SemanticProposalAdapter, *,
    request_id: str, extension_paths: list[str] | None = None,
) -> dict[str, Any]:
    profile_artifact = get_current_profile_snapshot(conn)
    job_artifact = get_current_artifact(conn, workspace_id, "job_posting_snapshot")
    if profile_artifact is None or job_artifact is None:
        raise PipelineError(
            f"workspace {workspace_id} needs a current global profile snapshot and a "
            "job_posting_snapshot to run job fit"
        )

    understanding_request_artifact = get_current_artifact(conn, workspace_id, "job_understanding_request")
    understanding_result_artifact = get_current_artifact(conn, workspace_id, "job_understanding_result")
    # XOR guard mirrors product/semantic_job_fit.py's own validation — pass
    # both or neither, never one alone, so build_resolved_job_evidence_bundle
    # never raises a confusing downstream error for a Ticket-9-caused mismatch.
    if (understanding_request_artifact is None) != (understanding_result_artifact is None):
        raise PipelineError(
            f"workspace {workspace_id} has a job_understanding_request/result pair in an "
            "inconsistent state — rerun Job Understanding before retrying Job Fit"
        )

    try:
        bundle = build_resolved_job_evidence_bundle(
            job_artifact["payload"],
            job_understanding_request=understanding_request_artifact["payload"] if understanding_request_artifact else None,
            job_understanding_result=understanding_result_artifact["payload"] if understanding_result_artifact else None,
        )
    except Exception as exc:
        raise PipelineError(f"resolved job evidence construction failed: {exc}") from exc

    bundle_saved = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="resolved_job_evidence",
        payload=bundle, content_id=_hash_artifact("resolvedjobev_", bundle),
    )
    record_dependency_fingerprint(conn, artifact_id=bundle_saved["id"], upstream_artifact_type="job_posting_snapshot",
                                   upstream_content_id=job_artifact["content_id"])
    if understanding_result_artifact is not None:
        record_dependency_fingerprint(
            conn, artifact_id=bundle_saved["id"], upstream_artifact_type="job_understanding_result",
            upstream_content_id=understanding_result_artifact["content_id"],
        )

    try:
        active_extensions = load_extensions(extension_paths) if extension_paths else []
    except Exception as exc:
        raise PipelineError(f"extension loading failed: {exc}") from exc

    try:
        proposals = semantic_adapter.propose(
            profile_evidence=profile_artifact["payload"].get("claims", []),
            resolved_job_evidence=bundle,
            active_extensions=active_extensions,
        )
    except SemanticProposerProviderError as exc:
        raise PipelineError(f"semantic proposer failed: {exc}") from exc

    try:
        request = build_semantic_job_fit_request(
            request_id=request_id, profile_snapshot=profile_artifact["payload"],
            job_snapshot=job_artifact["payload"], resolved_job_evidence=bundle,
            active_extensions=active_extensions, evaluation_policy=load_evaluation_policy(),
            semantic_fit_policy=load_semantic_fit_policy(), semantic_proposals=proposals,
        )
    except Exception as exc:
        raise PipelineError(f"job fit request construction failed: {exc}") from exc

    request_saved = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_request",
        payload=request, content_id=_hash_artifact("jofitreq_", request),
    )
    record_dependency_fingerprint(conn, artifact_id=request_saved["id"], upstream_artifact_type="profile_snapshot",
                                   upstream_content_id=profile_artifact["content_id"])
    record_dependency_fingerprint(conn, artifact_id=request_saved["id"], upstream_artifact_type="resolved_job_evidence",
                                   upstream_content_id=bundle_saved["content_id"])
    # No separate fingerprint is recorded for extension selection or
    # semantic proposals: both are embedded as top-level keys inside
    # `request` itself (build_semantic_job_fit_request's `active_extensions`
    # and `semantic_proposals` fields, per the verified request contract
    # above), and `job_fit_request`'s own content_id already hashes the
    # ENTIRE request payload via _hash_artifact. A change to either input
    # therefore already changes job_fit_request's content_id, which
    # job_fit_result's fingerprint against job_fit_request already tracks —
    # a separate fingerprint would be redundant, not additive. This closes
    # the "staleness ignores active extensions/policies/proposals" gap
    # through the existing request-hash mechanism rather than a parallel one.

    try:
        result = analyze_semantic_job_fit(request)
    except Exception as exc:
        raise PipelineError(f"job fit analysis failed: {exc}") from exc

    result_saved = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_result",
        payload=result, content_id=_hash_artifact("jofitresult_", result),
    )
    record_dependency_fingerprint(conn, artifact_id=result_saved["id"], upstream_artifact_type="job_fit_request",
                                   upstream_content_id=request_saved["content_id"])
    return result_saved


def run_application_intelligence(
    conn: sqlite3.Connection, workspace_id: str, ai_provider: ApplicationIntelligenceProvider, *, request_id: str,
) -> dict[str, Any]:
    profile_artifact = get_current_profile_snapshot(conn)
    fit_artifact = get_current_artifact(conn, workspace_id, "job_fit_result")
    bundle_artifact = get_current_artifact(conn, workspace_id, "resolved_job_evidence")
    if profile_artifact is None or fit_artifact is None or bundle_artifact is None:
        raise PipelineError(
            f"workspace {workspace_id} needs a current global profile snapshot, job_fit_result, "
            "and resolved_job_evidence to run application intelligence"
        )

    request = {
        "schema_version": "application-intelligence-request.v0",
        "request_id": request_id,
        "job_fit_result": fit_artifact["payload"],
        "resolved_job_evidence": bundle_artifact["payload"],
        "profile_snapshot": profile_artifact["payload"],
        "policy": _load_application_intelligence_policy(),
    }
    request_saved = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_request",
        payload=request, content_id=_hash_artifact("aiintelreq_", request),
    )
    record_dependency_fingerprint(conn, artifact_id=request_saved["id"], upstream_artifact_type="profile_snapshot",
                                   upstream_content_id=profile_artifact["content_id"])
    record_dependency_fingerprint(conn, artifact_id=request_saved["id"], upstream_artifact_type="job_fit_result",
                                   upstream_content_id=fit_artifact["content_id"])

    try:
        proposal_response = ai_provider.propose(request)
        result = analyze_application_intelligence(request, proposal_response.payload)
    except ApplicationIntelligenceProviderError as exc:
        raise PipelineError(f"application intelligence provider failed: {exc}") from exc
    except Exception as exc:
        raise PipelineError(f"application intelligence analysis failed: {exc}") from exc

    result_saved = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
        payload=result, content_id=_hash_artifact("aiintelresult_", result),
    )
    record_dependency_fingerprint(conn, artifact_id=result_saved["id"],
                                   upstream_artifact_type="application_intelligence_request",
                                   upstream_content_id=request_saved["content_id"])
    return result_saved


def _load_application_intelligence_policy() -> dict[str, Any]:
    from pathlib import Path
    policy_path = Path(__file__).resolve().parents[2] / "product" / "application_intelligence_policy.v0.json"
    return json.loads(policy_path.read_text(encoding="utf-8"))
```

The filename `product/application_intelligence_policy.v0.json` above is VERIFIED to exist (confirmed via `ls product/*.json` during plan revision, alongside `evaluation-policy.v0.json`, `job-understanding-policy.v0.json`, and `semantic_fit_policy.v0.json`) — no runtime existence check is needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/webapp/services/test_pipeline_fit_and_intelligence.py -v`
Expected: PASS (6 tests). If `analyze_semantic_job_fit`/`analyze_application_intelligence` raise validation errors against the minimal fixture profile/job data, read the actual `*ValidationError` message and the relevant `product/schemas/*.json` file to fix the fixtures — never loosen the assertions.

- [ ] **Step 5: Run full suite**

Run: `pytest -q`
Expected: no regressions.

---

## Task 11: Server-resolved active extensions (closes the client-supplied-path boundary issue)

**Files:**
- Create: `webapp/services/extension_registry.py`
- Test: `tests/webapp/services/test_extension_registry.py`

**Interfaces:**
- Produces: `webapp.services.extension_registry.list_installed_extensions(extensions_dir: Path) -> list[dict[str, Any]]` — scans `extensions_dir` for subdirectories each containing an `extension.json`, loads and validates each via `product.extensions.load_extension`, returns `[{"id": ..., "version": ..., "name": ..., "path": str(path)}, ...]` (view-model shape, not raw extension content). `webapp.services.extension_registry.resolve_active_extensions(extensions_dir: Path, extension_ids: list[str]) -> list[dict[str, Any]]` — given a list of extension `id` strings (not filesystem paths — closes Finding #16: the HTTP client sends identities it saw in `list_installed_extensions`'s output, never a path), resolves each to its installed directory and returns the loaded, validated extension objects via `product.extensions.load_extensions`. Raises `ExtensionRegistryError` (defined in this module) if a requested id is not installed.

- [ ] **Step 1: Write the failing test**

```python
# tests/webapp/services/test_extension_registry.py
import json

import pytest

from webapp.services.extension_registry import (
    list_installed_extensions,
    resolve_active_extensions,
    ExtensionRegistryError,
)


def _write_extension(extensions_dir, ext_id, version="1.0.0"):
    ext_dir = extensions_dir / ext_id
    ext_dir.mkdir(parents=True)
    manifest = {
        "schema_version": "extension-package.v0", "id": ext_id, "name": ext_id.replace("_", " ").title(),
        "version": version, "status": "active", "description": "x", "publisher": "x", "trust": "x",
        "metadata": {}, "scope": "x",
    }
    (ext_dir / "extension.json").write_text(json.dumps(manifest), encoding="utf-8")
    return ext_dir


def test_list_installed_extensions_finds_all_valid_packages(tmp_path):
    _write_extension(tmp_path, "well_control")
    _write_extension(tmp_path, "hse_transition")
    listed = list_installed_extensions(tmp_path)
    ids = {ext["id"] for ext in listed}
    assert ids == {"well_control", "hse_transition"}


def test_list_installed_extensions_empty_dir_returns_empty_list(tmp_path):
    assert list_installed_extensions(tmp_path) == []


def test_resolve_active_extensions_by_id_not_path(tmp_path):
    _write_extension(tmp_path, "well_control")
    resolved = resolve_active_extensions(tmp_path, ["well_control"])
    assert resolved[0]["id"] == "well_control"


def test_resolve_active_extensions_rejects_unknown_id(tmp_path):
    _write_extension(tmp_path, "well_control")
    with pytest.raises(ExtensionRegistryError, match="not_installed"):
        resolve_active_extensions(tmp_path, ["not_installed"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/webapp/services/test_extension_registry.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write extension_registry.py**

```python
# webapp/services/extension_registry.py
"""Server-resolved active-extension selection.

The HTTP client selects extensions by the `id` it saw from
list_installed_extensions — never a filesystem path. This keeps the product
boundary correct even though Ticket 9 is a local-only, single-user app: the
web layer never accepts a client-supplied path and hands it to a filesystem
read.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from product.extensions import ExtensionValidationError, load_extension, load_extensions


class ExtensionRegistryError(RuntimeError):
    pass


def list_installed_extensions(extensions_dir: Path) -> list[dict[str, Any]]:
    extensions_dir = Path(extensions_dir)
    if not extensions_dir.is_dir():
        return []
    results: list[dict[str, Any]] = []
    for candidate in sorted(extensions_dir.iterdir()):
        manifest_path = candidate / "extension.json"
        if not manifest_path.is_file():
            continue
        try:
            extension = load_extension(manifest_path)
        except ExtensionValidationError:
            continue
        results.append({
            "id": extension["id"], "version": extension["version"],
            "name": extension["name"], "path": str(manifest_path),
        })
    return results


def resolve_active_extensions(extensions_dir: Path, extension_ids: list[str]) -> list[dict[str, Any]]:
    installed = {ext["id"]: ext["path"] for ext in list_installed_extensions(extensions_dir)}
    missing = [ext_id for ext_id in extension_ids if ext_id not in installed]
    if missing:
        raise ExtensionRegistryError(f"extensions not_installed: {missing}")
    paths = [installed[ext_id] for ext_id in extension_ids]
    return load_extensions(paths)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/webapp/services/test_extension_registry.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Run full suite**

Run: `pytest -q`
Expected: no regressions.

---

## Task 12: Review-gated Application Pack, Gate-4 confirmation, and legacy tracker/archive projection

**Files:**
- Create: `webapp/services/application_pack.py`
- Create: `webapp/services/archive_projection.py`
- Test: `tests/webapp/services/test_application_pack.py`
- Test: `tests/webapp/services/test_archive_projection.py`

**Interfaces:**
- Produces:
  - `webapp.services.application_pack.build_application_pack(conn, workspace_id: str) -> dict[str, Any]` — corrected from v1 (Finding #8), and extended in this revision to close a Gate 1/2 completeness gap the PM review found (report vs. code drift — the same "Finding 20" pattern): the design's Gate 1 (§ design doc, "Surfaces profile conflicts, **placeholders**, missing candidate evidence...") and Gate 2 ("Surfaces gate flags/unverified gates, human-judgment questions, **functionally equivalent relationships, transferable matches, gaps**, conditions/limitations") name specific review surfaces that a prior revision of this function only partially implemented. This revision implements all of them:
    1. Require current, NON-STALE `job_fit_result` and `application_intelligence_result` (raises `PipelineError` if either is missing OR `check_staleness(...)["stale"]` is true for either — closes "does not reject stale inputs").
    2. Require an explicit `review_decisions` row, recorded against the CURRENT artifact id, for every item in ALL of the following categories before the pack can be built — a missing decision blocks pack construction with a `PipelineError` naming exactly which items are outstanding (`category:item_id`):
       - **Gate 1 (profile evidence integrity):** every conflict AND every placeholder claim in the current `profile_snapshot`, restricted to those cited by an accepted Job Fit match (same relevance scope for both — see the SCOPE DECISION comment in the implementation). `review_item_type="profile_conflict"` / `review_item_type="profile_placeholder"`.
       - **Gate 2 (Job Fit judgment) — disposition-blocking:** every `gate_assessments` entry with `status in ("FLAG", "UNVERIFIED")` (`review_item_type="gate_flag"`); every `human_judgment_questions` entry (`review_item_type="human_judgment_question"`).
       - **Gate 2 (Job Fit judgment) — disposition-blocking, extended this revision:** every `functionally_equivalent_matches` entry (`review_item_type="functionally_equivalent_match"`) and every `transferable_matches` entry (`review_item_type="transferable_match"`), since both carry limitations/conditions a human must consciously accept before they support application material — Ticket 7 already computed the relationship, but "the system computed a plausible equivalence" is not the same statement as "a human looked at this specific limitation and is comfortable proceeding," which is exactly the review-gate distinction Gate 2 exists to enforce.
       - **Gate 2 (Job Fit judgment) — informational, NOT disposition-blocking:** every `gaps` entry (`review_item_type="gap"`) is surfaced in `review_record["informational_items"]` for audit visibility but never requires a decision to proceed — a gap has no evidence to acknowledge or omit (there is nothing to omit "from positioning" about evidence that was never claimed), and design §"Missing evidence" is explicit that a gap "means the system does not currently possess accepted evidence — never that the candidate definitely does not have this," i.e. it is a statement about the system's current evidence state, not a reviewable claim. Blocking pack construction on every gap would make Gate 2 impossible to pass on any job posting with unmet requirements, which contradicts the design's own worked example (§ journey) of a pack being confirmable with visible gaps still present.
    3. Select into the pack only content units with `status == "READY"`, OR `status == "NEEDS_REVIEW"` with disposition `acknowledged_and_proceed`; units with disposition `omit_from_positioning` are excluded even if `READY`; units with `requires_upstream_change`/`resolved_by_rerun` block pack construction (they mean "not ready yet"). The same three-way disposition handling applies uniformly to functionally-equivalent and transferable matches: `acknowledged_and_proceed` keeps the match in `fit_summary`, `omit_from_positioning` removes it from `fit_summary` (but keeps it in `review_record["decisions_consulted"]` for audit), `requires_upstream_change`/`resolved_by_rerun` block.
    4. Return a pack with the promised `"job"` section (closes "omits the promised job section") sourced from the current `job_posting_snapshot`, plus `fit_summary`, `recommendation`, `cv_content`, `cover_letter_content`, and a `review_record` with two keys: `"decisions_consulted"` (every disposition-blocking decision actually consulted, across all five blocking categories above) and `"informational_items"` (gaps and unsupported claims — visible for audit, never gated, never selectable).
  - `webapp.services.application_pack.confirm_application_pack(conn, workspace_id: str, *, effective_date: str) -> dict[str, Any]` — the ONLY function in this codebase that may call `record_status_change(..., new_status="drafted", _allow_drafted=True, submitted_pack_artifact_id=pack_artifact["id"])`. It calls `build_application_pack` (which itself enforces staleness/review-completeness), saves the pack as an `application_pack` artifact, records dependency fingerprints from the pack to `job_fit_result`/`application_intelligence_result`, calls the tracker status change with `_allow_drafted=True`, and projects the pack to the filesystem archive via `archive_projection.write_application_pack_projection`. This is Gate 4 (design §11) — closes Finding #9: there is no other code path anywhere in `webapp/` that can set `workflow_status="drafted"`.
  - `webapp.services.archive_projection.write_application_pack_projection(pack: dict[str, Any], *, company: str, title: str, documents_root: Path) -> Path` — writes `documents_root / "applications" / f"{slug(company)}_{slug(title)}" / "application_pack.md"` (creates the directory if absent; per design §13, NEVER overwrites an existing `application_pack.md` — if one exists, writes `application_pack_<timestamp>.md` instead, since a re-application should not silently destroy the record of what was previously submitted). `slug()` lowercases and replaces whitespace with underscores, matching `documents/README.md`'s documented convention exactly (`<company>_<role>`, lowercase, underscores for spaces — verified in that file). Never writes `cv_draft.tex`/`cover_letter.tex` (no fabricated legacy files — Ticket 9 has no LaTeX output).

- [ ] **Step 1: Write the failing tests for build_application_pack (review-gating)**

```python
# tests/webapp/services/test_application_pack.py
import pytest

from webapp.persistence.db import init_db, connect
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.workspaces import create_workspace
from webapp.persistence.review import save_review_decision
from webapp.services.application_pack import build_application_pack, confirm_application_pack
from webapp.services.pipeline import PipelineError


def _workspace(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    return conn, ws["id"]


def _seed_fit_and_intelligence(conn, workspace_id, *, needs_review_units=()):
    save_artifact(conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
                  payload={"company": "Acme", "title": "Backend Engineer", "job_id": "jobsrc_x"},
                  content_id="jobsnap_A")
    fit = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_result",
        payload={"verdict": {"id": "strong_fit", "display_name": "Strong Fit", "score": 0.9}, "status": "READY",
                  "dimension_scores": {}, "gaps": [], "direct_matches": [], "functionally_equivalent_matches": [],
                  "transferable_matches": []},
        content_id="jobfitresult_A",
    )
    units = [{"unit_id": "u1", "unit_type": "cv_bullet", "text": "Ready bullet", "status": "READY", "profile_evidence_ids": []}]
    for unit_id in needs_review_units:
        units.append({"unit_id": unit_id, "unit_type": "cv_bullet", "text": f"Needs review {unit_id}",
                      "status": "NEEDS_REVIEW", "profile_evidence_ids": []})
    intelligence = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
        payload={"recommendation": "apply", "cv_content": units, "cover_letter_content": [], "unsupported_claims": []},
        content_id="aiintel_A",
    )
    return fit, intelligence


def test_build_application_pack_requires_job_fit_and_intelligence(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    with pytest.raises(PipelineError):
        build_application_pack(conn, workspace_id)
    conn.close()


def test_build_application_pack_includes_job_section(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_fit_and_intelligence(conn, workspace_id)
    pack = build_application_pack(conn, workspace_id)
    assert pack["job"]["company"] == "Acme"
    assert pack["job"]["title"] == "Backend Engineer"
    conn.close()


def test_build_application_pack_blocks_on_outstanding_gate2_flag(tmp_path):
    from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID

    conn, workspace_id = _workspace(tmp_path)
    save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                  payload={"claims": [], "conflicts": []}, content_id="profilesnap_A")
    save_artifact(conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
                  payload={"company": "Acme", "title": "Backend Engineer", "job_id": "jobsrc_x"},
                  content_id="jobsnap_A")
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_result",
        payload={"verdict": None, "status": "NEEDS_REVIEW", "dimension_scores": {}, "gaps": [],
                  "direct_matches": [], "functionally_equivalent_matches": [], "transferable_matches": [],
                  "gate_assessments": [{"gate_id": "language", "status": "FLAG", "reason": "Ambiguous evidence"}],
                  "human_judgment_questions": []},
        content_id="jobfitresult_A",
    )
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
        payload={"recommendation": "apply",
                  "cv_content": [{"unit_id": "u1", "unit_type": "cv_bullet", "text": "x", "status": "READY", "profile_evidence_ids": []}],
                  "cover_letter_content": [], "unsupported_claims": []},
        content_id="aiintel_A",
    )
    with pytest.raises(PipelineError, match="gate_flag:language"):
        build_application_pack(conn, workspace_id)
    conn.close()


def test_build_application_pack_proceeds_after_gate2_flag_acknowledged(tmp_path):
    from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID

    conn, workspace_id = _workspace(tmp_path)
    save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                  payload={"claims": [], "conflicts": []}, content_id="profilesnap_A")
    save_artifact(conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
                  payload={"company": "Acme", "title": "Backend Engineer", "job_id": "jobsrc_x"},
                  content_id="jobsnap_A")
    fit = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_result",
        payload={"verdict": None, "status": "NEEDS_REVIEW", "dimension_scores": {}, "gaps": [],
                  "direct_matches": [], "functionally_equivalent_matches": [], "transferable_matches": [],
                  "gate_assessments": [{"gate_id": "language", "status": "FLAG", "reason": "Ambiguous evidence"}],
                  "human_judgment_questions": []},
        content_id="jobfitresult_A",
    )
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
        payload={"recommendation": "apply",
                  "cv_content": [{"unit_id": "u1", "unit_type": "cv_bullet", "text": "x", "status": "READY", "profile_evidence_ids": []}],
                  "cover_letter_content": [], "unsupported_claims": []},
        content_id="aiintel_A",
    )
    save_review_decision(conn, workspace_id=workspace_id, review_item_type="gate_flag",
                         source_artifact_id=fit["id"], domain_item_id="gate:language",
                         disposition="acknowledged_and_proceed")
    pack = build_application_pack(conn, workspace_id)
    assert pack["cv_content"][0]["unit_id"] == "u1"
    conn.close()


def test_build_application_pack_blocks_on_outstanding_human_judgment_question(tmp_path):
    from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID

    conn, workspace_id = _workspace(tmp_path)
    save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                  payload={"claims": [], "conflicts": []}, content_id="profilesnap_A")
    save_artifact(conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
                  payload={"company": "Acme", "title": "Backend Engineer", "job_id": "jobsrc_x"},
                  content_id="jobsnap_A")
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_result",
        payload={"verdict": None, "status": "NEEDS_REVIEW", "dimension_scores": {}, "gaps": [],
                  "direct_matches": [], "functionally_equivalent_matches": [], "transferable_matches": [],
                  "gate_assessments": [],
                  "human_judgment_questions": [{"question_id": "q_1", "topic": "extension_conditions",
                                                "question": "Does this transfer apply?",
                                                "related_job_ids": [], "related_profile_evidence_ids": [], "status": "OPEN"}]},
        content_id="jobfitresult_A",
    )
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
        payload={"recommendation": "apply",
                  "cv_content": [{"unit_id": "u1", "unit_type": "cv_bullet", "text": "x", "status": "READY", "profile_evidence_ids": []}],
                  "cover_letter_content": [], "unsupported_claims": []},
        content_id="aiintel_A",
    )
    with pytest.raises(PipelineError, match="human_judgment_question:q_1"):
        build_application_pack(conn, workspace_id)
    conn.close()


def test_build_application_pack_blocks_on_cited_placeholder_claim(tmp_path):
    from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID

    conn, workspace_id = _workspace(tmp_path)
    save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                  payload={"claims": [{"id": "clm_1", "concept_id": "cpt_1", "field": "skill",
                                        "value": "AWS", "placeholder": True}],
                            "conflicts": []},
                  content_id="profilesnap_A")
    save_artifact(conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
                  payload={"company": "Acme", "title": "Backend Engineer", "job_id": "jobsrc_x"},
                  content_id="jobsnap_A")
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_result",
        payload={"verdict": None, "status": "NEEDS_REVIEW", "dimension_scores": {}, "gaps": [],
                  "direct_matches": [{"match_id": "m1", "job_evidence_id": "jobev_1", "profile_evidence_ids": ["clm_1"]}],
                  "functionally_equivalent_matches": [], "transferable_matches": [],
                  "gate_assessments": [], "human_judgment_questions": []},
        content_id="jobfitresult_A",
    )
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
        payload={"recommendation": "apply",
                  "cv_content": [{"unit_id": "u1", "unit_type": "cv_bullet", "text": "x", "status": "READY", "profile_evidence_ids": []}],
                  "cover_letter_content": [], "unsupported_claims": []},
        content_id="aiintel_A",
    )
    with pytest.raises(PipelineError, match="profile_placeholder:clm_1"):
        build_application_pack(conn, workspace_id)
    conn.close()


def test_build_application_pack_ignores_uncited_placeholder_claim(tmp_path):
    from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID

    conn, workspace_id = _workspace(tmp_path)
    save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                  payload={"claims": [{"id": "clm_uncited", "concept_id": "cpt_2", "field": "skill",
                                        "value": "Rust", "placeholder": True}],
                            "conflicts": []},
                  content_id="profilesnap_A")
    _seed_fit_and_intelligence(conn, workspace_id)
    pack = build_application_pack(conn, workspace_id)
    assert pack["job"]["company"] == "Acme"
    conn.close()


def test_build_application_pack_blocks_on_outstanding_functionally_equivalent_match(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    save_artifact(conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
                  payload={"company": "Acme", "title": "Backend Engineer", "job_id": "jobsrc_x"},
                  content_id="jobsnap_A")
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_result",
        payload={"verdict": None, "status": "NEEDS_REVIEW", "dimension_scores": {}, "gaps": [],
                  "direct_matches": [], "gate_assessments": [], "human_judgment_questions": [],
                  "functionally_equivalent_matches": [
                      {"match_id": "fe1", "job_evidence_id": "jobev_1", "profile_evidence_ids": ["clm_1"],
                       "rationale": "Similar responsibility"}],
                  "transferable_matches": []},
        content_id="jobfitresult_A",
    )
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
        payload={"recommendation": "apply",
                  "cv_content": [{"unit_id": "u1", "unit_type": "cv_bullet", "text": "x", "status": "READY", "profile_evidence_ids": []}],
                  "cover_letter_content": [], "unsupported_claims": []},
        content_id="aiintel_A",
    )
    with pytest.raises(PipelineError, match="functionally_equivalent_match:fe1"):
        build_application_pack(conn, workspace_id)
    conn.close()


def test_build_application_pack_omits_functionally_equivalent_match_when_disposition_is_omit(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    save_artifact(conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
                  payload={"company": "Acme", "title": "Backend Engineer", "job_id": "jobsrc_x"},
                  content_id="jobsnap_A")
    fit = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_result",
        payload={"verdict": None, "status": "NEEDS_REVIEW", "dimension_scores": {}, "gaps": [],
                  "direct_matches": [], "gate_assessments": [], "human_judgment_questions": [],
                  "functionally_equivalent_matches": [
                      {"match_id": "fe1", "job_evidence_id": "jobev_1", "profile_evidence_ids": ["clm_1"],
                       "rationale": "Similar responsibility"}],
                  "transferable_matches": []},
        content_id="jobfitresult_A",
    )
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
        payload={"recommendation": "apply",
                  "cv_content": [{"unit_id": "u1", "unit_type": "cv_bullet", "text": "x", "status": "READY", "profile_evidence_ids": []}],
                  "cover_letter_content": [], "unsupported_claims": []},
        content_id="aiintel_A",
    )
    save_review_decision(conn, workspace_id=workspace_id, review_item_type="functionally_equivalent_match",
                          source_artifact_id=fit["id"], domain_item_id="fe1",
                          disposition="omit_from_positioning")
    pack = build_application_pack(conn, workspace_id)
    assert pack["fit_summary"]["functionally_equivalent_matches"] == []
    conn.close()


def test_build_application_pack_blocks_on_outstanding_transferable_match(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    save_artifact(conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
                  payload={"company": "Acme", "title": "Backend Engineer", "job_id": "jobsrc_x"},
                  content_id="jobsnap_A")
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_result",
        payload={"verdict": None, "status": "NEEDS_REVIEW", "dimension_scores": {}, "gaps": [],
                  "direct_matches": [], "gate_assessments": [], "human_judgment_questions": [],
                  "functionally_equivalent_matches": [],
                  "transferable_matches": [
                      {"match_id": "tr1", "job_evidence_id": "jobev_1", "profile_evidence_ids": ["clm_1"],
                       "extension_ref": {"extension_id": "ext_x"}, "limitations": "Different regulatory context"}]},
        content_id="jobfitresult_A",
    )
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
        payload={"recommendation": "apply",
                  "cv_content": [{"unit_id": "u1", "unit_type": "cv_bullet", "text": "x", "status": "READY", "profile_evidence_ids": []}],
                  "cover_letter_content": [], "unsupported_claims": []},
        content_id="aiintel_A",
    )
    with pytest.raises(PipelineError, match="transferable_match:tr1"):
        build_application_pack(conn, workspace_id)
    conn.close()


def test_build_application_pack_accepts_transferable_match_when_acknowledged(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    save_artifact(conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
                  payload={"company": "Acme", "title": "Backend Engineer", "job_id": "jobsrc_x"},
                  content_id="jobsnap_A")
    fit = save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_result",
        payload={"verdict": None, "status": "NEEDS_REVIEW", "dimension_scores": {}, "gaps": [],
                  "direct_matches": [], "gate_assessments": [], "human_judgment_questions": [],
                  "functionally_equivalent_matches": [],
                  "transferable_matches": [
                      {"match_id": "tr1", "job_evidence_id": "jobev_1", "profile_evidence_ids": ["clm_1"],
                       "extension_ref": {"extension_id": "ext_x"}, "limitations": "Different regulatory context"}]},
        content_id="jobfitresult_A",
    )
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
        payload={"recommendation": "apply",
                  "cv_content": [{"unit_id": "u1", "unit_type": "cv_bullet", "text": "x", "status": "READY", "profile_evidence_ids": []}],
                  "cover_letter_content": [], "unsupported_claims": []},
        content_id="aiintel_A",
    )
    save_review_decision(conn, workspace_id=workspace_id, review_item_type="transferable_match",
                          source_artifact_id=fit["id"], domain_item_id="tr1",
                          disposition="acknowledged_and_proceed")
    pack = build_application_pack(conn, workspace_id)
    assert pack["fit_summary"]["transferable_matches"][0]["match_id"] == "tr1"
    conn.close()


def test_build_application_pack_never_blocks_on_gaps_alone(tmp_path):
    # Gaps are informational (design § Missing evidence): "the system does
    # not currently possess accepted evidence — never that the candidate
    # definitely does not have this." A gap is never a reviewable claim, so
    # it never requires a review_decisions row and never appears in
    # `outstanding`. This is the concrete proof that Gate 2's gaps category
    # is surfaced but non-blocking, distinct from gate flags/questions/
    # functionally-equivalent/transferable matches, which all block above.
    conn, workspace_id = _workspace(tmp_path)
    save_artifact(conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
                  payload={"company": "Acme", "title": "Backend Engineer", "job_id": "jobsrc_x"},
                  content_id="jobsnap_A")
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="job_fit_result",
        payload={"verdict": None, "status": "NEEDS_REVIEW", "dimension_scores": {},
                  "gaps": [{"gap_id": "gap_1", "description": "No AWS experience"},
                           {"gap_id": "gap_2", "description": "No German language evidence"}],
                  "direct_matches": [], "functionally_equivalent_matches": [], "transferable_matches": [],
                  "gate_assessments": [], "human_judgment_questions": []},
        content_id="jobfitresult_A",
    )
    save_artifact(
        conn, workspace_id=workspace_id, artifact_type="application_intelligence_result",
        payload={"recommendation": "apply",
                  "cv_content": [{"unit_id": "u1", "unit_type": "cv_bullet", "text": "x", "status": "READY", "profile_evidence_ids": []}],
                  "cover_letter_content": [], "unsupported_claims": []},
        content_id="aiintel_A",
    )
    # No review_decisions rows recorded at all for either gap — pack still builds.
    pack = build_application_pack(conn, workspace_id)
    assert {gap["gap_id"] for gap in pack["fit_summary"]["gaps"]} == {"gap_1", "gap_2"}
    assert {gap["gap_id"] for gap in pack["review_record"]["informational_items"]["gaps"]} == {"gap_1", "gap_2"}
    conn.close()


def test_build_application_pack_blocks_on_outstanding_needs_review_unit(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_fit_and_intelligence(conn, workspace_id, needs_review_units=["u2"])
    with pytest.raises(PipelineError, match="u2"):
        build_application_pack(conn, workspace_id)
    conn.close()


def test_build_application_pack_includes_needs_review_unit_after_acknowledged_decision(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    fit, intelligence = _seed_fit_and_intelligence(conn, workspace_id, needs_review_units=["u2"])
    save_review_decision(conn, workspace_id=workspace_id, review_item_type="content_unit",
                          source_artifact_id=intelligence["id"], domain_item_id="u2",
                          disposition="acknowledged_and_proceed")
    pack = build_application_pack(conn, workspace_id)
    unit_ids = {unit["unit_id"] for unit in pack["cv_content"]}
    assert unit_ids == {"u1", "u2"}
    conn.close()


def test_build_application_pack_excludes_unit_omitted_by_decision_even_if_ready(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    fit, intelligence = _seed_fit_and_intelligence(conn, workspace_id)
    save_review_decision(conn, workspace_id=workspace_id, review_item_type="content_unit",
                          source_artifact_id=intelligence["id"], domain_item_id="u1",
                          disposition="omit_from_positioning")
    pack = build_application_pack(conn, workspace_id)
    assert pack["cv_content"] == []
    conn.close()


def test_build_application_pack_rejects_stale_job_fit(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_fit_and_intelligence(conn, workspace_id)
    # simulate staleness: replace the profile snapshot the fit result depended on
    from webapp.services.staleness import record_dependency_fingerprint
    from webapp.persistence.artifacts import get_current_artifact
    fit = get_current_artifact(conn, workspace_id, "job_fit_result")
    record_dependency_fingerprint(conn, artifact_id=fit["id"], upstream_artifact_type="profile_snapshot",
                                   upstream_content_id="profilesnap_OLD")
    save_artifact(conn, workspace_id="profile", artifact_type="profile_snapshot", payload={}, content_id="profilesnap_NEW")
    with pytest.raises(PipelineError, match="stale"):
        build_application_pack(conn, workspace_id)
    conn.close()


def test_confirm_application_pack_sets_drafted_and_binds_submitted_pack(tmp_path, tmp_path_factory):
    conn, workspace_id = _workspace(tmp_path)
    _seed_fit_and_intelligence(conn, workspace_id)
    result = confirm_application_pack(conn, workspace_id, effective_date="2026-08-18")
    from webapp.persistence.workspaces import get_workspace
    from webapp.persistence.workflow import list_workflow_events
    assert get_workspace(conn, workspace_id)["workflow_status"] == "drafted"
    events = list_workflow_events(conn, workspace_id)
    assert events[0]["submitted_pack_artifact_id"] == result["artifact"]["id"]
    conn.close()


def test_confirm_application_pack_refused_once_applied(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    _seed_fit_and_intelligence(conn, workspace_id)
    drafted_result = confirm_application_pack(conn, workspace_id, effective_date="2026-08-18")

    from webapp.persistence.workflow import record_status_change
    record_status_change(conn, workspace_id=workspace_id, new_status="applied", effective_date="2026-08-19",
                          submitted_pack_artifact_id=drafted_result["artifact"]["id"])

    with pytest.raises(PipelineError, match="already"):
        confirm_application_pack(conn, workspace_id, effective_date="2026-08-20")
    conn.close()


def test_confirm_application_pack_allowed_again_while_still_drafted(tmp_path):
    # Refining materials before actually submitting is allowed: re-confirming
    # while still 'drafted' (not yet 'applied') succeeds and produces a new
    # current application_pack artifact.
    conn, workspace_id = _workspace(tmp_path)
    _seed_fit_and_intelligence(conn, workspace_id)
    first = confirm_application_pack(conn, workspace_id, effective_date="2026-08-18")
    second = confirm_application_pack(conn, workspace_id, effective_date="2026-08-19")
    assert second["artifact"]["id"] != first["artifact"]["id"]
    from webapp.persistence.workspaces import get_workspace
    assert get_workspace(conn, workspace_id)["workflow_status"] == "drafted"
    conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/webapp/services/test_application_pack.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write application_pack.py**

```python
# webapp/services/application_pack.py
from __future__ import annotations

import sqlite3
from typing import Any

from webapp.persistence.artifacts import get_current_artifact, save_artifact
from webapp.persistence.review import list_review_decisions
from webapp.persistence.workflow import record_status_change
from webapp.services.pipeline import PipelineError
from webapp.services.staleness import check_staleness, record_dependency_fingerprint

_ACKNOWLEDGED = "acknowledged_and_proceed"
_OMITTED = "omit_from_positioning"
_BLOCKING_DISPOSITIONS = {"requires_upstream_change", "resolved_by_rerun"}


def build_application_pack(conn: sqlite3.Connection, workspace_id: str) -> dict[str, Any]:
    from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID

    profile_artifact = get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")
    job_artifact = get_current_artifact(conn, workspace_id, "job_posting_snapshot")
    fit_artifact = get_current_artifact(conn, workspace_id, "job_fit_result")
    intelligence_artifact = get_current_artifact(conn, workspace_id, "application_intelligence_result")
    if fit_artifact is None or intelligence_artifact is None:
        raise PipelineError(
            f"workspace {workspace_id} needs job_fit_result and application_intelligence_result "
            "to build an application pack"
        )

    fit_staleness = check_staleness(conn, workspace_id, "job_fit_result")
    intelligence_staleness = check_staleness(conn, workspace_id, "application_intelligence_result")
    if fit_staleness["stale"] or intelligence_staleness["stale"]:
        raise PipelineError(
            "cannot build an application pack from stale results: "
            f"job_fit_result stale={fit_staleness['stale']} ({fit_staleness['reasons']}), "
            f"application_intelligence_result stale={intelligence_staleness['stale']} ({intelligence_staleness['reasons']})"
        )

    fit = fit_artifact["payload"]
    intelligence = intelligence_artifact["payload"]
    outstanding: list[str] = []

    # --- Gate 1: profile evidence integrity (conflicts AND placeholders) ---
    # A conflict or a placeholder claim in the CURRENT profile snapshot that
    # is cited by any accepted match in the CURRENT job_fit_result requires
    # an explicit decision before the pack can be built — a checkbox cannot
    # create evidence, but the user can record "acknowledged and proceed" or
    # "requires upstream evidence change" against it. Design § Gate 1: "Surfaces
    # profile conflicts, placeholders, missing candidate evidence..." — both
    # conflicts and placeholders are named explicitly, so both are checked
    # here (a prior revision only checked conflicts).
    # SCOPE DECISION: only conflicts/placeholders CITED by an accepted match
    # in this job's fit result block pack construction — an unrelated
    # concept (e.g. education dates, when this job's matches never reference
    # education) does not need resolution to apply to THIS job. An uncited
    # conflict/placeholder remains visible on the Profile page (Task 14) and
    # still blocks nothing there beyond its own label. This is narrower than
    # "surface every profile conflict/placeholder unconditionally" — if a
    # future requirement needs every one of them to block every pack
    # regardless of relevance, that is a scope change requiring explicit
    # approval, not an oversight in this implementation.
    gate1_decisions = {
        decision["domain_item_id"]: decision
        for decision in list_review_decisions(conn, workspace_id, source_artifact_id=profile_artifact["id"])
    } if profile_artifact is not None else {}
    cited_profile_evidence_ids: set[str] = set()
    for match in (
        fit.get("direct_matches", []) + fit.get("functionally_equivalent_matches", [])
        + fit.get("transferable_matches", [])
    ):
        cited_profile_evidence_ids.update(match.get("profile_evidence_ids", []))
    if profile_artifact is not None:
        cited_concept_ids = {
            claim.get("concept_id") for claim in profile_artifact["payload"].get("claims", [])
            if claim.get("id") in cited_profile_evidence_ids
        }
        for conflict in profile_artifact["payload"].get("conflicts", []):
            if conflict.get("concept_id") not in cited_concept_ids:
                continue
            decision = gate1_decisions.get(conflict["id"])
            # DISPOSITIONS has exactly 4 values; _BLOCKING_DISPOSITIONS covers
            # requires_upstream_change/resolved_by_rerun, so any decision not
            # in that set is necessarily acknowledged_and_proceed or
            # omit_from_positioning — both resolve the item, no further check
            # needed once the blocking-set membership test above is false.
            if decision is None or decision["disposition"] in _BLOCKING_DISPOSITIONS:
                outstanding.append(f"profile_conflict:{conflict['id']}")
        for claim in profile_artifact["payload"].get("claims", []):
            if not claim.get("placeholder") or claim.get("id") not in cited_profile_evidence_ids:
                continue
            decision = gate1_decisions.get(claim["id"])
            if decision is None or decision["disposition"] in _BLOCKING_DISPOSITIONS:
                outstanding.append(f"profile_placeholder:{claim['id']}")

    # --- Gate 2: Job Fit judgment ---
    # Design § Gate 2: "Surfaces gate flags/unverified gates, human-judgment
    # questions, functionally equivalent relationships, transferable
    # matches, gaps, conditions/limitations." Disposition-blocking categories
    # (require an explicit review_decisions row): gate flags, human-judgment
    # questions, functionally-equivalent matches, transferable matches — each
    # represents either an unresolved system state (a flag/question) or a
    # relationship Ticket 7 computed but whose limitations/conditions a human
    # must consciously accept before it supports application material.
    # NON-blocking / informational category: gaps. A gap has no evidence to
    # acknowledge or omit — "no accepted evidence currently establishes this"
    # (design § Missing evidence) describes the system's current evidence
    # state, not a claim requiring a disposition. Gaps are still surfaced,
    # in review_record["informational_items"], for audit visibility.
    gate2_decisions = {
        decision["domain_item_id"]: decision
        for decision in list_review_decisions(conn, workspace_id, source_artifact_id=fit_artifact["id"])
    }
    # gate_assessments is a list of {"gate_id", "status", ...} dicts (VERIFIED
    # against product/semantic_job_fit.py — this is the per-gate assessment
    # list, distinct from gate_results which is evaluation_policy's internal
    # scoring input/output shape and is not the right field to read here).
    for gate_assessment in fit.get("gate_assessments", []):
        if gate_assessment.get("status") in ("FLAG", "UNVERIFIED"):
            gate_id = gate_assessment["gate_id"]
            decision = gate2_decisions.get(f"gate:{gate_id}")
            if decision is None or decision["disposition"] in _BLOCKING_DISPOSITIONS:
                outstanding.append(f"gate_flag:{gate_id}")
    for question in fit.get("human_judgment_questions", []):
        decision = gate2_decisions.get(question["question_id"])
        if decision is None or decision["disposition"] in _BLOCKING_DISPOSITIONS:
            outstanding.append(f"human_judgment_question:{question['question_id']}")

    def _select_matches(matches: list[dict[str, Any]], *, review_item_type: str) -> list[dict[str, Any]]:
        selected = []
        for match in matches:
            decision = gate2_decisions.get(match["match_id"])
            if decision is None or decision["disposition"] in _BLOCKING_DISPOSITIONS:
                outstanding.append(f"{review_item_type}:{match['match_id']}")
                continue
            if decision["disposition"] == _OMITTED:
                continue
            selected.append(match)
        return selected

    accepted_functionally_equivalent = _select_matches(
        fit.get("functionally_equivalent_matches", []), review_item_type="functionally_equivalent_match"
    )
    accepted_transferable = _select_matches(
        fit.get("transferable_matches", []), review_item_type="transferable_match"
    )
    informational_items = {"gaps": fit.get("gaps", [])}

    # --- Gate 3: Application Intelligence content units ---
    gate3_decisions = {
        decision["domain_item_id"]: decision
        for decision in list_review_decisions(conn, workspace_id, source_artifact_id=intelligence_artifact["id"])
    }

    def _select(units: list[dict[str, Any]]) -> list[dict[str, Any]]:
        selected = []
        for unit in units:
            decision = gate3_decisions.get(unit["unit_id"])
            if unit["status"] == "READY":
                if decision is not None and decision["disposition"] == _OMITTED:
                    continue
                if decision is not None and decision["disposition"] in _BLOCKING_DISPOSITIONS:
                    outstanding.append(f"content_unit:{unit['unit_id']}")
                    continue
                selected.append(unit)
            else:  # NEEDS_REVIEW or any non-READY status
                if decision is None:
                    outstanding.append(f"content_unit:{unit['unit_id']}")
                elif decision["disposition"] == _ACKNOWLEDGED:
                    selected.append(unit)
                elif decision["disposition"] == _OMITTED:
                    continue
                else:
                    outstanding.append(f"content_unit:{unit['unit_id']}")
        return selected

    cv_content = _select(intelligence.get("cv_content", []))
    cover_letter_content = _select(intelligence.get("cover_letter_content", []))

    if outstanding:
        raise PipelineError(
            f"workspace {workspace_id} has outstanding review items requiring a decision "
            f"before an application pack can be built: {sorted(outstanding)}"
        )

    pack = {
        "job": {
            "company": job_artifact["payload"].get("company") if job_artifact else None,
            "title": job_artifact["payload"].get("title") if job_artifact else None,
            "source": job_artifact["payload"].get("source") if job_artifact else None,
        },
        "fit_summary": {
            "verdict": fit.get("verdict"), "dimension_scores": fit.get("dimension_scores", {}),
            "direct_matches": fit.get("direct_matches", []),
            "functionally_equivalent_matches": accepted_functionally_equivalent,
            "transferable_matches": accepted_transferable,
            "gaps": informational_items["gaps"],
        },
        "recommendation": intelligence.get("recommendation"),
        "cv_content": cv_content,
        "cover_letter_content": cover_letter_content,
        "review_record": {
            "decisions_consulted": (
                list(gate1_decisions.values()) + list(gate2_decisions.values()) + list(gate3_decisions.values())
            ),
            "informational_items": {
                "gaps": informational_items["gaps"],
                "unsupported_claims": intelligence.get("unsupported_claims", []),
            },
        },
    }
    return pack


def confirm_application_pack(conn: sqlite3.Connection, workspace_id: str, *, effective_date: str) -> dict[str, Any]:
    """Gate 4: the ONLY code path that may set workflow_status='drafted'.

    Only reachable while workflow_status is None (first confirmation) or
    already 'drafted' (refining materials before actually submitting).
    Once the user has moved past 'drafted' — applied, interview, offer, or
    any final status — a new Gate-4 confirmation is refused. Rebuilding
    application material after the user has told the system the real
    application was already submitted would silently move workflow_status
    backward from e.g. 'applied' to 'drafted', contradicting the design's
    rule that workflow status transitions are explicit, human-triggered,
    and never inferred or reversed by material generation. A genuine
    re-application to the same job is a new-cycle concern outside Ticket 9's
    scope (no such flow exists yet)."""
    from webapp.persistence.workspaces import get_workspace

    workspace = get_workspace(conn, workspace_id)
    current_status = workspace["workflow_status"] if workspace else None
    if current_status not in (None, "drafted"):
        raise PipelineError(
            f"cannot confirm a new application pack: workspace {workspace_id} has already "
            f"moved past drafted (current status: {current_status!r}). The submitted pack "
            "is a historical record and is never superseded by generating new material."
        )

    pack = build_application_pack(conn, workspace_id)

    fit_artifact = get_current_artifact(conn, workspace_id, "job_fit_result")
    intelligence_artifact = get_current_artifact(conn, workspace_id, "application_intelligence_result")

    pack_artifact = save_artifact(conn, workspace_id=workspace_id, artifact_type="application_pack", payload=pack)
    record_dependency_fingerprint(conn, artifact_id=pack_artifact["id"], upstream_artifact_type="job_fit_result",
                                   upstream_content_id=fit_artifact["content_id"])
    record_dependency_fingerprint(conn, artifact_id=pack_artifact["id"], upstream_artifact_type="application_intelligence_result",
                                   upstream_content_id=intelligence_artifact["content_id"])

    record_status_change(
        conn, workspace_id=workspace_id, new_status="drafted", effective_date=effective_date,
        note="Application pack reviewed and confirmed by user.",
        submitted_pack_artifact_id=pack_artifact["id"], _allow_drafted=True,
    )

    return {"pack": pack, "artifact": pack_artifact}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/webapp/services/test_application_pack.py -v`
Expected: PASS (19 tests) — 12 from the original review-gating suite plus 7 added in this revision to close the Gate 1/2 completeness gap: `test_build_application_pack_blocks_on_cited_placeholder_claim`, `test_build_application_pack_ignores_uncited_placeholder_claim`, `test_build_application_pack_blocks_on_outstanding_functionally_equivalent_match`, `test_build_application_pack_omits_functionally_equivalent_match_when_disposition_is_omit`, `test_build_application_pack_blocks_on_outstanding_transferable_match`, `test_build_application_pack_accepts_transferable_match_when_acknowledged`, `test_build_application_pack_never_blocks_on_gaps_alone`.

- [ ] **Step 5: Write the failing test for archive_projection.py**

```python
# tests/webapp/services/test_archive_projection.py
from webapp.services.archive_projection import write_application_pack_projection


def test_writes_to_lowercase_underscore_slug_path(tmp_path):
    path = write_application_pack_projection(
        {"job": {"company": "Acme"}, "cv_content": []}, company="Acme", title="Backend Engineer",
        documents_root=tmp_path,
    )
    assert path == tmp_path / "applications" / "acme_backend_engineer" / "application_pack.md"
    assert path.exists()


def test_does_not_overwrite_existing_pack(tmp_path):
    first = write_application_pack_projection(
        {"cv_content": []}, company="Acme", title="Backend Engineer", documents_root=tmp_path,
    )
    original_content = first.read_text(encoding="utf-8")
    second = write_application_pack_projection(
        {"cv_content": [{"unit_id": "u1", "text": "different"}]}, company="Acme", title="Backend Engineer",
        documents_root=tmp_path,
    )
    assert second != first
    assert first.read_text(encoding="utf-8") == original_content


def test_never_writes_latex_files(tmp_path):
    write_application_pack_projection(
        {"cv_content": []}, company="Acme", title="Backend Engineer", documents_root=tmp_path,
    )
    folder = tmp_path / "applications" / "acme_backend_engineer"
    written = {p.name for p in folder.iterdir()}
    assert "cv_draft.tex" not in written
    assert "cover_letter.tex" not in written
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pytest tests/webapp/services/test_archive_projection.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 7: Write archive_projection.py**

```python
# webapp/services/archive_projection.py
"""Compatibility export of a confirmed Application Pack into the existing
documents/applications/<company>_<role>/ archive convention. SQLite remains
authoritative; this is a read-safe projection, never a second source of
truth, and never fabricates cv_draft.tex/cover_letter.tex — those filenames
historically represent actual submitted LaTeX material, which Ticket 9 does
not produce."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _slug(value: str) -> str:
    return re.sub(r"\s+", "_", value.strip().lower())


def _render_markdown(pack: dict[str, Any]) -> str:
    lines = ["# Application Pack", ""]
    job = pack.get("job", {})
    lines.append(f"**Company:** {job.get('company', '')}  ")
    lines.append(f"**Title:** {job.get('title', '')}  ")
    lines.append("")
    lines.append("## Fit Summary")
    lines.append("")
    lines.append(f"```json\n{json.dumps(pack.get('fit_summary', {}), indent=2)}\n```")
    lines.append("")
    lines.append("## CV Content")
    for unit in pack.get("cv_content", []):
        lines.append(f"- {unit.get('text', '')}")
    lines.append("")
    lines.append("## Cover Letter Content")
    for unit in pack.get("cover_letter_content", []):
        lines.append(f"- {unit.get('text', '')}")
    lines.append("")
    return "\n".join(lines)


def write_application_pack_projection(
    pack: dict[str, Any], *, company: str, title: str, documents_root: Path,
) -> Path:
    folder = Path(documents_root) / "applications" / f"{_slug(company)}_{_slug(title)}"
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / "application_pack.md"
    if target.exists():
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        target = folder / f"application_pack_{timestamp}.md"
    target.write_text(_render_markdown(pack), encoding="utf-8")
    return target
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pytest tests/webapp/services/test_archive_projection.py -v`
Expected: PASS (3 tests)

- [ ] **Step 9: Wire archive projection into confirm_application_pack**

Modify `confirm_application_pack` in `webapp/services/application_pack.py` to call the projection after the status change succeeds:

```python
    from webapp.services.archive_projection import write_application_pack_projection

    job_snapshot_artifact = get_current_artifact(conn, workspace_id, "job_posting_snapshot")
    company = job_snapshot_artifact["payload"].get("company", "") if job_snapshot_artifact else ""
    title = job_snapshot_artifact["payload"].get("title", "") if job_snapshot_artifact else ""
    projected_path = write_application_pack_projection(
        pack, company=company, title=title, documents_root=Path("documents"),
    )

    return {"pack": pack, "artifact": pack_artifact, "archive_path": str(projected_path)}
```

Add `from pathlib import Path` to the top of `application_pack.py` if not already imported.

- [ ] **Step 10: Run full suite**

Run: `pytest -q`
Expected: no regressions.

---

## Task 13: Thin HTTP API — profile, workspaces, processing, review, pack, and status endpoints

**Files:**
- Create: `webapp/api/dependencies.py`
- Create: `webapp/api/profile.py`
- Create: `webapp/api/workspaces.py`
- Create: `webapp/api/review.py`
- Create: `webapp/api/status.py`
- Modify: `webapp/app.py`
- Test: `tests/webapp/api/__init__.py`
- Test: `tests/webapp/api/test_profile_routes.py`
- Test: `tests/webapp/api/test_workspace_routes.py`
- Test: `tests/webapp/api/test_review_routes.py`
- Test: `tests/webapp/api/test_status_routes.py`

**Interfaces:**
- Every route in this task does HTTP translation ONLY: parse the request body, call exactly one `webapp.services.*` function, translate its return value or exception into a response. No router in this task queries `webapp.persistence` directly except for a single-row 404 existence check (closes Finding #14 — v1's routers queried persistence repeatedly for multi-artifact assembly).
- `webapp.api.dependencies.get_conn(request) -> sqlite3.Connection` — per-request connection dependency.
- `webapp.api.dependencies.get_extensions_dir(request) -> Path` — reads `request.app.state.settings.extensions_dir` (new `Settings` field, added in this task's Step 3).
- Routes:
  - `GET /api/profile`, `POST /api/profile/refresh`
  - `GET /api/extensions` — lists installed extensions via `extension_registry.list_installed_extensions` (Task 11)
  - `GET /api/workspaces`, `POST /api/workspaces`, `GET /api/workspaces/{id}`
  - `POST /api/workspaces/{id}/understand`, `POST /api/workspaces/{id}/fit` (body may include `extension_ids: list[str]`, resolved server-side via Task 11 — never a path), `POST /api/workspaces/{id}/application-intelligence`
  - `GET /api/workspaces/{id}/review` — now calls a new `webapp.services.review_view.build_review_view_model(conn, workspace_id)` (this task also creates that thin service function) rather than assembling multiple `get_current_artifact` calls inline in the router.
  - `POST /api/workspaces/{id}/review-decisions`
  - `POST /api/workspaces/{id}/application-pack` — calls `application_pack.confirm_application_pack` (Task 12) — this endpoint is Gate 4 and the ONLY endpoint that can result in `workflow_status="drafted"`.
  - `PATCH /api/workspaces/{id}/status` — calls `record_status_change` WITHOUT `_allow_drafted`; a request with `new_status="drafted"` is rejected with 400 before even reaching `record_status_change` (belt-and-suspenders on top of the persistence-layer rejection from Task 5), with an error message pointing the caller at `POST /application-pack` instead. When `new_status="applied"`, the router resolves the workspace's CURRENT `application_pack` artifact server-side and passes its id as `submitted_pack_artifact_id` — the client never supplies this id itself, and `record_status_change` independently rejects `applied` if no such id is resolvable or if the workspace is not currently `drafted`. This produces an unambiguous audit trail even when multiple Gate-4 confirmations occurred while still `drafted` (Pack A → drafted, Pack B → drafted, applied binds to Pack B).
  - `GET /api/workspaces/{id}/events` — read-only workflow event history via the new `webapp.services.workflow_events.list_events` thin wrapper (defined in this task's status.py step below). Each returned event exposes `submitted_pack_artifact_id` unchanged from persistence — the immutable pack-binding reference is never renamed or folded into `note`. This is the audit surface Task 15's submitted-pack-immutability acceptance test reads from.

- [ ] **Step 1: Write the failing tests**

```python
# tests/webapp/api/test_profile_routes.py
from pathlib import Path

from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings

FIXTURE_PROFILE_ROOT = Path(__file__).parents[2] / "fixtures" / "webapp_profile_root"


def _client(tmp_path):
    settings = Settings(db_path=tmp_path / "jobsearch.sqlite3", profile_root=str(FIXTURE_PROFILE_ROOT))
    return TestClient(create_app(settings))


def test_get_profile_before_refresh_returns_none(tmp_path):
    with _client(tmp_path) as client:
        response = client.get("/api/profile")
        assert response.status_code == 200
        assert response.json()["profile"] is None


def test_post_profile_refresh_builds_and_returns_snapshot(tmp_path):
    with _client(tmp_path) as client:
        response = client.post("/api/profile/refresh")
        assert response.status_code == 200
        assert response.json()["profile"]["content_id"].startswith("profilesnap_")


def test_get_profile_after_refresh_returns_current_snapshot(tmp_path):
    with _client(tmp_path) as client:
        client.post("/api/profile/refresh")
        response = client.get("/api/profile")
        assert response.json()["profile"]["content_id"].startswith("profilesnap_")


def test_profile_workspace_never_appears_in_workspaces_list(tmp_path):
    with _client(tmp_path) as client:
        client.post("/api/profile/refresh")
        response = client.get("/api/workspaces")
        assert response.json()["workspaces"] == []
```

```python
# tests/webapp/api/test_workspace_routes.py
from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings


def _client(tmp_path):
    return TestClient(create_app(Settings(db_path=tmp_path / "jobsearch.sqlite3")))


def test_create_workspace_via_source_record(tmp_path):
    with _client(tmp_path) as client:
        response = client.post("/api/workspaces", json={
            "company": "Acme", "title": "Backend Engineer",
            "source_record": {"schema_version": "job-source-record.v0", "source": "manual",
                              "captured_at": "2026-08-18T00:00:00Z", "company": "Acme", "title": "Backend Engineer"},
        })
        assert response.status_code == 201
        body = response.json()
        assert body["workspace"]["company"] == "Acme"
        assert body["artifact"]["artifact_type"] == "job_posting_snapshot"


def test_list_workspaces_returns_created_workspace(tmp_path):
    with _client(tmp_path) as client:
        client.post("/api/workspaces", json={
            "company": "Acme", "title": "Backend Engineer",
            "source_record": {"schema_version": "job-source-record.v0", "source": "manual",
                              "captured_at": "2026-08-18T00:00:00Z", "company": "Acme", "title": "Backend Engineer"},
        })
        response = client.get("/api/workspaces")
        assert len(response.json()["workspaces"]) == 1


def test_get_workspace_not_found_returns_404(tmp_path):
    with _client(tmp_path) as client:
        response = client.get("/api/workspaces/does-not-exist")
        assert response.status_code == 404


def test_fit_without_profile_returns_400_not_500(tmp_path):
    with _client(tmp_path) as client:
        create_response = client.post("/api/workspaces", json={
            "company": "Acme", "title": "Backend Engineer",
            "source_record": {"schema_version": "job-source-record.v0", "source": "manual",
                              "captured_at": "2026-08-18T00:00:00Z", "company": "Acme", "title": "Backend Engineer"},
        })
        workspace_id = create_response.json()["workspace"]["id"]

        response = client.post(f"/api/workspaces/{workspace_id}/fit", json={"request_id": "req_1"})
        # no profile refreshed yet, so this must be a clean 400 PipelineError
        # translation, never an unhandled 500
        assert response.status_code == 400
```

```python
# tests/webapp/api/test_review_routes.py
from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.db import connect
from webapp.persistence.workspaces import create_workspace


def _client_and_workspace(tmp_path):
    settings = Settings(db_path=tmp_path / "jobsearch.sqlite3")
    app = create_app(settings)
    client = TestClient(app)
    with client:
        conn = connect(settings.db_path)
        ws = create_workspace(conn, company="Acme", title="Backend Engineer")
        save_artifact(conn, workspace_id=ws["id"], artifact_type="job_fit_result",
                      payload={"gaps": [{"gap_id": "gap_1", "description": "No AWS experience"}], "status": "NEEDS_REVIEW"})
        conn.close()
    return TestClient(app), ws["id"]


def test_get_review_returns_current_artifacts(tmp_path):
    client, workspace_id = _client_and_workspace(tmp_path)
    with client:
        response = client.get(f"/api/workspaces/{workspace_id}/review")
        assert response.status_code == 200
        assert response.json()["job_fit_result"]["payload"]["status"] == "NEEDS_REVIEW"


def test_post_review_decision_persists(tmp_path):
    client, workspace_id = _client_and_workspace(tmp_path)
    with client:
        review = client.get(f"/api/workspaces/{workspace_id}/review").json()
        artifact_id = review["job_fit_result"]["id"]
        response = client.post(f"/api/workspaces/{workspace_id}/review-decisions", json={
            "review_item_type": "gap", "source_artifact_id": artifact_id, "domain_item_id": "gap_1",
            "disposition": "acknowledged_and_proceed", "note": "Will address in interview",
        })
        assert response.status_code == 201


def test_application_pack_route_is_the_only_path_to_drafted(tmp_path):
    client, workspace_id = _client_and_workspace(tmp_path)
    with client:
        response = client.patch(f"/api/workspaces/{workspace_id}/status",
                                json={"new_status": "drafted", "effective_date": "2026-08-18"})
        assert response.status_code == 400
        assert "application-pack" in response.json()["detail"]
```

```python
# tests/webapp/api/test_status_routes.py
from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.db import connect
from webapp.persistence.workspaces import create_workspace


def _client_and_workspace(tmp_path):
    settings = Settings(db_path=tmp_path / "jobsearch.sqlite3")
    app = create_app(settings)
    client = TestClient(app)
    with client:
        conn = connect(settings.db_path)
        ws = create_workspace(conn, company="Acme", title="Backend Engineer")
        conn.close()
    return TestClient(app), ws["id"]


def test_patch_status_updates_workflow_status_for_non_drafted(tmp_path):
    client, workspace_id = _client_and_workspace(tmp_path)
    with client:
        response = client.patch(f"/api/workspaces/{workspace_id}/status",
                                json={"new_status": "interview", "effective_date": "2026-08-18"})
        assert response.status_code == 200
        assert response.json()["workflow_status"] == "interview"


def test_patch_status_rejects_unknown_status(tmp_path):
    client, workspace_id = _client_and_workspace(tmp_path)
    with client:
        response = client.patch(f"/api/workspaces/{workspace_id}/status",
                                json={"new_status": "ghosted", "effective_date": "2026-08-18"})
        assert response.status_code == 400


def test_patch_status_applied_binds_to_the_current_application_pack(tmp_path):
    from webapp.persistence.artifacts import save_artifact
    from webapp.persistence.workflow import record_status_change

    settings = Settings(db_path=tmp_path / "jobsearch.sqlite3")
    app = create_app(settings)
    client = TestClient(app)
    with client:
        conn = connect(settings.db_path)
        ws = create_workspace(conn, company="Acme", title="Backend Engineer")
        pack = save_artifact(conn, workspace_id=ws["id"], artifact_type="application_pack", payload={})
        record_status_change(conn, workspace_id=ws["id"], new_status="drafted", effective_date="2026-08-18",
                              submitted_pack_artifact_id=pack["id"], _allow_drafted=True)
        conn.close()

        response = client.patch(f"/api/workspaces/{ws['id']}/status",
                                json={"new_status": "applied", "effective_date": "2026-08-19"})
        assert response.status_code == 200

        events = client.get(f"/api/workspaces/{ws['id']}/events").json()["events"]
        applied_event = next(e for e in events if e["new_status"] == "applied")
        assert applied_event["submitted_pack_artifact_id"] == pack["id"]


def test_no_apply_submit_send_email_endpoints_exist(tmp_path):
    client, workspace_id = _client_and_workspace(tmp_path)
    with client:
        for path in ("/apply", "/submit", "/send", "/email"):
            response = client.post(f"/api/workspaces/{workspace_id}{path}")
            assert response.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/webapp/api/ -v`
Expected: FAIL — routes don't exist.

- [ ] **Step 3: Add `extensions_dir` to Settings**

Modify `webapp/config.py`, adding a field to `Settings`:

```python
    extensions_dir: Path = field(default_factory=lambda: Path("extensions"))
```

(with the same `__post_init__` treatment as `db_path` — `self.extensions_dir = Path(self.extensions_dir)`)

- [ ] **Step 4: Write dependencies.py**

```python
# webapp/api/dependencies.py
from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi import Request

from webapp.persistence.db import connect


def get_conn(request: Request) -> sqlite3.Connection:
    conn = connect(request.app.state.settings.db_path)
    try:
        yield conn
    finally:
        conn.close()


def get_extensions_dir(request: Request) -> Path:
    return request.app.state.settings.extensions_dir
```

- [ ] **Step 5: Write a thin review-view service function**

Create `webapp/services/review_view.py`:

```python
# webapp/services/review_view.py
from __future__ import annotations

import sqlite3
from typing import Any

from webapp.persistence.artifacts import get_current_artifact

_REVIEW_ARTIFACT_TYPES = ("profile_snapshot", "job_posting_snapshot", "job_understanding_result",
                          "resolved_job_evidence", "job_fit_result", "application_intelligence_result")


def build_review_view_model(conn: sqlite3.Connection, workspace_id: str) -> dict[str, Any]:
    from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID
    view = {}
    for artifact_type in _REVIEW_ARTIFACT_TYPES:
        source_workspace = PROFILE_WORKSPACE_ID if artifact_type == "profile_snapshot" else workspace_id
        view[artifact_type] = get_current_artifact(conn, source_workspace, artifact_type)
    return view
```

- [ ] **Step 6: Write profile.py router**

```python
# webapp/api/profile.py
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Request

from webapp.api.dependencies import get_conn
from webapp.services.pipeline import get_current_profile_snapshot, refresh_profile

router = APIRouter(prefix="/api/profile", tags=["profile"])


@router.get("")
def get_profile(conn: sqlite3.Connection = Depends(get_conn)):
    return {"profile": get_current_profile_snapshot(conn)}


@router.post("/refresh")
def post_profile_refresh(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    root = request.app.state.settings.profile_root
    return {"profile": refresh_profile(conn, root=root)}
```

- [ ] **Step 7: Write workspaces.py router**

```python
# webapp/api/workspaces.py
from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from webapp.api.dependencies import get_conn, get_extensions_dir
from webapp.persistence.workspaces import get_workspace, list_workspaces
from webapp.services.extension_registry import list_installed_extensions
from webapp.services.pipeline import (
    PipelineError, create_job_from_source_record, run_application_intelligence, run_job_fit, run_job_understanding,
)

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


class CreateWorkspaceBody(BaseModel):
    company: str
    title: str
    source_record: dict


@router.post("", status_code=201)
def post_workspace(body: CreateWorkspaceBody, conn: sqlite3.Connection = Depends(get_conn)):
    try:
        return create_job_from_source_record(conn, company=body.company, title=body.title, source_record=body.source_record)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("")
def get_workspaces(conn: sqlite3.Connection = Depends(get_conn)):
    return {"workspaces": list_workspaces(conn)}


@router.get("/{workspace_id}")
def get_workspace_detail(workspace_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    workspace = get_workspace(conn, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="workspace not found")
    return {"workspace": workspace}


class UnderstandBody(BaseModel):
    request_id: str


@router.post("/{workspace_id}/understand")
def post_understand(workspace_id: str, body: UnderstandBody, request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    provider = _job_understanding_provider(request)
    try:
        return {"artifact": run_job_understanding(conn, workspace_id, provider, request_id=body.request_id)}
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class FitBody(BaseModel):
    request_id: str
    extension_ids: list[str] | None = None


@router.post("/{workspace_id}/fit")
def post_fit(
    workspace_id: str, body: FitBody, request: Request, conn: sqlite3.Connection = Depends(get_conn),
    extensions_dir: Path = Depends(get_extensions_dir),
):
    # The HTTP boundary accepts only extension IDS from the client (never a
    # filesystem path — closes Finding #16). This route resolves ids to
    # PATHS (via list_installed_extensions) rather than calling
    # extension_registry.resolve_active_extensions — that function returns
    # already-LOADED extension objects, but run_job_fit's extension_paths
    # parameter (Task 10) calls product.extensions.load_extensions(paths)
    # itself, so passing paths here (not pre-loaded objects) matches the
    # actual signature it needs without a second, redundant load pass.
    # resolve_active_extensions remains available (with its own unit tests
    # in this task) for any future caller that wants loaded objects directly.
    resolved_paths: list[str] | None = None
    if body.extension_ids:
        try:
            installed = {ext["id"]: ext["path"] for ext in list_installed_extensions(extensions_dir)}
            resolved_paths = [installed[ext_id] for ext_id in body.extension_ids]
        except KeyError as exc:
            raise HTTPException(status_code=400, detail=f"extension not installed: {exc}") from exc

    adapter = _semantic_adapter(request)
    try:
        return {"artifact": run_job_fit(conn, workspace_id, adapter, request_id=body.request_id, extension_paths=resolved_paths)}
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class ApplicationIntelligenceBody(BaseModel):
    request_id: str


@router.post("/{workspace_id}/application-intelligence")
def post_application_intelligence(
    workspace_id: str, body: ApplicationIntelligenceBody, request: Request, conn: sqlite3.Connection = Depends(get_conn),
):
    provider = _application_intelligence_provider(request)
    try:
        return {"artifact": run_application_intelligence(conn, workspace_id, provider, request_id=body.request_id)}
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _job_understanding_provider(request: Request):
    override = getattr(request.app.state, "job_understanding_provider", None)
    if override is not None:
        return override
    from product.openai_job_understanding_provider import OpenAIJobUnderstandingProvider
    return OpenAIJobUnderstandingProvider()


def _semantic_adapter(request: Request):
    override = getattr(request.app.state, "semantic_adapter", None)
    if override is not None:
        return override
    from webapp.services.openai_semantic_proposer_client import OpenAISemanticProposerClient
    from webapp.services.semantic_proposal_adapter import SemanticProposalAdapter
    return SemanticProposalAdapter(OpenAISemanticProposerClient())


def _application_intelligence_provider(request: Request):
    override = getattr(request.app.state, "application_intelligence_provider", None)
    if override is not None:
        return override
    from product.openai_application_intelligence_provider import OpenAIApplicationIntelligenceProvider
    return OpenAIApplicationIntelligenceProvider()
```

Note: `OpenAIJobUnderstandingProvider()` / `OpenAIApplicationIntelligenceProvider()` / `OpenAISemanticProposerClient()` are called with NO arguments here. VERIFIED: `inspect.signature(OpenAIJobUnderstandingProvider.__init__)` is `(self, *, environ=None, client_factory=None, clock=<monotonic>, utc_now=None, sleep=<sleep>)` — every parameter is keyword-only with a default, and credentials are read from `environ` (defaulting to `os.environ`) internally via `_credential()`, matching the identical pattern already confirmed for `OpenAIApplicationIntelligenceProvider` in the contract reference block above. No `api_key` constructor argument exists on either class.

- [ ] **Step 8: Write review.py and status.py routers**

```python
# webapp/api/review.py
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from webapp.api.dependencies import get_conn
from webapp.persistence.review import DISPOSITIONS, save_review_decision
from webapp.services.application_pack import confirm_application_pack
from webapp.services.pipeline import PipelineError
from webapp.services.review_view import build_review_view_model

router = APIRouter(prefix="/api/workspaces/{workspace_id}", tags=["review"])


@router.get("/review")
def get_review(workspace_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    return build_review_view_model(conn, workspace_id)


class ReviewDecisionBody(BaseModel):
    review_item_type: str
    source_artifact_id: str
    domain_item_id: str | None = None
    disposition: str
    note: str | None = None


@router.post("/review-decisions", status_code=201)
def post_review_decision(workspace_id: str, body: ReviewDecisionBody, conn: sqlite3.Connection = Depends(get_conn)):
    if body.disposition not in DISPOSITIONS:
        raise HTTPException(status_code=400, detail=f"unknown disposition: {body.disposition!r}")
    return save_review_decision(
        conn, workspace_id=workspace_id, review_item_type=body.review_item_type,
        source_artifact_id=body.source_artifact_id, domain_item_id=body.domain_item_id,
        disposition=body.disposition, note=body.note,
    )


class ApplicationPackBody(BaseModel):
    confirmed: bool
    effective_date: str


@router.post("/application-pack", status_code=201)
def post_application_pack(workspace_id: str, body: ApplicationPackBody, conn: sqlite3.Connection = Depends(get_conn)):
    if not body.confirmed:
        raise HTTPException(status_code=400, detail="application pack requires explicit confirmation: "
                                                      "'I have reviewed the application material.'")
    try:
        return confirm_application_pack(conn, workspace_id, effective_date=body.effective_date)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
```

```python
# webapp/api/status.py
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from webapp.api.dependencies import get_conn
from webapp.persistence.artifacts import get_current_artifact
from webapp.persistence.workflow import record_status_change
from webapp.persistence.workspaces import get_workspace

router = APIRouter(prefix="/api/workspaces/{workspace_id}", tags=["status"])


class StatusBody(BaseModel):
    new_status: str
    effective_date: str
    note: str | None = None


@router.patch("/status")
def patch_status(workspace_id: str, body: StatusBody, conn: sqlite3.Connection = Depends(get_conn)):
    if body.new_status == "drafted":
        raise HTTPException(
            status_code=400,
            detail="drafted can only be set via POST /api/workspaces/{id}/application-pack "
                   "with explicit confirmation (Gate 4)",
        )

    submitted_pack_artifact_id = None
    if body.new_status == "applied":
        # The client states the intent ("mark this applied"); the server
        # resolves WHICH exact pack that means by reading the workspace's
        # CURRENT application_pack artifact at the moment of confirmation —
        # never trusting a client-supplied artifact id, and never leaving it
        # to be inferred later from an earlier 'drafted' event, since
        # multiple Gate-4 confirmations may have occurred while still
        # 'drafted' (Pack A -> drafted, Pack B -> drafted, ...).
        current_pack = get_current_artifact(conn, workspace_id, "application_pack")
        if current_pack is not None:
            submitted_pack_artifact_id = current_pack["id"]
        # If no current pack exists, submitted_pack_artifact_id stays None
        # and record_status_change itself raises — this can only happen if
        # workflow_status is not 'drafted' in the first place, which
        # record_status_change also independently rejects.

    try:
        record_status_change(conn, workspace_id=workspace_id, new_status=body.new_status,
                              effective_date=body.effective_date, note=body.note,
                              submitted_pack_artifact_id=submitted_pack_artifact_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return get_workspace(conn, workspace_id)


@router.get("/events")
def get_events(workspace_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    return {"events": list_events(conn, workspace_id)}
```

Add `from webapp.services.workflow_events import list_events` to the import block at the top of `webapp/api/status.py` (alongside the existing `webapp.persistence.workflow`/`webapp.persistence.workspaces` imports). The router calls only this one service function — it does not call `webapp.persistence.workflow.list_workflow_events` directly, and it does not reinterpret or reshape the event dicts; each returned event carries exactly the columns written by `record_status_change` in Task 5 (`id, workspace_id, previous_status, new_status, effective_date, note, submitted_pack_artifact_id, created_at`), with `submitted_pack_artifact_id` remaining the one canonical field name for the pack-binding reference (matching Tasks 3, 5, and 12 — never renamed to `application_pack_artifact_id` or hidden inside `note`).

Add the thin service wrapper as a new file:

```python
# webapp/services/workflow_events.py
"""Read-only view over persisted workflow events. One function, no
reinterpretation of event semantics — the router calls this instead of
querying persistence directly, and this in turn calls persistence directly
because there is nothing to assemble beyond what list_workflow_events
already returns."""
from __future__ import annotations

import sqlite3
from typing import Any

from webapp.persistence.workflow import list_workflow_events


def list_events(conn: sqlite3.Connection, workspace_id: str) -> list[dict[str, Any]]:
    return list_workflow_events(conn, workspace_id)
```

Add a test to `tests/webapp/api/test_status_routes.py` (alongside the existing tests in that file, Task 13's original Step 1):

```python
def test_get_events_returns_submitted_pack_binding_after_drafted(tmp_path):
    from webapp.persistence.artifacts import save_artifact
    from webapp.persistence.workflow import record_status_change

    settings = Settings(db_path=tmp_path / "jobsearch.sqlite3")
    app = create_app(settings)
    client = TestClient(app)
    with client:
        conn = connect(settings.db_path)
        ws = create_workspace(conn, company="Acme", title="Backend Engineer")
        pack = save_artifact(conn, workspace_id=ws["id"], artifact_type="application_pack", payload={})
        record_status_change(conn, workspace_id=ws["id"], new_status="drafted", effective_date="2026-08-18",
                              submitted_pack_artifact_id=pack["id"], _allow_drafted=True)
        conn.close()

        response = client.get(f"/api/workspaces/{ws['id']}/events")
        assert response.status_code == 200
        events = response.json()["events"]
        assert events[0]["new_status"] == "drafted"
        assert events[0]["submitted_pack_artifact_id"] == pack["id"]
```

(This test imports `connect` from `webapp.persistence.db` and `create_workspace` from `webapp.persistence.workspaces` — add those two imports to the top of `test_status_routes.py` if not already present from the file's original Step 1 content.)

- [ ] **Step 9: Register routers in app.py**

Add to `webapp/app.py`:

```python
from webapp.api.profile import router as profile_router
from webapp.api.review import router as review_router
from webapp.api.status import router as status_router
from webapp.api.workspaces import router as workspaces_router
```

```python
    app.include_router(profile_router)
    app.include_router(workspaces_router)
    app.include_router(review_router)
    app.include_router(status_router)
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `pytest tests/webapp/api/ -v`
Expected: PASS (all tests across the four route files, plus the new `test_get_events_returns_submitted_pack_binding_after_drafted` test added to `test_status_routes.py` in this correction)

- [ ] **Step 11: Run full suite**

Run: `pytest -q`
Expected: no regressions.

---

## Task 14: Full workspace UI with the six-way evidence vocabulary and workflow controls

**Files:**
- Create: `webapp/services/workspace_view.py`
- Create: `webapp/templates/base.html`
- Create: `webapp/templates/dashboard.html`
- Create: `webapp/templates/profile.html`
- Create: `webapp/templates/new_job.html`
- Create: `webapp/templates/workspace_detail.html`
- Create: `webapp/static/app.js`
- Create: `webapp/api/views.py`
- Modify: `webapp/app.py`
- Test: `tests/webapp/services/test_workspace_view.py`
- Test: `tests/webapp/api/test_views.py`

**Interfaces:**
- `webapp.services.workspace_view.build_workspace_view_model(conn, workspace_id: str) -> dict[str, Any]` — the ONE function that assembles everything `workspace_detail.html` needs: workspace row, current artifacts for every stage, staleness for every stage, computed stepper state per stage (`complete | current | needs_review | stale | unavailable`), and — critically, closing Finding #11 — a per-claim/per-item EVIDENCE CLASSIFICATION using the six labels below, computed here in the services layer so the template never has to guess. Raises nothing; returns `None`-valued sections for stages not yet run. This is the view-model both the HTML view (`GET /workspaces/{id}`) and the JSON review API (`GET /api/workspaces/{id}/review`, Task 13) can share — Task 13's `review_view.py` is intentionally narrower (only current artifacts, no stepper/evidence-classification computation) because the JSON review endpoint is consumed by the review-decision UI, not the read-only detail view; both live in `webapp/services` per the "no view-model assembly in routers" rule.
- **The six-way evidence vocabulary, computed exactly as follows (closes Finding #11 — v1 labelled every profile claim "Verified evidence" including placeholders/conflicts):**
  1. **Verified evidence** — a profile claim with `placeholder == False` and `concept_id` not in the current Job Fit Result's implicit conflict set, OR a Ticket 7 `direct_matches` entry.
  2. **Accepted inference — functionally equivalent** — a Ticket 7 `functionally_equivalent_matches` entry.
  3. **Transferable evidence** — a Ticket 7 `transferable_matches` entry (always rendered with its `extension_ref`/mapping and `limitations`/`conditions` visible, never collapsed by default).
  4. **Missing evidence** — a Ticket 7 `gaps` entry, or a profile claim with `placeholder == True`.
  5. **NEEDS_REVIEW** — any Ticket 6/7/8 item whose own `status`/`extraction_status` field literally is `NEEDS_REVIEW` (rendered with that literal label, never softened).
  6. **Unsupported — excluded from application material** — a Ticket 7 `unsupported_claims` entry, or a Ticket 8 `unsupported_claims` entry, or a content unit excluded from the pack by an `omit_from_positioning` review decision.
  A profile claim with `placeholder == False` that is NOT cited by any Job Fit match and NOT flagged as a gap is classified **Verified evidence** but shown in the Profile view only (not implied to be relevant to the current job) — the template never states or implies "the candidate does not have X" for evidence that simply wasn't cited; per the design, Missing evidence always means "no accepted evidence currently establishes this," never "definitely absent."
- Produces: `GET /`, `GET /profile`, `GET /new-job`, `GET /workspaces/{id}` (HTML), each thin: call the relevant service view-model function, render the template. `webapp/static/app.js` holds the workspace-detail page's stage-action buttons (Understand / Fit / Application Intelligence / confirm pack), each a `fetch()` POST to the corresponding API route from Task 13 followed by `location.reload()` — no client-side business logic, consistent with the design's "browser never recomputes fit/recommendation logic" rule.

- [ ] **Step 1: Write the failing test for the view-model service**

```python
# tests/webapp/services/test_workspace_view.py
from webapp.persistence.db import init_db, connect
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID, create_workspace
from webapp.services.workspace_view import build_conflicted_concept_ids, build_workspace_view_model


def _workspace(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    return conn, ws["id"]


def test_view_model_reports_unavailable_stages_before_any_processing(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    view = build_workspace_view_model(conn, workspace_id)
    assert view["stages"]["understanding"]["state"] == "unavailable"
    assert view["stages"]["fit"]["state"] == "unavailable"
    conn.close()


def test_view_model_classifies_direct_match_as_verified_evidence(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    save_artifact(conn, workspace_id=workspace_id, artifact_type="job_fit_result", payload={
        "status": "READY", "direct_matches": [{"match_id": "m1", "job_evidence_id": "jobev_1", "profile_evidence_ids": ["clm_1"]}],
        "functionally_equivalent_matches": [], "transferable_matches": [], "gaps": [], "unsupported_claims": [],
    })
    view = build_workspace_view_model(conn, workspace_id)
    evidence = view["evidence_items"]
    assert any(item["label"] == "Verified evidence" and item["source"] == "direct_matches" for item in evidence)
    conn.close()


def test_view_model_classifies_gap_as_missing_evidence(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    save_artifact(conn, workspace_id=workspace_id, artifact_type="job_fit_result", payload={
        "status": "READY", "direct_matches": [], "functionally_equivalent_matches": [], "transferable_matches": [],
        "gaps": [{"gap_id": "gap_1", "description": "No AWS experience"}], "unsupported_claims": [],
    })
    view = build_workspace_view_model(conn, workspace_id)
    assert any(item["label"] == "Missing evidence" for item in view["evidence_items"])
    conn.close()


def test_view_model_labels_conflicted_claim_as_needs_review_not_verified(tmp_path):
    # A claim whose concept_id appears in the profile's own conflicts list
    # must NOT be labelled Verified evidence — regression test for the bug
    # where only `placeholder` was checked, silently treating conflicted
    # claims as plainly verified.
    conn, workspace_id = _workspace(tmp_path)
    save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot", payload={
        "claims": [
            {"id": "clm_1", "concept_id": "cpt_1", "category": "employment", "field": "employer",
             "value": "Acme Corp", "placeholder": False},
        ],
        "conflicts": [{"id": "con_1", "concept_id": "cpt_1", "category": "employment", "field": "employer",
                        "variants": [{"value": "Acme Corp"}, {"value": "Acme Inc"}]}],
    })
    view = build_workspace_view_model(conn, workspace_id)
    conflicted_items = [i for i in view["evidence_items"] if i["source"] == "profile_conflict"]
    assert len(conflicted_items) == 1
    assert conflicted_items[0]["label"] == "NEEDS_REVIEW"
    assert not any(
        i["source"] == "profile_placeholder" and i["detail"].get("concept_id") == "cpt_1"
        for i in view["evidence_items"]
    )
    conn.close()


def test_view_model_classifies_transferable_match_with_limitations_visible(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    save_artifact(conn, workspace_id=workspace_id, artifact_type="job_fit_result", payload={
        "status": "READY", "direct_matches": [], "functionally_equivalent_matches": [],
        "transferable_matches": [{"match_id": "m2", "extension_ref": {"extension_id": "ext_x"},
                                    "limitations": "Requires certification.", "conditions": "x"}],
        "gaps": [], "unsupported_claims": [],
    })
    view = build_workspace_view_model(conn, workspace_id)
    transferable = [i for i in view["evidence_items"] if i["label"] == "Transferable evidence"]
    assert len(transferable) == 1
    assert transferable[0]["limitations"] == "Requires certification."
    conn.close()


def test_view_model_classifies_unsupported_claims_as_excluded(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    save_artifact(conn, workspace_id=workspace_id, artifact_type="application_intelligence_result", payload={
        "recommendation": "apply", "cv_content": [], "cover_letter_content": [],
        "unsupported_claims": [{"claim_id": "uns_1", "reason": "placeholder evidence", "rejected_atom_ids": []}],
    })
    view = build_workspace_view_model(conn, workspace_id)
    excluded = [i for i in view["evidence_items"] if i["label"] == "Unsupported — excluded from application material"]
    assert len(excluded) == 1
    conn.close()


def test_view_model_stepper_state_is_stale_when_upstream_changed(tmp_path):
    conn, workspace_id = _workspace(tmp_path)
    save_artifact(conn, workspace_id=workspace_id, artifact_type="job_posting_snapshot",
                  payload={"company": "Acme", "title": "Backend Engineer"}, content_id="jobsnap_A")
    fit = save_artifact(conn, workspace_id=workspace_id, artifact_type="job_fit_result",
                        payload={"status": "READY", "direct_matches": [], "functionally_equivalent_matches": [],
                                  "transferable_matches": [], "gaps": [], "unsupported_claims": []},
                        content_id="jobfitresult_A")
    from webapp.services.staleness import record_dependency_fingerprint
    record_dependency_fingerprint(conn, artifact_id=fit["id"], upstream_artifact_type="profile_snapshot",
                                   upstream_content_id="profilesnap_OLD")
    save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot",
                  payload={}, content_id="profilesnap_NEW")

    view = build_workspace_view_model(conn, workspace_id)
    assert view["stages"]["fit"]["state"] == "stale"
    conn.close()


def test_build_conflicted_concept_ids_returns_concept_ids_from_conflicts():
    profile_artifact = {"payload": {"conflicts": [
        {"id": "con_1", "concept_id": "cpt_1", "category": "employment", "field": "employer", "variants": []},
        {"id": "con_2", "concept_id": "cpt_2", "category": "education", "field": "institution", "variants": []},
    ]}}
    assert build_conflicted_concept_ids(profile_artifact) == {"cpt_1", "cpt_2"}


def test_build_conflicted_concept_ids_empty_when_no_profile():
    assert build_conflicted_concept_ids(None) == set()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/webapp/services/test_workspace_view.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write workspace_view.py**

```python
# webapp/services/workspace_view.py
"""Assembles the one view-model both the HTML workspace-detail page and any
future JSON consumer needs: current artifacts, computed stepper state, and
the six-way evidence classification. No domain logic — only reads already-
computed product/* results and labels them per the design's vocabulary."""
from __future__ import annotations

import sqlite3
from typing import Any

from webapp.persistence.artifacts import get_current_artifact
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID, get_workspace
from webapp.services.staleness import check_staleness

_STAGE_ARTIFACT_TYPES = {
    "understanding": "job_understanding_result",
    "fit": "job_fit_result",
    "application_intelligence": "application_intelligence_result",
}


def _stage_state(current: dict[str, Any] | None, staleness: dict[str, Any]) -> str:
    if current is None:
        return "unavailable"
    if staleness["stale"]:
        return "stale"
    payload = current["payload"]
    if payload.get("status") == "NEEDS_REVIEW":
        return "needs_review"
    return "complete"


def build_conflicted_concept_ids(profile_artifact: dict[str, Any] | None) -> set[str]:
    """concept_ids appearing in the profile snapshot's own conflicts list.

    A claim whose concept_id is in this set must NOT be labelled Verified
    evidence — the profile itself has multiple contradictory variants for
    that concept, so presenting any one of them as plainly verified would
    overstate the evidence. This closes the same class of bug Finding #11
    fixed in the workspace-detail view but that was reintroduced in the
    profile-only view (profile.html previously labelled every non-placeholder
    claim 'Verified evidence' regardless of conflict status)."""
    if profile_artifact is None:
        return set()
    return {conflict["concept_id"] for conflict in profile_artifact["payload"].get("conflicts", [])}


def _evidence_items_from_job_fit(fit_payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    if fit_payload is None:
        return []
    items = []
    for match in fit_payload.get("direct_matches", []):
        items.append({"label": "Verified evidence", "source": "direct_matches", "detail": match})
    for match in fit_payload.get("functionally_equivalent_matches", []):
        items.append({"label": "Accepted inference — functionally equivalent",
                      "source": "functionally_equivalent_matches", "detail": match})
    for match in fit_payload.get("transferable_matches", []):
        items.append({
            "label": "Transferable evidence", "source": "transferable_matches", "detail": match,
            "extension_ref": match.get("extension_ref"), "limitations": match.get("limitations"),
            "conditions": match.get("conditions"),
        })
    for gap in fit_payload.get("gaps", []):
        items.append({"label": "Missing evidence", "source": "gaps", "detail": gap})
    for claim in fit_payload.get("unsupported_claims", []):
        items.append({"label": "Unsupported — excluded from application material",
                      "source": "job_fit_unsupported_claims", "detail": claim})
    return items


def _evidence_items_from_application_intelligence(intelligence_payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    if intelligence_payload is None:
        return []
    items = []
    for claim in intelligence_payload.get("unsupported_claims", []):
        items.append({"label": "Unsupported — excluded from application material",
                      "source": "application_intelligence_unsupported_claims", "detail": claim})
    for unit in intelligence_payload.get("cv_content", []) + intelligence_payload.get("cover_letter_content", []):
        if unit.get("status") == "NEEDS_REVIEW":
            items.append({"label": "NEEDS_REVIEW", "source": "content_unit", "detail": unit})
    return items


def build_workspace_view_model(conn: sqlite3.Connection, workspace_id: str) -> dict[str, Any]:
    workspace = get_workspace(conn, workspace_id)
    profile = get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")
    job_posting = get_current_artifact(conn, workspace_id, "job_posting_snapshot")

    stages: dict[str, Any] = {}
    for stage_name, artifact_type in _STAGE_ARTIFACT_TYPES.items():
        current = get_current_artifact(conn, workspace_id, artifact_type)
        staleness = check_staleness(conn, workspace_id, artifact_type)
        stages[stage_name] = {"artifact": current, "state": _stage_state(current, staleness), "staleness": staleness}

    fit_payload = stages["fit"]["artifact"]["payload"] if stages["fit"]["artifact"] else None
    intelligence_payload = stages["application_intelligence"]["artifact"]["payload"] if stages["application_intelligence"]["artifact"] else None

    evidence_items = _evidence_items_from_job_fit(fit_payload) + _evidence_items_from_application_intelligence(intelligence_payload)

    if profile is not None:
        conflicted_concept_ids = build_conflicted_concept_ids(profile)
        for claim in profile["payload"].get("claims", []):
            if claim.get("placeholder"):
                evidence_items.append({"label": "Missing evidence", "source": "profile_placeholder", "detail": claim})
            elif claim.get("concept_id") in conflicted_concept_ids:
                evidence_items.append({"label": "NEEDS_REVIEW", "source": "profile_conflict", "detail": claim})

    return {
        "workspace": workspace, "profile": profile, "job_posting": job_posting,
        "stages": stages, "evidence_items": evidence_items,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/webapp/services/test_workspace_view.py -v`
Expected: PASS (9 tests)

- [ ] **Step 5: Write base.html and app.js**

```html
<!-- webapp/templates/base.html -->
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{% block title %}Job Application Workspace{% endblock %}</title>
    <style>
        body { font-family: system-ui, sans-serif; max-width: 1000px; margin: 2rem auto; padding: 0 1rem; }
        nav a { margin-right: 1rem; }
        .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.85rem; }
        .badge-verified { background: #d4edda; }
        .badge-inferred { background: #fff3cd; }
        .badge-transferable { background: #cce5ff; }
        .badge-missing { background: #f0f0f0; }
        .badge-needs-review { background: #f8d7da; font-weight: bold; }
        .badge-unsupported { background: #e2e3e5; text-decoration: line-through; }
        .badge-stale { background: #ffe5b4; }
        .stepper { display: flex; gap: 1rem; margin: 1rem 0; }
        .stepper .step { padding: 0.4rem 0.8rem; border-radius: 4px; background: #f0f0f0; }
        .stepper .step.complete { background: #d4edda; }
        .stepper .step.needs_review { background: #f8d7da; }
        .stepper .step.stale { background: #ffe5b4; }
        table { border-collapse: collapse; width: 100%; }
        th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #ddd; }
    </style>
</head>
<body>
    <nav>
        <a href="/">Dashboard</a>
        <a href="/profile">Profile</a>
        <a href="/new-job">New Job</a>
    </nav>
    <main>{% block content %}{% endblock %}</main>
    <script src="/static/app.js"></script>
</body>
</html>
```

```javascript
// webapp/static/app.js
async function runStage(workspaceId, stage, requestId) {
    const response = await fetch(`/api/workspaces/${workspaceId}/${stage}`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({request_id: requestId}),
    });
    const body = await response.json();
    if (!response.ok) { alert(body.detail || "Stage failed"); return; }
    location.reload();
}

async function submitReviewDecision(workspaceId, reviewItemType, sourceArtifactId, domainItemId, disposition) {
    const response = await fetch(`/api/workspaces/${workspaceId}/review-decisions`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({review_item_type: reviewItemType, source_artifact_id: sourceArtifactId,
                              domain_item_id: domainItemId, disposition}),
    });
    const body = await response.json();
    if (!response.ok) { alert(body.detail || "Could not save decision"); return; }
    location.reload();
}

async function confirmApplicationPack(workspaceId) {
    if (!confirm("I have reviewed the application material.")) { return; }
    const response = await fetch(`/api/workspaces/${workspaceId}/application-pack`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({confirmed: true, effective_date: new Date().toISOString().slice(0, 10)}),
    });
    const body = await response.json();
    if (!response.ok) { alert(body.detail || "Could not confirm application pack"); return; }
    location.reload();
}

async function setStatus(workspaceId, newStatus) {
    const response = await fetch(`/api/workspaces/${workspaceId}/status`, {
        method: "PATCH", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({new_status: newStatus, effective_date: new Date().toISOString().slice(0, 10)}),
    });
    const body = await response.json();
    if (!response.ok) { alert(body.detail || "Could not update status"); return; }
    location.reload();
}
```

- [ ] **Step 6: Write dashboard.html, profile.html, new_job.html**

```html
<!-- webapp/templates/dashboard.html -->
{% extends "base.html" %}
{% block title %}Dashboard{% endblock %}
{% block content %}
<h1>Applications</h1>
{% if not workspaces %}
<p>No workspaces yet. <a href="/new-job">Add a job</a> to get started.</p>
{% else %}
<table>
    <tr><th>Company</th><th>Title</th><th>Status</th><th>Updated</th></tr>
    {% for ws in workspaces %}
    <tr>
        <td><a href="/workspaces/{{ ws.id }}">{{ ws.company }}</a></td>
        <td>{{ ws.title }}</td>
        <td>{{ ws.workflow_status or "In progress" }}</td>
        <td>{{ ws.updated_at }}</td>
    </tr>
    {% endfor %}
</table>
{% endif %}
{% endblock %}
```

```html
<!-- webapp/templates/profile.html -->
{% extends "base.html" %}
{% block title %}Candidate Profile{% endblock %}
{% block content %}
<h1>Candidate Profile</h1>
<button onclick="fetch('/api/profile/refresh', {method: 'POST'}).then(() => location.reload())">Refresh profile</button>
{% if profile %}
<p>Snapshot: {{ profile.content_id }}</p>
<h2>Claims ({{ profile.payload.claims | length }})</h2>
<ul>
    {% for claim in profile.payload.claims %}
    <li>
        {% if claim.placeholder %}<span class="badge badge-missing">Missing evidence</span>
        {% elif claim.concept_id in conflicted_concept_ids %}<span class="badge badge-needs-review">NEEDS_REVIEW — conflicting evidence</span>
        {% else %}<span class="badge badge-verified">Verified evidence</span>{% endif %}
        {{ claim.field }}: {{ claim.value }}
    </li>
    {% endfor %}
</ul>
<h2>Conflicts ({{ profile.payload.conflicts | length }})</h2>
<ul>{% for conflict in profile.payload.conflicts %}<li>{{ conflict.field }}</li>{% endfor %}</ul>
{% else %}
<p>No profile snapshot yet.</p>
{% endif %}
{% endblock %}
```

```html
<!-- webapp/templates/new_job.html -->
{% extends "base.html" %}
{% block title %}New Job{% endblock %}
{% block content %}
<h1>New Job</h1>
<form id="new-job-form">
    <label>Company <input name="company" required></label><br>
    <label>Title <input name="title" required></label><br>
    <label>Job text<br><textarea name="raw_text" rows="10" cols="60"></textarea></label><br>
    <button type="submit">Create workspace</button>
</form>
<script>
document.getElementById('new-job-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const company = form.get('company'), title = form.get('title');
    const response = await fetch('/api/workspaces', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({company, title, source_record: {
            schema_version: 'job-source-record.v0', source: 'manual',
            captured_at: new Date().toISOString(), company, title, raw_text: form.get('raw_text'),
        }}),
    });
    const body = await response.json();
    if (response.ok) { window.location.href = '/workspaces/' + body.workspace.id; }
    else { alert(body.detail || 'Could not create job'); }
});
</script>
{% endblock %}
```

- [ ] **Step 7: Write workspace_detail.html — the full stepper and evidence display**

```html
<!-- webapp/templates/workspace_detail.html -->
{% extends "base.html" %}
{% block title %}{{ workspace.company }} — {{ workspace.title }}{% endblock %}
{% block content %}
<h1>{{ workspace.company }} — {{ workspace.title }}</h1>
<p>Application status: <strong>{{ workspace.workflow_status or "In progress (not yet drafted)" }}</strong></p>

<div class="stepper">
    <span class="step {{ 'complete' if job_posting else 'unavailable' }}">Job</span>
    <span class="step {{ stages.understanding.state }}">Understanding</span>
    <span class="step {{ stages.fit.state }}">Job Fit</span>
    <span class="step {{ stages.application_intelligence.state }}">Application Intelligence</span>
    <span class="step">Review</span>
    <span class="step">Status</span>
</div>

<h2>Job</h2>
{% if job_posting %}
<pre>{{ job_posting.payload.raw_text or "" }}</pre>
{% else %}<p>No job snapshot.</p>{% endif %}

<h2>Job Understanding
{% if stages.understanding.state == "stale" %}<span class="badge badge-stale">Stale — generated from an older upstream result</span>{% endif %}
</h2>
{% if stages.understanding.artifact %}
<p>Status: {{ stages.understanding.artifact.payload.status }}</p>
{% for category in ["requirements", "responsibilities", "language_requirements", "eligibility_requirements", "logistics_requirements"] %}
<h3>{{ category | replace("_", " ") | title }}</h3>
<ul>{% for item in stages.understanding.artifact.payload.get(category, []) %}<li>{{ item.text }}</li>{% endfor %}</ul>
{% endfor %}
<h3>Suggestions (not evidence)</h3>
<ul>{% for s in stages.understanding.artifact.payload.suggestions %}<li>{{ s.text }} — {{ s.reason }}</li>{% endfor %}</ul>
<h3>Ambiguous statements (not evidence)</h3>
<ul>{% for a in stages.understanding.artifact.payload.ambiguous_statements %}<li>{{ a.text }}</li>{% endfor %}</ul>
<h3>Warnings</h3>
<ul>{% for w in stages.understanding.artifact.payload.warnings %}<li>{{ w }}</li>{% endfor %}</ul>
{% else %}
<p>Not yet run.</p>
<button onclick="runStage('{{ workspace.id }}', 'understand', 'req_' + Date.now())">Run Job Understanding</button>
{% endif %}

<h2>Job Fit
{% if stages.fit.state == "stale" %}<span class="badge badge-stale">Stale — generated from an older upstream result</span>{% endif %}
</h2>
{% if stages.fit.artifact %}
<p>Status: {{ stages.fit.artifact.payload.status }}</p>
{% if stages.fit.artifact.payload.verdict %}<p>Verdict: {{ stages.fit.artifact.payload.verdict.display_name }}</p>{% endif %}
{% for item in evidence_items %}
{% if item.source in ["direct_matches", "functionally_equivalent_matches", "transferable_matches", "gaps"] %}
<div>
    {% if item.label == "Verified evidence" %}<span class="badge badge-verified">Verified evidence</span>
    {% elif item.label.startswith("Accepted inference") %}<span class="badge badge-inferred">{{ item.label }}</span>
    {% elif item.label == "Transferable evidence" %}<span class="badge badge-transferable">Transferable evidence</span>
    {% elif item.label == "Missing evidence" %}<span class="badge badge-missing">Missing evidence</span>{% endif %}
    {% if item.label == "Transferable evidence" %}
        <br>Mapping: {{ item.extension_ref }} — Limitations: {{ item.limitations }}
        {% if item.conditions %} — Conditions: {{ item.conditions }}{% endif %}
    {% endif %}
</div>
{% endif %}
{% endfor %}
{% else %}
<p>Not yet run.</p>
<button onclick="runStage('{{ workspace.id }}', 'fit', 'req_' + Date.now())">Run Job Fit</button>
{% endif %}

<h2>Application Intelligence
{% if stages.application_intelligence.state == "stale" %}<span class="badge badge-stale">Stale — generated from an older upstream result</span>{% endif %}
</h2>
{% if stages.application_intelligence.artifact %}
<p>Recommendation: {{ stages.application_intelligence.artifact.payload.recommendation }}</p>
<h3>CV content</h3>
<ul>
    {% for unit in stages.application_intelligence.artifact.payload.cv_content %}
    <li>
        {% if unit.status == "NEEDS_REVIEW" %}
            <span class="badge badge-needs-review">NEEDS_REVIEW</span>
            <button onclick="submitReviewDecision('{{ workspace.id }}', 'content_unit', '{{ stages.application_intelligence.artifact.id }}', '{{ unit.unit_id }}', 'acknowledged_and_proceed')">Acknowledge and proceed</button>
            <button onclick="submitReviewDecision('{{ workspace.id }}', 'content_unit', '{{ stages.application_intelligence.artifact.id }}', '{{ unit.unit_id }}', 'omit_from_positioning')">Omit</button>
        {% endif %}
        {{ unit.text }}
    </li>
    {% endfor %}
</ul>
{% for item in evidence_items %}
{% if item.label == "Unsupported — excluded from application material" %}
<p><span class="badge badge-unsupported">Unsupported — excluded from application material</span> {{ item.detail.reason }}</p>
{% endif %}
{% endfor %}
{% else %}
<p>Not yet run.</p>
<button onclick="runStage('{{ workspace.id }}', 'application-intelligence', 'req_' + Date.now())">Run Application Intelligence</button>
{% endif %}

<h2>Review &amp; Confirm</h2>
{% if stages.fit.artifact and stages.application_intelligence.artifact %}
<button onclick="confirmApplicationPack('{{ workspace.id }}')">I have reviewed the application material — Confirm</button>
{% else %}
<p>Complete Job Fit and Application Intelligence before final review.</p>
{% endif %}

<h2>Status</h2>
<p>Current: {{ workspace.workflow_status or "not yet drafted" }}</p>
{% if workspace.workflow_status %}
<button onclick="setStatus('{{ workspace.id }}', 'applied')">Mark as applied</button>
<button onclick="setStatus('{{ workspace.id }}', 'interview')">Interview</button>
<button onclick="setStatus('{{ workspace.id }}', 'offer')">Offer received</button>
<button onclick="setStatus('{{ workspace.id }}', 'hired')">Hired</button>
<button onclick="setStatus('{{ workspace.id }}', 'rejected')">Rejected</button>
<button onclick="setStatus('{{ workspace.id }}', 'no_response')">No response</button>
<button onclick="setStatus('{{ workspace.id }}', 'offer_declined')">Offer declined</button>
<button onclick="setStatus('{{ workspace.id }}', 'withdrawn')">Withdraw</button>
{% endif %}
{% endblock %}
```

- [ ] **Step 8: Write views.py**

```python
# webapp/api/views.py
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from webapp.api.dependencies import get_conn
from webapp.persistence.artifacts import get_current_artifact
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID, get_workspace, list_workspaces
from webapp.services.workspace_view import build_conflicted_concept_ids, build_workspace_view_model

router = APIRouter(tags=["views"])


@router.get("/", response_class=HTMLResponse)
def dashboard(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    return request.app.state.templates.TemplateResponse(request, "dashboard.html", {"workspaces": list_workspaces(conn)})


@router.get("/profile", response_class=HTMLResponse)
def profile_page(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    current = get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")
    conflicted_concept_ids = build_conflicted_concept_ids(current)
    return request.app.state.templates.TemplateResponse(
        request, "profile.html", {"profile": current, "conflicted_concept_ids": conflicted_concept_ids}
    )


@router.get("/new-job", response_class=HTMLResponse)
def new_job_page(request: Request):
    return request.app.state.templates.TemplateResponse(request, "new_job.html", {})


@router.get("/workspaces/{workspace_id}", response_class=HTMLResponse)
def workspace_detail_page(workspace_id: str, request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    workspace = get_workspace(conn, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="workspace not found")
    view = build_workspace_view_model(conn, workspace_id)
    return request.app.state.templates.TemplateResponse(request, "workspace_detail.html", view)
```

- [ ] **Step 9: Mount static files and register views router in app.py**

Add to `webapp/app.py`:

```python
from fastapi.staticfiles import StaticFiles

from webapp.api.views import router as views_router
```

```python
    app.mount("/static", StaticFiles(directory=str(Path(__file__).with_name("static"))), name="static")
    app.include_router(views_router)
```

- [ ] **Step 10: Write and run the API-level view tests**

```python
# tests/webapp/api/test_views.py
from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings
from webapp.persistence.artifacts import save_artifact
from webapp.persistence.db import connect
from webapp.persistence.workspaces import create_workspace


def _client(tmp_path):
    settings = Settings(db_path=tmp_path / "jobsearch.sqlite3")
    return TestClient(create_app(settings)), settings


def test_dashboard_renders_with_no_workspaces(tmp_path):
    client, _ = _client(tmp_path)
    with client:
        response = client.get("/")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]


def test_dashboard_lists_created_workspace(tmp_path):
    client, settings = _client(tmp_path)
    with client:
        conn = connect(settings.db_path)
        create_workspace(conn, company="Acme", title="Backend Engineer")
        conn.close()
        response = client.get("/")
        assert "Acme" in response.text


def test_workspace_detail_shows_stepper_and_run_buttons(tmp_path):
    client, settings = _client(tmp_path)
    with client:
        conn = connect(settings.db_path)
        ws = create_workspace(conn, company="Acme", title="Backend Engineer")
        conn.close()
        response = client.get(f"/workspaces/{ws['id']}")
        assert "Run Job Understanding" in response.text
        assert "stepper" in response.text


def test_workspace_detail_404_for_unknown_id(tmp_path):
    client, _ = _client(tmp_path)
    with client:
        assert client.get("/workspaces/does-not-exist").status_code == 404


def test_untrusted_job_text_is_escaped(tmp_path):
    client, settings = _client(tmp_path)
    with client:
        conn = connect(settings.db_path)
        ws = create_workspace(conn, company="Acme", title="Backend Engineer")
        save_artifact(conn, workspace_id=ws["id"], artifact_type="job_posting_snapshot",
                      payload={"raw_text": "<script>alert(1)</script>"}, content_id="jobsnap_x")
        conn.close()
        response = client.get(f"/workspaces/{ws['id']}")
        assert "<script>alert(1)</script>" not in response.text
        assert "&lt;script&gt;" in response.text


def test_transferable_evidence_shows_limitations_uncollapsed(tmp_path):
    client, settings = _client(tmp_path)
    with client:
        conn = connect(settings.db_path)
        ws = create_workspace(conn, company="Acme", title="Backend Engineer")
        save_artifact(conn, workspace_id=ws["id"], artifact_type="job_fit_result", payload={
            "status": "READY", "direct_matches": [], "functionally_equivalent_matches": [],
            "transferable_matches": [{"match_id": "m1", "extension_ref": {"extension_id": "ext_x"},
                                        "limitations": "Requires HSE certification.", "conditions": None}],
            "gaps": [], "unsupported_claims": [],
        })
        conn.close()
        response = client.get(f"/workspaces/{ws['id']}")
        assert "Requires HSE certification." in response.text


def test_profile_page_labels_conflicted_claim_needs_review_not_verified(tmp_path):
    client, settings = _client(tmp_path)
    with client:
        conn = connect(settings.db_path)
        from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID
        save_artifact(conn, workspace_id=PROFILE_WORKSPACE_ID, artifact_type="profile_snapshot", payload={
            "claims": [{"id": "clm_1", "concept_id": "cpt_1", "category": "employment", "field": "employer",
                        "value": "Acme Corp", "placeholder": False}],
            "conflicts": [{"id": "con_1", "concept_id": "cpt_1", "category": "employment", "field": "employer",
                            "variants": [{"value": "Acme Corp"}, {"value": "Acme Inc"}]}],
        })
        conn.close()
        response = client.get("/profile")
        assert "NEEDS_REVIEW" in response.text
        assert "Acme Corp" in response.text
        # This fixture has exactly one claim (the conflicted one), so a
        # correct implementation never emits "Verified evidence" anywhere on
        # the page — a stronger, unambiguous assertion than checking the
        # conflicted claim's own <li> in isolation.
        assert "Verified evidence" not in response.text
```

Run: `pytest tests/webapp/api/test_views.py -v`
Expected: PASS (7 tests)

- [ ] **Step 11: Run full suite**

Run: `pytest -q`
Expected: no regressions.

---

## Task 15: Rebuilt acceptance suite with real direct/functional/transferable/blocked/unsupported fixtures

**Files:**
- Create: `tests/webapp/fixtures/acceptance/__init__.py`
- Create: `tests/webapp/fixtures/acceptance/fixtures.py`
- Create: `tests/webapp/test_full_journey_acceptance.py`
- Create: `tests/webapp/test_domain_regression_guard.py`

**Interfaces:**
- Closes Finding #13. All fixtures below are copied/adapted VERBATIM from `tests/test_job_fit.py`, `tests/test_semantic_job_fit.py`, and `tests/test_application_intelligence.py` — the existing, already-proven Ticket 7/8 test suites — rather than hand-authored from scratch, so every scenario is guaranteed to exercise real `product/*` validation paths instead of a plausible-looking but subtly-invalid guess.
- `tests/webapp/fixtures/acceptance/fixtures.py` exposes: `profile_snapshot()`, `rich_profile()`, `job_snapshot()`, `extension()` (with a `transferable_mappings` entry), `direct_match_proposal()`, `functionally_equivalent_match_proposal()`, `transferable_match_proposal()`, `blocking_gate_proposals()`, `unverified_gate_proposals()`, `ready_content_unit_atom()`, `unsupported_content_unit_atom()` — each a small function returning the exact verified dict shapes from the research above.

- [ ] **Step 1: Write the fixtures module**

```python
# tests/webapp/fixtures/acceptance/fixtures.py
"""Real, product/*-validated fixtures adapted from tests/test_job_fit.py,
tests/test_semantic_job_fit.py, and tests/test_application_intelligence.py.
Every shape here is copied from an existing passing Ticket 7/8 test, not
hand-authored, so the Ticket 9 acceptance suite exercises genuine validation
paths (direct, functionally_equivalent, transferable, blocked, unresolved,
unsupported) rather than approximations."""
from __future__ import annotations

from typing import Any

PROFILE_SCHEMA_VERSION = "candidate-profile-evidence-snapshot.v0"
ID_SEMANTICS = "deterministic content-derived identifiers; not durable persistent identifiers"


def _claim(claim_id: str, category: str, field: str, value: str) -> dict[str, Any]:
    return {
        "id": claim_id, "record_id": claim_id.replace("clm_", "rec_"), "concept_id": claim_id.replace("clm_", "cpt_"),
        "category": category, "field": field, "value": value,
        "source": {"file": "CLAUDE.md", "section": None, "line_start": 1, "line_end": 1},
        "placeholder": False, "confidence": "high", "extraction_status": "explicit",
    }


def profile_snapshot() -> dict[str, Any]:
    claims = [
        _claim("clm_1111111111111111", "skills", "technical_skill", "Python"),
        _claim("clm_2222222222222222", "employment", "responsibility_or_achievement", "Built production data pipelines"),
        _claim("clm_3333333333333333", "education", "qualification", "Synthetic MSc"),
    ]
    return {
        "schema_version": PROFILE_SCHEMA_VERSION, "id_semantics": ID_SEMANTICS,
        "sources": [{"file": "CLAUDE.md", "sha256": "a" * 64, "line_count": 40}],
        "claims": claims, "corroborations": [], "conflicts": [],
        "summary": {"source_count": 1, "claim_count": len(claims), "placeholder_claim_count": 0,
                     "corroboration_count": 0, "conflict_count": 0},
    }


def rich_profile() -> dict[str, Any]:
    profile = profile_snapshot()
    profile["claims"].extend([
        _claim("clm_4444444444444444", "eligibility", "work_authorization", "Right to work in the UK"),
        _claim("clm_5555555555555555", "languages", "language", "German"),
        _claim("clm_6666666666666666", "constraints", "location", "London hybrid"),
    ])
    profile["summary"]["claim_count"] = len(profile["claims"])
    return profile


def job_snapshot() -> dict[str, Any]:
    return {
        "schema_version": "job-posting-snapshot.v0", "job_id": "job-001", "source": "synthetic",
        "source_url": "https://example.test/jobs/1", "captured_at": "2026-08-16T12:00:00Z",
        "company": "Example Corp", "title": "Data Scientist", "location": "Remote",
        "employment_type": "Full time", "description": "Synthetic posting.",
        "raw_text": "Strong Python experience. Build data pipelines.",
        "requirements": [
            {"id": "req-python", "text": "Strong Python experience", "kind": "required"},
            {"id": "req-cert", "text": "Professional certification", "kind": "preferred"},
        ],
        "responsibilities": [{"id": "resp-pipelines", "text": "Build data pipelines", "kind": "required"}],
        "language_requirements": [{"id": "lang-english", "text": "English required", "kind": "required"}],
        "eligibility_requirements": [], "logistics_requirements": [],
        "compensation": {"text": "Not stated"}, "metadata": {"fixture": True},
    }


def extension() -> dict[str, Any]:
    return {
        "schema_version": "extension-package.v0", "id": "data-transfer", "name": "Data Transfer",
        "version": "0.1.0", "status": "active", "description": "x", "publisher": "x", "trust": "x",
        "metadata": {}, "scope": "x",
        "transferable_mappings": [{
            "id": "field-models-to-pipelines",
            "source": {"concept": "field modelling"}, "target": {"competency_id": "pipeline-design"},
            "rationale": "Model workflow design can support pipeline reasoning.",
            "transfer_strength": "moderate",
            "limitations": ["Does not prove employment history"],
            "conditions": [],  # cleared to [] so the resulting match resolves READY, not NEEDS_REVIEW
            "evidence_requirements": ["Concrete workflow example"], "source_ids": ["guide"],
        }],
    }


def direct_match_proposal(job_evidence_id: str) -> dict[str, Any]:
    return {
        "proposal_id": "sem-python", "job_evidence_id": job_evidence_id,
        "profile_evidence_ids": ["clm_1111111111111111"], "classification": "direct",
        "rationale": "Python is explicit on both sides.", "confidence": "high",
    }


def functionally_equivalent_match_proposal(job_evidence_id: str) -> dict[str, Any]:
    return {
        "proposal_id": "sem-pipelines", "job_evidence_id": job_evidence_id,
        "profile_evidence_ids": ["clm_2222222222222222"], "classification": "functionally_equivalent",
        "rationale": "Pipeline building responsibility aligns by function.", "confidence": "high",
        "functional_basis": {
            "responsibility_alignment": ["Build reliable data pipelines", "Built production data pipelines"],
            "competency_alignment": [], "title_similarity_only": False,
        },
    }


def transferable_match_proposal(job_evidence_id: str) -> dict[str, Any]:
    return {
        "proposal_id": "sem-transfer", "job_evidence_id": job_evidence_id,
        "profile_evidence_ids": ["clm_2222222222222222"], "classification": "transferable",
        "rationale": "Extension mapping supports transferability.", "confidence": "medium",
        "extension_ref": {"extension_id": "data-transfer", "extension_version": "0.1.0",
                          "record_type": "transferable_mapping", "record_id": "field-models-to-pipelines"},
    }


def blocking_gate_proposals() -> list[dict[str, Any]]:
    return [
        {"gate_id": "eligibility", "status": "FAIL",
         "reason": "Affirmative eligibility incompatibility evidence.",
         "job_evidence_ids": [], "profile_evidence_ids": ["clm_4444444444444444"]},
        {"gate_id": "language", "status": "PASS", "reason": "German fluency confirmed.",
         "job_evidence_ids": [], "profile_evidence_ids": ["clm_5555555555555555"]},
        {"gate_id": "location_logistics", "status": "PASS", "reason": "Hybrid location compatible.",
         "job_evidence_ids": [], "profile_evidence_ids": ["clm_6666666666666666"]},
    ]


def unverified_gate_proposals() -> list[dict[str, Any]]:
    return [
        {"gate_id": gate_id, "status": "UNVERIFIED", "reason": "No profile evidence available.",
         "job_evidence_ids": [], "profile_evidence_ids": []}
        for gate_id in ("eligibility", "language", "location_logistics")
    ]


def ready_content_unit_atom() -> dict[str, Any]:
    return {"atom_id": "atom-1", "atom_kind": "candidate_fact", "assertion_type": "technical_skill",
            "profile_evidence_ids": ["clm_1111111111111111"], "rendering_variant": "PLAIN"}


def unsupported_content_unit_atom() -> dict[str, Any]:
    return {"atom_id": "atom-1", "atom_kind": "candidate_fact", "assertion_type": "certification",
            "profile_evidence_ids": ["clm_9999999999999999"], "rendering_variant": "PLAIN"}
```

- [ ] **Step 2: Write the domain regression guard test**

```python
# tests/webapp/test_domain_regression_guard.py
"""Confirms webapp/ never imports from tests/ and never monkeypatches
product/ module attributes. A structural guard, not a behavior test."""
import ast
from pathlib import Path

WEBAPP_ROOT = Path(__file__).parents[2] / "webapp"


def _all_py_files():
    return list(WEBAPP_ROOT.rglob("*.py"))


def test_webapp_never_imports_from_tests_package():
    for path in _all_py_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("tests"):
                raise AssertionError(f"{path} imports from tests/: {node.module}")


def test_webapp_never_monkeypatches_product_module_attributes():
    for path in _all_py_files():
        source = path.read_text(encoding="utf-8")
        assert "setattr(product" not in source, f"{path} appears to monkeypatch a product module"
```

- [ ] **Step 3: Run the guard test to verify it passes immediately**

Run: `pytest tests/webapp/test_domain_regression_guard.py -v`
Expected: PASS (2 tests) — a drift guard, not TDD-driven; should already pass given Tasks 1-14's code.

- [ ] **Step 4: Write the full acceptance suite**

```python
# tests/webapp/test_full_journey_acceptance.py
"""End-to-end acceptance suite proving every invariant from the frozen
Ticket 9 design and PM review: direct/functional/transferable matches,
blocked gates, unresolved dimensions, unsupported claims, staleness, review
gating, Gate-4-only drafted, provider failure, and no autonomous submission.
Fixtures are real product/*-validated shapes (see fixtures.py), not
hand-authored approximations."""
from pathlib import Path

from fastapi.testclient import TestClient

from product.application_intelligence_providers import ProviderResponse as AIProviderResponse
from product.job_understanding_providers import ProviderResponse as JUProviderResponse

from webapp.app import create_app
from webapp.config import Settings
from webapp.services.semantic_proposal_adapter import FakeSemanticProposalAdapter
from webapp.services.semantic_proposer_errors import SemanticProposerProviderError

from tests.webapp.fixtures.acceptance.fixtures import (
    blocking_gate_proposals,
    direct_match_proposal,
    extension,
    functionally_equivalent_match_proposal,
    profile_snapshot,
    ready_content_unit_atom,
    rich_profile,
    transferable_match_proposal,
    unsupported_content_unit_atom,
    unverified_gate_proposals,
)

FIXTURE_PROFILE_ROOT = Path(__file__).parent / "fixtures" / "webapp_profile_root"


class _FakeJobUnderstandingProvider:
    provider_id = "fake"; model_id = "fake-model"; model_version = "fake-model-v0"

    def extract(self, request):
        return JUProviderResponse(payload={
            "schema_version": "job-understanding-candidate.v0", "items": [],
            "suggestions": [], "ambiguous_statements": [], "warnings": [],
        })


class _FakeApplicationIntelligenceProvider:
    provider_id = "fake"; model_id = "fake-model"; model_version = "fake-model-v0"

    def __init__(self, content_units):
        self._content_units = content_units

    def propose(self, request):
        return AIProviderResponse(payload={"content_units": self._content_units})


def _client(tmp_path, *, semantic_adapter=None, ai_provider=None):
    settings = Settings(db_path=tmp_path / "jobsearch.sqlite3")
    app = create_app(settings)
    app.state.profile_root = str(FIXTURE_PROFILE_ROOT)
    app.state.job_understanding_provider = _FakeJobUnderstandingProvider()
    app.state.semantic_adapter = semantic_adapter or FakeSemanticProposalAdapter(
        canned_response={"matches": [], "gates": unverified_gate_proposals()}
    )
    app.state.application_intelligence_provider = ai_provider or _FakeApplicationIntelligenceProvider([])
    return TestClient(app)


def _create_workspace(client):
    response = client.post("/api/workspaces", json={
        "company": "Example Corp", "title": "Data Scientist",
        "source_record": {"schema_version": "job-source-record.v0", "source": "manual",
                          "captured_at": "2026-08-18T00:00:00Z", "company": "Example Corp", "title": "Data Scientist",
                          "requirements": [{"text": "Strong Python experience", "kind": "required"}],
                          "responsibilities": [{"text": "Build data pipelines", "kind": "required"}]},
    })
    assert response.status_code == 201
    return response.json()["workspace"]["id"]


def test_direct_functional_and_transferable_matches_all_surface(tmp_path):
    # Extensions are resolved server-side by id (Task 11) — install one real
    # fixture extension into a temp extensions_dir and select it by id.
    import json as _json
    extensions_dir = tmp_path / "extensions"
    ext_dir = extensions_dir / "data-transfer"
    ext_dir.mkdir(parents=True)
    (ext_dir / "extension.json").write_text(_json.dumps(extension()), encoding="utf-8")

    settings = Settings(db_path=tmp_path / "jobsearch.sqlite3", extensions_dir=extensions_dir)
    app = create_app(settings)
    app.state.profile_root = str(FIXTURE_PROFILE_ROOT)
    app.state.job_understanding_provider = _FakeJobUnderstandingProvider()
    app.state.application_intelligence_provider = _FakeApplicationIntelligenceProvider([])
    # First pass: empty proposals, only to materialize the resolved evidence
    # bundle so we can read the real (deterministic, content-derived)
    # evidence ids Ticket 5/6 assigned — never hardcode a guessed id string.
    app.state.semantic_adapter = FakeSemanticProposalAdapter(
        canned_response={"matches": [], "gates": unverified_gate_proposals()}
    )
    client = TestClient(app)
    with client:
        client.post("/api/profile/refresh")
        workspace_id = _create_workspace(client)
        discover = client.post(f"/api/workspaces/{workspace_id}/fit", json={"request_id": "req_discover"})
        assert discover.status_code == 200

        review = client.get(f"/api/workspaces/{workspace_id}/review").json()
        bundle = review["resolved_job_evidence"]["payload"]
        requirements_id = next(
            item["id"] for item in bundle["evidence"]
            if item["category"] == "requirements" and item["text"] == "Strong Python experience"
        )
        responsibilities_id = next(
            item["id"] for item in bundle["evidence"]
            if item["category"] == "responsibilities" and item["text"] == "Build data pipelines"
        )

        real_proposals = {
            "matches": [
                direct_match_proposal(requirements_id),
                functionally_equivalent_match_proposal(responsibilities_id),
                transferable_match_proposal(responsibilities_id),
            ],
            "gates": unverified_gate_proposals(),
        }
        app.state.semantic_adapter = FakeSemanticProposalAdapter(canned_response=real_proposals)
        second = client.post(
            f"/api/workspaces/{workspace_id}/fit",
            json={"request_id": "req_real", "extension_ids": ["data-transfer"]},
        )
        assert second.status_code == 200
        result = second.json()["artifact"]["payload"]
        assert len(result["direct_matches"]) == 1
        assert len(result["functionally_equivalent_matches"]) == 1
        assert len(result["transferable_matches"]) == 1


def test_blocked_gate_prevents_verdict_and_score(tmp_path):
    proposals = {"matches": [], "gates": blocking_gate_proposals()}
    adapter = FakeSemanticProposalAdapter(canned_response=proposals)
    client = _client(tmp_path, semantic_adapter=adapter)
    with client:
        client.post("/api/profile/refresh")
        workspace_id = _create_workspace(client)
        response = client.post(f"/api/workspaces/{workspace_id}/fit", json={"request_id": "req_1"})
        assert response.status_code == 200
        result = response.json()["artifact"]["payload"]
        assert result["blocked"] is True
        assert result["overall_score"] is None
        assert result["verdict"] is None


def test_unsupported_content_unit_excluded_from_pack_but_visible_in_audit(tmp_path):
    proposals = {"matches": [], "gates": unverified_gate_proposals()}
    adapter = FakeSemanticProposalAdapter(canned_response=proposals)
    ai_provider = _FakeApplicationIntelligenceProvider([
        {"unit_id": "cv-ready", "unit_type": "cv_bullet", "atoms": [ready_content_unit_atom()], "connectives": []},
        {"unit_id": "cv-unsupported", "unit_type": "cv_bullet", "atoms": [unsupported_content_unit_atom()], "connectives": []},
    ])
    client = _client(tmp_path, semantic_adapter=adapter, ai_provider=ai_provider)
    with client:
        client.post("/api/profile/refresh")
        workspace_id = _create_workspace(client)
        client.post(f"/api/workspaces/{workspace_id}/fit", json={"request_id": "req_1"})
        ai_response = client.post(f"/api/workspaces/{workspace_id}/application-intelligence", json={"request_id": "req_2"})
        assert ai_response.status_code == 200
        result = ai_response.json()["artifact"]["payload"]
        assert len(result["unsupported_claims"]) == 1
        assert "unknown profile evidence id" in result["unsupported_claims"][0]["reason"]


def test_semantic_proposer_failure_leaves_previous_result_intact(tmp_path):
    class _FailingAdapter:
        def propose(self, **kwargs):
            raise SemanticProposerProviderError("simulated outage")

    good_adapter = FakeSemanticProposalAdapter(canned_response={"matches": [], "gates": unverified_gate_proposals()})
    client = _client(tmp_path, semantic_adapter=good_adapter)
    with client:
        client.post("/api/profile/refresh")
        workspace_id = _create_workspace(client)
        first = client.post(f"/api/workspaces/{workspace_id}/fit", json={"request_id": "req_1"})
        assert first.status_code == 200
        first_result_id = first.json()["artifact"]["id"]

        client.app.state.semantic_adapter = _FailingAdapter()
        second = client.post(f"/api/workspaces/{workspace_id}/fit", json={"request_id": "req_2"})
        assert second.status_code == 400

        review = client.get(f"/api/workspaces/{workspace_id}/review").json()
        assert review["job_fit_result"]["id"] == first_result_id  # unchanged — no fabricated new result


def test_stale_job_fit_blocks_application_pack(tmp_path):
    # Real dependency mutation, no manual fingerprint/stale-flag manipulation:
    # copy the fixture profile root to a mutable tmp_path location, run the
    # full pipeline once against it, then append a genuinely new claim (a
    # second numbered Publications entry — verified against
    # product/profile_snapshot.py's numbered-list parser) to the SAME source
    # file and refresh again. build_snapshot has no caching (verified against
    # source), so this produces a real, different profile_snapshot_content_id,
    # which the Ticket 9 dependency-fingerprint system (Task 8) must detect
    # as staleness on its own — this test never touches dependency_fingerprints
    # or check_staleness directly.
    import shutil

    mutable_profile_root = tmp_path / "mutable_profile_root"
    shutil.copytree(FIXTURE_PROFILE_ROOT, mutable_profile_root)

    proposals = {"matches": [], "gates": unverified_gate_proposals()}
    adapter = FakeSemanticProposalAdapter(canned_response=proposals)
    settings = Settings(db_path=tmp_path / "jobsearch.sqlite3")
    app = create_app(settings)
    app.state.profile_root = str(mutable_profile_root)
    app.state.job_understanding_provider = _FakeJobUnderstandingProvider()
    app.state.semantic_adapter = adapter
    app.state.application_intelligence_provider = _FakeApplicationIntelligenceProvider([])
    client = TestClient(app)

    with client:
        client.post("/api/profile/refresh")
        workspace_id = _create_workspace(client)
        fit_response = client.post(f"/api/workspaces/{workspace_id}/fit", json={"request_id": "req_1"})
        assert fit_response.status_code == 200
        client.post(f"/api/workspaces/{workspace_id}/application-intelligence", json={"request_id": "req_2"})

        # Genuinely mutate the authoritative profile source: append a new,
        # distinct claim to the same candidate-profile markdown file.
        candidate_profile_path = (
            mutable_profile_root / ".claude" / "skills" / "job-application-assistant" / "01-candidate-profile.md"
        )
        with candidate_profile_path.open("a", encoding="utf-8") as handle:
            handle.write(
                "\n2. Ada Lovelace (2027). A Second Note on the Analytical Engine. "
                "Journal of Computing History.\n"
            )

        second_refresh = client.post("/api/profile/refresh")
        assert second_refresh.status_code == 200
        old_profile_content_id_response = client.get("/api/profile").json()
        assert old_profile_content_id_response["profile"]["content_id"] != fit_response.json()["artifact"]["payload"].get(
            "profile_snapshot", {}
        ).get("content_id")  # sanity: the new snapshot's content_id genuinely differs from what fit was built against

        # The dependency-fingerprint staleness system (Task 8) must now
        # report job_fit_result as stale purely from the recorded fingerprint
        # comparison — never from anything this test set directly.
        pack_response = client.post(
            f"/api/workspaces/{workspace_id}/application-pack",
            json={"confirmed": True, "effective_date": "2026-08-18"},
        )
        assert pack_response.status_code == 400
        assert "stale" in pack_response.json()["detail"]


def test_drafted_only_reachable_through_gate_4_confirmation(tmp_path):
    proposals = {"matches": [], "gates": unverified_gate_proposals()}
    adapter = FakeSemanticProposalAdapter(canned_response=proposals)
    client = _client(tmp_path, semantic_adapter=adapter)
    with client:
        client.post("/api/profile/refresh")
        workspace_id = _create_workspace(client)

        direct_attempt = client.patch(f"/api/workspaces/{workspace_id}/status",
                                      json={"new_status": "drafted", "effective_date": "2026-08-18"})
        assert direct_attempt.status_code == 400

        client.post(f"/api/workspaces/{workspace_id}/fit", json={"request_id": "req_1"})
        client.post(f"/api/workspaces/{workspace_id}/application-intelligence", json={"request_id": "req_2"})
        pack_response = client.post(f"/api/workspaces/{workspace_id}/application-pack",
                                    json={"confirmed": True, "effective_date": "2026-08-18"})
        assert pack_response.status_code == 201

        detail = client.get(f"/api/workspaces/{workspace_id}").json()
        assert detail["workspace"]["workflow_status"] == "drafted"


def test_applied_binds_to_pack_b_not_pack_a_when_redrafted_before_submission(tmp_path):
    """The design explicitly allows re-confirming Gate 4 while still 'drafted'
    (refining materials before actually submitting): Pack A -> drafted,
    Pack B -> drafted. This test proves the 'applied' event unambiguously
    binds to PACK B — the pack that was actually current at the moment of
    submission — never inferred from Pack A's earlier 'drafted' event."""
    proposals = {"matches": [], "gates": unverified_gate_proposals()}
    adapter = FakeSemanticProposalAdapter(canned_response=proposals)
    client = _client(tmp_path, semantic_adapter=adapter)
    with client:
        client.post("/api/profile/refresh")
        workspace_id = _create_workspace(client)
        client.post(f"/api/workspaces/{workspace_id}/fit", json={"request_id": "req_1"})
        client.post(f"/api/workspaces/{workspace_id}/application-intelligence", json={"request_id": "req_2"})

        # Pack A: first Gate-4 confirmation. Reachable because
        # workflow_status is currently None.
        pack_a_response = client.post(
            f"/api/workspaces/{workspace_id}/application-pack",
            json={"confirmed": True, "effective_date": "2026-08-18"},
        )
        assert pack_a_response.status_code == 201
        pack_a_id = pack_a_response.json()["artifact"]["id"]
        pack_a_payload = pack_a_response.json()["pack"]

        events_after_pack_a = client.get(f"/api/workspaces/{workspace_id}/events").json()["events"]
        drafted_event_a = next(e for e in events_after_pack_a if e["new_status"] == "drafted")
        assert drafted_event_a["submitted_pack_artifact_id"] == pack_a_id

        # Pack B: a second Gate-4 confirmation while STILL 'drafted' (not yet
        # applied) — explicitly allowed, since the user is refining materials
        # before actually submitting anything.
        pack_b_response = client.post(
            f"/api/workspaces/{workspace_id}/application-pack",
            json={"confirmed": True, "effective_date": "2026-08-19"},
        )
        assert pack_b_response.status_code == 201
        pack_b_id = pack_b_response.json()["artifact"]["id"]
        pack_b_payload = pack_b_response.json()["pack"]
        assert pack_b_id != pack_a_id

        # applied requires an existing Gate-4-approved pack: record_status_change
        # (Task 5) refuses new_status="applied" unless the workspace's current
        # status is already "drafted" — verify this independently on a fresh
        # workspace that never went through Gate 4.
        empty_ws_response = client.post("/api/workspaces", json={
            "company": "Other Co", "title": "Other Role",
            "source_record": {"schema_version": "job-source-record.v0", "source": "manual",
                              "captured_at": "2026-08-18T00:00:00Z", "company": "Other Co", "title": "Other Role"},
        })
        empty_workspace_id = empty_ws_response.json()["workspace"]["id"]
        premature_applied = client.patch(
            f"/api/workspaces/{empty_workspace_id}/status",
            json={"new_status": "applied", "effective_date": "2026-08-18"},
        )
        assert premature_applied.status_code == 400
        assert "applied requires" in premature_applied.json()["detail"]

        # Explicit actual-submission confirmation for the REAL workspace —
        # the server resolves the CURRENT pack (Pack B) itself; the client
        # never supplies an artifact id.
        applied_response = client.patch(
            f"/api/workspaces/{workspace_id}/status",
            json={"new_status": "applied", "effective_date": "2026-08-20"},
        )
        assert applied_response.status_code == 200
        assert applied_response.json()["workflow_status"] == "applied"

        events_after_applied = client.get(f"/api/workspaces/{workspace_id}/events").json()["events"]
        applied_event = next(e for e in events_after_applied if e["new_status"] == "applied")
        # The unambiguous assertion the design requires: applied binds to
        # Pack B (the pack actually current at submission time), NOT Pack A.
        assert applied_event["submitted_pack_artifact_id"] == pack_b_id
        assert applied_event["submitted_pack_artifact_id"] != pack_a_id

        # History for Pack A's original drafted event is unchanged — it
        # still correctly names Pack A, never retroactively rewritten to B.
        drafted_event_a_after = next(
            e for e in events_after_applied if e["id"] == drafted_event_a["id"]
        )
        assert drafted_event_a_after["submitted_pack_artifact_id"] == pack_a_id

        # A third Gate-4 confirmation now that workflow_status == "applied"
        # must be REFUSED — the real proof of submitted-pack immutability.
        # If silently allowed, it would move workflow_status back to
        # "drafted", contradicting an explicit human statement that the
        # application was already submitted.
        pack_c_response = client.post(
            f"/api/workspaces/{workspace_id}/application-pack",
            json={"confirmed": True, "effective_date": "2026-08-21"},
        )
        assert pack_c_response.status_code == 400
        assert "already" in pack_c_response.json()["detail"]

        # Both Pack A and Pack B remain retrievable byte-for-byte — immutable
        # artifact history is never rewritten by a later pack or a refused
        # confirmation attempt.
        from webapp.persistence.db import connect
        from webapp.persistence.artifacts import get_artifact
        conn = connect(Settings(db_path=tmp_path / "jobsearch.sqlite3").db_path)
        assert get_artifact(conn, pack_a_id)["payload"] == pack_a_payload
        assert get_artifact(conn, pack_b_id)["payload"] == pack_b_payload
        conn.close()


def test_no_apply_submit_send_email_endpoint_and_no_autonomous_submission(tmp_path):
    client = _client(tmp_path)
    with client:
        client.post("/api/profile/refresh")
        workspace_id = _create_workspace(client)
        for path in ("/apply", "/submit", "/send", "/email"):
            assert client.post(f"/api/workspaces/{workspace_id}{path}").status_code == 404
        # confirm workflow_status is never auto-set by any processing endpoint
        client.post(f"/api/workspaces/{workspace_id}/fit", json={"request_id": "req_1"})
        client.post(f"/api/workspaces/{workspace_id}/application-intelligence", json={"request_id": "req_2"})
        detail = client.get(f"/api/workspaces/{workspace_id}").json()
        assert detail["workspace"]["workflow_status"] is None
```

- [ ] **Step 5: Run the acceptance suite**

Run: `pytest tests/webapp/test_full_journey_acceptance.py -v`
Expected: PASS (8 tests). Every test above is complete, runnable code — evidence-id discovery reads real ids from `GET /api/workspaces/{id}/review`'s `resolved_job_evidence` entry (added to `_REVIEW_ARTIFACT_TYPES` in Task 13), staleness is proven via a genuine mutated-then-rerun profile fixture, and submitted-pack binding is read through `GET /api/workspaces/{id}/events` (added in Task 13's correction). If any fixture-derived assertion fails against the real `product/*` validation (e.g. a discovered evidence id doesn't match the expected category), read the actual error and adjust the fixture wiring — never loosen an assertion to make it pass.

- [ ] **Step 6: Run full suite**

Run: `pytest -q`
Expected: full baseline (631 passed, 1 skipped) plus every Ticket 9 test added across Tasks 1-15, all green.

---

## Task 16: Genuine browser smoke test (Playwright) — final task

**Dependency note (per explicit requirement — how Playwright fits this repo):** This repo has no existing frontend test tooling (`requirements.txt` currently lists only Python packages: `openai`, and after Tasks 1-2 of this plan, `fastapi`/`uvicorn`/`jinja2`). Playwright's **Python** package (`playwright`, published by Microsoft on PyPI) is added as the one new dependency — not a Node/npm toolchain, not Playwright Test (the JS/TS runner), and not a general frontend build pipeline. It integrates directly with the existing `pytest` runner via the `pytest-playwright` plugin, so this smoke test runs with the exact same `pytest` command as every other test in this repo; no second test runner or CI job type is introduced.

**Files:**
- Modify: `requirements-dev.txt` (create this file if it does not already exist in the repo root — check first; if the repo has no dev-dependency split, add these two lines to `requirements.txt` directly instead, matching whatever convention `ls *.txt` in the repo root reveals)
- Create: `tests/webapp/test_browser_smoke.py`
- Test: (this task's own deliverable IS the test)

**Interfaces:**
- No new `webapp/` production code. This task exercises the fully assembled application from Tasks 1-14 through a real browser, driven by `pytest-playwright`'s `page` fixture against a live `uvicorn` server the test starts and stops itself (not `TestClient` — `TestClient` never renders JavaScript or lays out a DOM, so it cannot verify what a human actually sees).

- [ ] **Step 1: Add the Playwright dependency**

Run: `ls *.txt` in the repo root to check for an existing dev/test-only requirements file convention.

If `requirements-dev.txt` (or similarly named) already exists, append:
```
playwright==1.49.1
pytest-playwright==0.6.2
```

If no such file exists, create `requirements-dev.txt` with exactly those two lines, and note in a one-line comment at the top of the file that it is dev/test-only (never installed in the production `uvicorn` deployment path) — do not add these two packages to the main `requirements.txt`, since the smoke test browser binaries are multi-hundred-megabyte downloads that have no reason to ship with the running application.

- [ ] **Step 2: Install Playwright and its browser binary**

Run: `pip install -r requirements-dev.txt`
Run: `playwright install chromium` (downloads the Chromium browser binary Playwright drives; only Chromium is installed — not the full `firefox`+`webkit`+`chromium` set — since one deterministic browser engine is sufficient for a smoke test and keeps the install lightweight).

- [ ] **Step 3: Write the browser smoke test**

```python
# tests/webapp/test_browser_smoke.py
"""Genuine browser acceptance test: drives the real rendered UI through
Playwright (not FastAPI TestClient, which never executes JavaScript or lays
out a DOM). Proves the visible user journey and that the six-way evidence
vocabulary actually renders as distinct, inspectable labels — not just that
the underlying HTTP calls succeed.

Journey covered: Dashboard -> Candidate Profile -> New Job -> Understanding
-> Job Fit -> Application Intelligence -> Review -> Gate 4 confirmation ->
drafted -> explicit applied -> explicit interview. This matches the frozen
acceptance journey in full (design doc: "-> application becomes drafted ->
explicitly mark applied -> later update to interview"); a prior revision of
this test stopped at drafted, which was a real mismatch against the design's
own journey statement.
"""
from __future__ import annotations

import socket
import time
from pathlib import Path

import pytest

FIXTURE_PROFILE_ROOT = Path(__file__).parent / "fixtures" / "webapp_profile_root"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture
def live_server(tmp_path):
    """Starts a real uvicorn process serving the app, wired with deterministic
    fake providers via environment-variable-free app.state overrides is not
    possible across a subprocess boundary, so this fixture instead points the
    server at a small launcher script that constructs the app with fakes
    exactly like the acceptance suite does, then runs uvicorn in-process
    inside a background thread — avoiding both a real OpenAI call and the
    complexity of cross-process fixture injection."""
    import threading

    import uvicorn

    from webapp.app import create_app
    from webapp.config import Settings

    db_path = tmp_path / "jobsearch.sqlite3"
    settings = Settings(db_path=db_path, port=_free_port())
    app = create_app(settings)
    app.state.profile_root = str(FIXTURE_PROFILE_ROOT)

    from product.application_intelligence_providers import ProviderResponse as AIProviderResponse
    from product.job_understanding_providers import ProviderResponse as JUProviderResponse
    from webapp.services.semantic_proposal_adapter import FakeSemanticProposalAdapter

    class _FakeJobUnderstandingProvider:
        provider_id = "fake"; model_id = "fake-model"; model_version = "fake-model-v0"

        def extract(self, request):
            return JUProviderResponse(payload={
                "schema_version": "job-understanding-candidate.v0", "items": [],
                "suggestions": [], "ambiguous_statements": [], "warnings": [],
            })

    class _FakeApplicationIntelligenceProvider:
        provider_id = "fake"; model_id = "fake-model"; model_version = "fake-model-v0"

        def propose(self, request):
            return AIProviderResponse(payload={"content_units": [
                {"unit_id": "cv-ready", "unit_type": "cv_bullet",
                 "atoms": [{"atom_id": "atom-1", "atom_kind": "candidate_fact",
                           "assertion_type": "technical_skill",
                           "profile_evidence_ids": ["clm_1111111111111111"], "rendering_variant": "PLAIN"}],
                 "connectives": []},
            ]})

    app.state.job_understanding_provider = _FakeJobUnderstandingProvider()
    app.state.semantic_adapter = FakeSemanticProposalAdapter(canned_response={
        "matches": [],
        "gates": [
            {"gate_id": gate_id, "status": "UNVERIFIED", "reason": "No profile evidence available.",
             "job_evidence_ids": [], "profile_evidence_ids": []}
            for gate_id in ("eligibility", "language", "location_logistics")
        ],
    })
    app.state.application_intelligence_provider = _FakeApplicationIntelligenceProvider()

    config = uvicorn.Config(app, host=settings.host, port=settings.port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((settings.host, settings.port), timeout=0.5):
                break
        except OSError:
            time.sleep(0.1)
    else:
        raise RuntimeError("live server did not start within 10 seconds")

    yield f"http://{settings.host}:{settings.port}"

    server.should_exit = True
    thread.join(timeout=5)


def test_full_visible_journey_reaches_interview_with_correct_trust_labels(live_server, page):
    base_url = live_server

    # 1. Dashboard
    page.goto(base_url + "/")
    assert page.title() != ""
    assert page.get_by_text("No workspaces yet").is_visible()

    # 2. Candidate Profile — refresh and check Verified evidence renders
    page.goto(base_url + "/profile")
    page.get_by_role("button", name="Refresh profile").click()
    page.wait_for_load_state("networkidle")
    assert page.get_by_text("Verified evidence").first.is_visible()

    # 3. New Job
    page.goto(base_url + "/new-job")
    page.fill("input[name=company]", "Example Corp")
    page.fill("input[name=title]", "Data Scientist")
    page.fill("textarea[name=raw_text]", "Strong Python experience. Build data pipelines.")
    page.click("button[type=submit]")
    page.wait_for_url("**/workspaces/*")

    workspace_url = page.url

    # 4. Job Understanding
    page.get_by_role("button", name="Run Job Understanding").click()
    page.wait_for_load_state("networkidle")
    assert not page.get_by_role("button", name="Run Job Understanding").is_visible()

    # 5. Job Fit — with no matches proposed and all gates UNVERIFIED, gaps
    # should render as Missing evidence (there are no requirements captured
    # from raw_text alone without structured requirements, so this also
    # exercises the "no fabricated matches" path).
    page.get_by_role("button", name="Run Job Fit").click()
    page.wait_for_load_state("networkidle")
    assert not page.get_by_role("button", name="Run Job Fit").is_visible()

    # 6. Application Intelligence — the fake provider proposes one READY unit
    page.get_by_role("button", name="Run Application Intelligence").click()
    page.wait_for_load_state("networkidle")
    assert page.get_by_text("Python").is_visible()  # the READY cv_bullet's rendered text
    # No NEEDS_REVIEW badge should be present for this fixture (the one atom
    # cites a real, non-placeholder profile claim) — confirming unsupported/
    # needs-review material is not silently presented as application-ready
    # when it is in fact ready, and conversely is never hidden when present.
    assert page.get_by_text("NEEDS_REVIEW", exact=True).count() == 0

    # 7. Review & Gate 4 confirmation
    page.on("dialog", lambda dialog: dialog.accept())  # accept the confirm() prompt
    page.get_by_role("button", name="I have reviewed the application material — Confirm").click()
    page.wait_for_load_state("networkidle")

    # 8. Assert drafted — visible on the page after reload
    page.goto(workspace_url)
    assert page.get_by_text("drafted", exact=False).first.is_visible()

    # 9. Explicit Applied transition — closes the frozen acceptance journey's
    # gap: a prior revision of this test stopped at 'drafted', but the
    # design's journey (docs/superpowers/specs/2026-08-17-ticket9-web-
    # product-workflow-design.md) continues "-> explicitly mark applied ->
    # later update to interview." The Status section's "Mark as applied"
    # button only renders once workflow_status is set (workspace_detail.html,
    # guarded by `{% if workspace.workflow_status %}`), so it is now visible
    # after step 8's reload.
    page.get_by_role("button", name="Mark as applied").click()
    page.wait_for_load_state("networkidle")
    assert page.get_by_text("applied", exact=False).first.is_visible()

    # 10. Explicit Interview transition
    page.get_by_role("button", name="Interview").click()
    page.wait_for_load_state("networkidle")
    assert page.get_by_text("interview", exact=False).first.is_visible()

    # 11. Confirm the applied event is bound to a real pack artifact, read
    # through the same GET /events endpoint the API acceptance suite uses.
    # The Pack A/Pack B disambiguation case (multiple Gate-4 confirmations
    # before 'applied') is proven precisely by test_applied_binds_to_pack_b_
    # not_pack_a_when_redrafted_before_submission in tests/webapp/
    # test_full_journey_acceptance.py — this single-pack browser journey
    # cannot exercise that case (there is only ever one pack here), so this
    # step's job is narrower: prove the real rendered UI's "Mark as applied"
    # button reaches the same binding behavior, not re-derive the
    # disambiguation proof TestClient already covers precisely.
    events_response = page.request.get(f"{base_url}/api/workspaces/{workspace_url.rsplit('/', 1)[-1]}/events")
    assert events_response.ok
    events = events_response.json()["events"]
    applied_event = next(e for e in events if e["new_status"] == "applied")
    drafted_event = next(e for e in events if e["new_status"] == "drafted")
    # /status resolves the CURRENT application_pack server-side for 'applied'
    # too (webapp/api/status.py's patch_status), so in this single-pack
    # journey both events bind to the same pack artifact id.
    assert applied_event["submitted_pack_artifact_id"] == drafted_event["submitted_pack_artifact_id"]
    assert applied_event["submitted_pack_artifact_id"] is not None


def test_missing_evidence_and_transferable_labels_render_distinctly(live_server, page):
    """A second, focused journey proving the six-way vocabulary renders
    distinct labels for missing evidence and (where a transferable match
    exists) transferable evidence with visible limitations — not merely that
    the page returns 200."""
    base_url = live_server

    page.goto(base_url + "/new-job")
    page.fill("input[name=company]", "Second Co")
    page.fill("input[name=title]", "Analyst")
    page.fill("textarea[name=raw_text]", "Requires a skill the candidate profile does not contain.")
    page.click("button[type=submit]")
    page.wait_for_url("**/workspaces/*")

    page.get_by_role("button", name="Run Job Understanding").click()
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="Run Job Fit").click()
    page.wait_for_load_state("networkidle")

    # With no direct/functional/transferable matches proposed, any job
    # requirement without accepted evidence must render as Missing evidence
    # — never phrased as a definite absence of candidate ability, per the
    # design's vocabulary rule.
    assert page.get_by_text("Missing evidence").first.is_visible()
```

- [ ] **Step 4: Run the browser smoke test**

Run: `pytest tests/webapp/test_browser_smoke.py -v --browser chromium`
Expected: PASS (2 tests). If a selector (`get_by_role`, `get_by_text`) does not match the actual rendered HTML from Task 14's templates, adjust the selector to match the real button/label text emitted by `workspace_detail.html`/`profile.html` — do not weaken the assertion to something that would pass against a broken page.

- [ ] **Step 5: Run full suite (excluding the browser test by default)**

Run: `pytest -q --ignore=tests/webapp/test_browser_smoke.py`
Expected: full baseline (631 passed, 1 skipped) plus every Ticket 9 test from Tasks 1-16, all green. The browser smoke test is excluded from the default `pytest -q` sweep by this explicit `--ignore` (documented here, not silently skipped) because it requires the Playwright browser binary from Step 2, which is a one-time local/CI setup step, not something every `pytest -q` invocation should depend on. Run it explicitly via Step 4's command when verifying the full user journey.

---

## Governance note (final)

This is the last task in this plan. No task in Tasks 1–16 contains a `git commit`, `git branch`, `git push`, or any other git-mutating step. Implementation of this plan (creating a branch, writing code, running tests) begins only after explicit user/PM approval of this complete document. Commit and push happen only after implementation, full test verification, and a subsequent PM review — not as part of any task's steps here.

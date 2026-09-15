"""resolved_blocker_answers.v1 bundle construction (Phase 4C spec §4).

Pure payload construction -- no persistence here. The caller
(webapp/services/pipeline.py's run_job_fit) is responsible for saving the
returned payload via webapp.persistence.artifacts.save_artifact with a
content-addressed content_id computed by
webapp.services.input_identity.content_identity("blockeranswers_", payload).

Implements spec §5's 2-tier precedence per subject (amended: CANDIDATE_FACT
is not a third cross-application tier -- see spec §5 point 3 / §17):
  1. This exact workspace's own most recent effective answer to this
     exact subject_key, REGARDLESS of answer_scope -- APPLICATION_ONLY,
     SEARCH_WORKSPACE, and CANDIDATE_FACT are all resolved identically
     here, since answer_scope governs how far an answer may travel
     BEYOND its originating application, never whether the originating
     application may use its own answer. Only the resolution's own
     answer_scope value is carried into matched_scope_source for audit
     purposes; it plays no role in whether tier 1 matches.
  2. SEARCH_WORKSPACE only -- via
     webapp.services.decision_policy.find_semantic_subject_match, keyed on
     semantic_subject_key, never subject_key (spec §5). A CANDIDATE_FACT
     resolution belonging to a DIFFERENT workspace is never found by
     this tier or by any other lookup in Phase 4C -- see
     find_semantic_subject_match's own docstring for why.

One effective answer per subject; precedence stops at the first tier that
produces a match. No volatile timestamp anywhere in the payload -- see
spec §4's determinism requirement, verified by
tests/webapp/services/test_resolved_blocker_answers.py's content-identity
tests.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from webapp.persistence.application_blockers import get_effective_resolution, list_application_blockers

RESOLVED_BLOCKER_ANSWERS_SCHEMA_VERSION = "resolved_blocker_answers.v1"


def _bundle_entry(
    *, resolution: dict[str, Any], blocker: dict[str, Any], matched_scope_source: str,
) -> dict[str, Any]:
    return {
        "resolution_id": resolution["id"],
        "subject_key": blocker["subject_key"],
        "semantic_subject_key": blocker["semantic_subject_key"],
        "blocker_type": blocker["blocker_type"],
        "answer_scope": resolution["answer_scope"],
        "value": resolution["answer_value"],
        "resolved_by": resolution["resolved_by"],
        "matched_scope_source": matched_scope_source,
        # The workspace that actually owns the underlying blocker_resolutions
        # row -- NOT redundant with matched_scope_source. matched_scope_source
        # echoes the resolution's own answer_scope at tier 1 (spec §5 point
        # 3's correction folds APPLICATION_ONLY, SEARCH_WORKSPACE, and
        # CANDIDATE_FACT all into tier 1 for this workspace's own answer), so
        # a tier-1 entry can legitimately carry matched_scope_source ==
        # "SEARCH_WORKSPACE" while still being this workspace's own answer --
        # matched_scope_source alone cannot distinguish "own workspace, user
        # happened to choose SEARCH_WORKSPACE scope" from "genuine sibling via
        # tier 2's cross-application lookup." source_workspace_id is the
        # unambiguous signal consumers (validate_resolved_answer_citation)
        # need for that distinction: compare it against the bundle's own
        # top-level workspace_id.
        "source_workspace_id": resolution["workspace_id"],
    }


def build_resolved_blocker_answers_payload(
    conn: sqlite3.Connection, workspace_id: str,
) -> dict[str, Any]:
    from webapp.services.decision_policy import find_semantic_subject_match

    all_blockers = list_application_blockers(conn, workspace_id)
    entries: list[dict[str, Any]] = []
    seen_subject_keys: set[str] = set()

    for blocker in all_blockers:
        subject_key = blocker["subject_key"]
        if subject_key in seen_subject_keys:
            continue
        seen_subject_keys.add(subject_key)

        # Tier 1: this workspace's own effective answer for this exact
        # blocker instance, regardless of answer_scope. answer_scope
        # controls how far an answer may travel BEYOND its originating
        # application -- it must never prevent the originating application
        # from using its own answer. same_subject_blockers/newest_blocker
        # are already derived from all_blockers = list_application_blockers
        # (conn, workspace_id), i.e. already scoped to THIS workspace, so
        # "resolution is not None" alone is the correct and sufficient
        # condition here: tier 1 is ALREADY exclusively "this workspace's
        # own answer," regardless of which of the three scope values it
        # carries. (Fix, corrective commit: the prior version gratuitously
        # excluded SEARCH_WORKSPACE-scoped answers from tier 1, which sent
        # a workspace's own SEARCH_WORKSPACE-scoped answer to tier 2's
        # cross-application lookup instead -- see
        # find_semantic_subject_match's own workspace-exclusion fix for
        # the other half of this correction.) There may be several blocker
        # rows historically sharing a subject_key across reruns -- take
        # the newest blocker for this subject_key first.
        same_subject_blockers = [b for b in all_blockers if b["subject_key"] == subject_key]
        newest_blocker = max(same_subject_blockers, key=lambda b: b["created_at"])
        resolution = get_effective_resolution(conn, newest_blocker["id"])
        if resolution is not None:
            entries.append(
                _bundle_entry(
                    resolution=resolution, blocker=newest_blocker,
                    matched_scope_source=resolution["answer_scope"],
                )
            )
            continue

        # Tier 2: SEARCH_WORKSPACE-only cross-application reuse, keyed on
        # semantic_subject_key. Never reaches a CANDIDATE_FACT resolution
        # belonging to a different workspace -- find_semantic_subject_match
        # performs no such lookup (spec §5 point 3 / §17).
        semantic_subject_key = newest_blocker["semantic_subject_key"]
        match = find_semantic_subject_match(
            conn, workspace_id=workspace_id, semantic_subject_key=semantic_subject_key,
        )
        if match is not None:
            entries.append(
                _bundle_entry(
                    resolution=match, blocker=newest_blocker,
                    matched_scope_source=match["matched_scope_source"],
                )
            )

    entries.sort(key=lambda entry: (entry["subject_key"], entry["resolution_id"]))
    return {
        "schema_version": RESOLVED_BLOCKER_ANSWERS_SCHEMA_VERSION,
        "workspace_id": workspace_id,
        "answers": entries,
    }

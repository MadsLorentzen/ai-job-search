#!/usr/bin/env python3
"""Application Decision Policy v0.

Pure domain classifier over Job Fit v1 results (product/semantic_job_fit.py
output). Decides, for each gate assessment and each required dimension
assessment (surfaced as a human_judgment_question when not READY), whether
the workflow can proceed automatically, must omit the item, must reject the
application outright, or must ask the candidate.

This module performs no I/O, no persistence, and no webapp orchestration. It
does not recompute gate status, dimension coverage, or match evidence —
those judgments already exist in the Job Fit v1 result produced by
product/semantic_job_fit.py and are trusted as given. This module's only
job is mapping an already-adjudicated assessment to one of six automation
outcomes, plus a machine-stable reason code and a human-readable reason.

Outcome semantics:
    AUTO_PROCEED             -- directly usable as-is.
    AUTO_PROCEED_WITH_GAPS   -- partially supported; unmatched job
                                 requirement/responsibility IDs are recorded
                                 and must not be claimed as supported
                                 downstream.
    AUTO_OMIT                -- no supporting evidence, and the gap is
                                 genuinely non-material to this posting;
                                 safe to exclude.
    AUTO_REJECT              -- gate FAIL with trustworthy, supported
                                 disqualifying evidence. Maps to the
                                 workflow-level DECLINED_BY_POLICY state
                                 (a distinct name from workflow_status
                                 "rejected", which records an employer's
                                 real-world post-submission outcome and is
                                 never touched by this module).
    REQUIRE_USER              -- material, ambiguous, or candidate-only;
                                 policy cannot safely resolve it.
    NOT_APPLICABLE             -- no evaluable job-side signal exists for
                                 this dimension/gate on this posting (for
                                 example behavioral_fit/career_alignment
                                 dimensions with no job_categories wired in
                                 the semantic fit policy, or a gate whose
                                 category has zero job-evidence items on
                                 this specific posting). Distinct from
                                 AUTO_PROCEED: there is nothing here to
                                 affirm, so recording a positive judgment
                                 would misrepresent an absence of signal.

Gate classification (Phase 2): product/semantic_job_fit.py's
_build_gate_assessments now exposes two explicit fields this module
consumes directly, rather than inferring support from evidence-id
presence alone (a Phase-1 limitation, since resolved here):

    evidence_disposition -- SUPPORTIVE | CONFLICTING | ABSENT | INSUFFICIENT
        Whether profile_evidence_ids on this assessment was actually
        validated as supporting (or disqualifying) the gate's proposal
        outcome, or merely present without ever being vetted toward one.

    materiality -- MATERIAL | NON_MATERIAL | NOT_APPLICABLE
        Derived per assessment from whether THIS posting's own resolved
        job evidence contains an item in the gate's evidence category --
        never a static default keyed only on gate type (a posting can
        make "language" material just as easily as "eligibility").
        NON_MATERIAL is defined in the enum but is not currently produced
        by semantic_job_fit.py: there is no signal today distinguishing
        "this posting states a requirement in this category but marks it
        optional" from "this posting states nothing in this category at
        all" (the latter is NOT_APPLICABLE). A future extraction-layer
        change could add that distinction; until then NON_MATERIAL is
        reachable only via a caller-supplied policy override, never from
        semantic_job_fit.py's own output.

Classification table:
    gate status FAIL,      evidence_disposition=CONFLICTING      -> REQUIRE_USER (checked FIRST)
    gate status FAIL,      evidence_disposition != CONFLICTING   -> AUTO_REJECT (trusted pre-supported, see below)
    gate status FLAG      (any materiality/disposition)          -> REQUIRE_USER
    materiality=MATERIAL,     evidence_disposition=SUPPORTIVE    -> AUTO_PROCEED
    materiality=MATERIAL,     evidence_disposition=CONFLICTING   -> REQUIRE_USER
    materiality=MATERIAL,     evidence_disposition=ABSENT        -> REQUIRE_USER
    materiality=MATERIAL,     evidence_disposition=INSUFFICIENT  -> REQUIRE_USER
    materiality=NON_MATERIAL, evidence_disposition=ABSENT        -> AUTO_OMIT
    materiality=NON_MATERIAL, evidence_disposition=SUPPORTIVE    -> AUTO_PROCEED
    materiality=NON_MATERIAL, evidence_disposition=CONFLICTING   -> REQUIRE_USER
    materiality=NON_MATERIAL, evidence_disposition=INSUFFICIENT  -> REQUIRE_USER
    materiality=NOT_APPLICABLE (any disposition)                -> NOT_APPLICABLE

CONFLICTING always takes precedence over a literal FAIL status and is
always REQUIRE_USER regardless of materiality (ENGINE_VERSION v2). This
module still only ever consumes evidence_disposition/materiality exactly
as before -- CONFLICTING is not a new value, only its precedence over a
literal FAIL status is new. As of Phase 4C's semantic_job_fit.py fix
(same ENGINE_VERSION v2 change), evidence_disposition=CONFLICTING is
produced ONLY for a genuine cross-source disagreement the semantic
adapter itself explicitly asserted (cross_source_relation="CONFLICTING")
-- never merely because both a profile claim and a resolved blocker
answer happened to be cited together, and never inferred by this module
or by semantic_job_fit.py from citation-list shape alone. A gate FAIL
reaching this module with a non-CONFLICTING disposition is, by
construction, already trustworthy and supported: semantic_job_fit.py's
_build_gate_assessments downgrades an unsupported FAIL proposal to
UNVERIFIED before this module ever sees it (its own "FAIL requires
affirmative job and profile incompatibility evidence" rule). AUTO_REJECT
is therefore the outcome for a literal FAIL status whose disposition is
not CONFLICTING; there is no other ambiguous-FAIL case routed to
REQUIRE_USER here.

CONFLICTING evidence is never safe to silently omit, proceed past, or
auto-reject on, even for a non-material gate or a gate whose proposal
status is a literal FAIL -- an unresolved contradiction between two
independently trustworthy sources of the candidate's own evidence (for
example, supportive profile evidence and a validated resolved blocker
answer genuinely disagreeing about the same gate, Phase 4C spec Sec9) is
a data-quality problem worth a human's attention, never grounds for an
automatic rejection.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


MODULE_DIR = Path(__file__).parent
POLICY_PATH = MODULE_DIR / "application-decision-policy.v0.json"
DEFAULT_POLICY = json.loads(POLICY_PATH.read_text(encoding="utf-8"))

# Bump this whenever a behavior-changing edit is made to the classification
# logic in this module (evaluate_gate_assessment, evaluate_dimension_
# assessment, or any function they call). The policy fingerprint below
# covers both the JSON policy data AND this version, specifically so a
# Python logic change that alters classifier behavior without touching the
# JSON file cannot silently keep producing the same fingerprint as before
# the change -- the JSON-only fingerprint used in an earlier draft of this
# module could not detect that class of change.
ENGINE_VERSION = "application-decision-engine.v2"

OUTCOMES = (
    "AUTO_PROCEED",
    "AUTO_PROCEED_WITH_GAPS",
    "AUTO_OMIT",
    "AUTO_REJECT",
    "REQUIRE_USER",
    "NOT_APPLICABLE",
)

GATE_STATUSES = {"PASS", "FAIL", "FLAG", "UNVERIFIED", "NOT_APPLICABLE"}
DIMENSION_STATUSES = {"READY", "NEEDS_REVIEW"}


class ApplicationDecisionPolicyValidationError(ValueError):
    """Raised when the policy file itself is malformed."""

    def __init__(self, errors: str | list[str]):
        self.errors = [errors] if isinstance(errors, str) else list(errors)
        super().__init__("; ".join(self.errors))


class ApplicationDecisionPolicyInputError(ValueError):
    """Raised when a gate or dimension assessment passed to this module does
    not match the shape produced by product/semantic_job_fit.py."""


@dataclass(frozen=True)
class DecisionRecord:
    """One classification result. Field names deliberately mirror the
    persistence-layer contract from the design (policy_decisions table)
    so later wiring needs no translation layer."""

    review_item_type: str
    subject_key: str
    outcome: str
    reason_code: str
    reason: str
    job_evidence_ids: tuple[str, ...] = field(default_factory=tuple)
    profile_evidence_ids: tuple[str, ...] = field(default_factory=tuple)
    matched_job_requirement_ids: tuple[str, ...] = field(default_factory=tuple)
    unmatched_job_requirement_ids: tuple[str, ...] = field(default_factory=tuple)
    supporting_profile_evidence_ids: tuple[str, ...] = field(default_factory=tuple)

    def as_dict(self) -> dict[str, Any]:
        return {
            "review_item_type": self.review_item_type,
            "subject_key": self.subject_key,
            "outcome": self.outcome,
            "reason_code": self.reason_code,
            "reason": self.reason,
            "job_evidence_ids": list(self.job_evidence_ids),
            "profile_evidence_ids": list(self.profile_evidence_ids),
            "matched_job_requirement_ids": list(self.matched_job_requirement_ids),
            "unmatched_job_requirement_ids": list(self.unmatched_job_requirement_ids),
            "supporting_profile_evidence_ids": list(self.supporting_profile_evidence_ids),
        }


def load_application_decision_policy(path: str | Path | None = None) -> dict[str, Any]:
    """Load and validate the passive Application Decision Policy v0 JSON."""

    policy_path = POLICY_PATH if path is None else Path(path)
    try:
        policy = json.loads(policy_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ApplicationDecisionPolicyValidationError(
            f"$.application_decision_policy: {exc}"
        ) from exc
    validate_application_decision_policy(policy)
    return policy


def validate_application_decision_policy(policy: Any) -> None:
    errors: list[str] = []
    required = {
        "schema_version", "id", "description", "outcomes",
        "gate_rules", "dimension_rules", "reason_codes",
    }
    if not isinstance(policy, dict):
        raise ApplicationDecisionPolicyValidationError(
            "$.application_decision_policy: must be an object"
        )
    missing = required - policy.keys()
    extra = policy.keys() - required
    if missing:
        errors.append(f"$.application_decision_policy: missing fields {sorted(missing)}")
    if extra:
        errors.append(f"$.application_decision_policy: unexpected fields {sorted(extra)}")
    if errors:
        raise ApplicationDecisionPolicyValidationError(errors)
    if policy["schema_version"] != "application-decision-policy.v0":
        errors.append("$.application_decision_policy.schema_version: unsupported version")
    if set(policy.get("outcomes", [])) != set(OUTCOMES):
        errors.append("$.application_decision_policy.outcomes: must match the supported outcome set")
    if errors:
        raise ApplicationDecisionPolicyValidationError(errors)


def application_decision_policy_fingerprint(
    policy: dict[str, Any], *, engine_version: str = ENGINE_VERSION
) -> str:
    """Content-derived fingerprint covering both the JSON policy data and
    the classifier engine version, independent of the human-readable
    schema_version string alone. A JSON-only fingerprint cannot detect a
    behavior-changing edit to the Python classification logic in this
    module (evaluate_gate_assessment / evaluate_dimension_assessment) --
    two behaviorally different engines could otherwise silently share the
    same audit fingerprint if the JSON policy file happened not to change.
    Folding engine_version into the hash means any such change requires a
    deliberate ENGINE_VERSION bump to be reflected in the fingerprint.

    Mirrors the canonical-JSON sha256 pattern already used by
    semantic_fit_policy_content_id and profile_snapshot_content_id in
    product/semantic_job_fit.py, extended with the engine version."""

    validate_application_decision_policy(policy)
    canonical_policy = json.dumps(
        policy, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )
    combined = json.dumps(
        {"policy": canonical_policy, "engine_version": engine_version},
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    )
    digest = hashlib.sha256(combined.encode("utf-8")).hexdigest()[:20]
    return f"appdecpolicy_{digest}"


GATE_EVIDENCE_DISPOSITIONS = {"SUPPORTIVE", "CONFLICTING", "ABSENT", "INSUFFICIENT"}
GATE_MATERIALITY_VALUES = {"MATERIAL", "NON_MATERIAL", "NOT_APPLICABLE"}


def _require_gate_shape(gate: Any) -> None:
    if not isinstance(gate, dict):
        raise ApplicationDecisionPolicyInputError("gate assessment must be an object")
    required = {
        "gate_id", "status", "reason", "job_evidence_ids", "profile_evidence_ids",
        "evidence_disposition", "materiality",
    }
    missing = required - gate.keys()
    if missing:
        raise ApplicationDecisionPolicyInputError(
            f"gate assessment missing fields {sorted(missing)}"
        )
    if gate["status"] not in GATE_STATUSES:
        raise ApplicationDecisionPolicyInputError(
            f"gate assessment status {gate['status']!r} is not a known Job Fit gate status"
        )
    if gate["evidence_disposition"] not in GATE_EVIDENCE_DISPOSITIONS:
        raise ApplicationDecisionPolicyInputError(
            f"gate assessment evidence_disposition {gate['evidence_disposition']!r} "
            "is not a known disposition"
        )
    if gate["materiality"] not in GATE_MATERIALITY_VALUES:
        raise ApplicationDecisionPolicyInputError(
            f"gate assessment materiality {gate['materiality']!r} is not a known value"
        )


def evaluate_gate_assessment(
    gate: dict[str, Any], policy: dict[str, Any] | None = None
) -> DecisionRecord:
    """Classify one Job Fit gate_assessments[] record.

    `gate` is trusted to be exactly the shape semantic_job_fit.py's
    _build_gate_assessments produces (Phase 2 contract): gate_id, status,
    reason, job_evidence_ids, profile_evidence_ids, evidence_disposition,
    materiality. Classification is driven directly by evidence_disposition
    and materiality -- both already resolved upstream by semantic_job_fit.py
    from this specific posting's own job evidence and this specific
    candidate's own profile evidence. This module does not re-derive either
    value; it only maps the (materiality, evidence_disposition) pair (or the
    gate's own status, for FAIL/FLAG) to an outcome. See the module
    docstring's classification table for the full rule set.
    """

    _require_gate_shape(gate)
    active_policy = policy or DEFAULT_POLICY
    reason_codes = active_policy["reason_codes"]
    gate_rules = active_policy["gate_rules"]
    status = gate["status"]
    materiality = gate["materiality"]
    disposition = gate["evidence_disposition"]

    if status == "FAIL" and disposition == "CONFLICTING":
        # CONFLICTING takes precedence over the ordinary supported-FAIL
        # AUTO_REJECT rule below (ENGINE_VERSION v2 fix). Since Phase 4C's
        # semantic_job_fit.py fix, evidence_disposition=CONFLICTING is
        # produced ONLY for a genuine cross-source disagreement -- the
        # semantic adapter's own explicit cross_source_relation="CONFLICTING"
        # judgment about cited profile evidence and a cited resolved
        # blocker answer pointing in opposite directions (Phase 4C spec
        # Sec9's table). This module trusts evidence_disposition exactly as
        # it always has, unchanged -- CONFLICTING is not a new value here,
        # only its correct precedence over a literal FAIL status is new: a
        # data-quality contradiction in the candidate's own evidence must
        # never be silently auto-rejected. Routed through the SAME
        # materiality/disposition rule table as every other disposition
        # (material_conflicting/non_material_conflicting, both
        # REQUIRE_USER in the policy JSON) rather than a bespoke branch, so
        # there is exactly one place that maps
        # (materiality, disposition) -> outcome.
        materiality_key = "material" if materiality == "MATERIAL" else "non_material"
        rule_key = f"{materiality_key}_conflicting"
        outcome, reason_code = gate_rules[rule_key], f"gate_{rule_key}"
    elif status == "FAIL":
        # semantic_job_fit.py's _build_gate_assessments already downgrades
        # an unsupported FAIL proposal to UNVERIFIED before this module
        # ever sees it (see its "FAIL requires affirmative job and profile
        # incompatibility evidence" rule). A literal FAIL status reaching
        # this module with a non-CONFLICTING disposition is therefore, by
        # construction, already trustworthy and evidence-supported --
        # AUTO_REJECT is the outcome for this branch; the one ambiguous
        # case (a genuine cross-source disagreement) is handled by the
        # branch above, before this one is ever reached.
        outcome, reason_code = gate_rules["FAIL"], "gate_fail_supported"
    elif status == "FLAG":
        outcome, reason_code = gate_rules["FLAG"], "gate_flag"
    elif materiality == "NOT_APPLICABLE":
        outcome = gate_rules["materiality_not_applicable"]
        reason_code = "gate_not_applicable"
    else:
        materiality_key = "material" if materiality == "MATERIAL" else "non_material"
        disposition_key = disposition.lower()
        rule_key = f"{materiality_key}_{disposition_key}"
        outcome = gate_rules[rule_key]
        reason_code = f"gate_{rule_key}"

    return DecisionRecord(
        review_item_type="gate_flag",
        subject_key=f"gate:{gate['gate_id']}",
        outcome=outcome,
        reason_code=reason_code,
        reason=reason_codes[reason_code],
        job_evidence_ids=tuple(gate["job_evidence_ids"]),
        profile_evidence_ids=tuple(gate["profile_evidence_ids"]),
    )


def _require_dimension_shape(dimension: Any) -> None:
    if not isinstance(dimension, dict):
        raise ApplicationDecisionPolicyInputError("dimension assessment must be an object")
    required = {"dimension_id", "status", "required", "job_evidence_ids"}
    missing = required - dimension.keys()
    if missing:
        raise ApplicationDecisionPolicyInputError(
            f"dimension assessment missing fields {sorted(missing)}"
        )
    if dimension["status"] not in DIMENSION_STATUSES:
        raise ApplicationDecisionPolicyInputError(
            f"dimension assessment status {dimension['status']!r} is not a known "
            "Job Fit dimension status"
        )


def evaluate_dimension_assessment(
    dimension: dict[str, Any],
    *,
    relevant_job_ids: list[str],
    matched_job_ids: list[str],
    supporting_profile_evidence_ids: list[str] | None = None,
    policy: dict[str, Any] | None = None,
) -> DecisionRecord:
    """Classify one Job Fit dimension_assessments[] record (surfaced today
    as a human_judgment_question when not READY).

    `dimension` is trusted to be exactly the shape semantic_job_fit.py's
    _build_dimension_assessments produces. `relevant_job_ids` and
    `matched_job_ids` are the same two lists that function already computes
    internally (relevant_job_ids from job_categories/material_kinds
    coverage, matched_job_ids as the subset with a positive match) but does
    not currently retain on the output record -- callers pass them through
    explicitly until semantic_job_fit.py is extended (design phase 2) to
    carry unmatched_job_requirement_ids itself.

    matched_job_requirement_ids, unmatched_job_requirement_ids, and
    supporting_profile_evidence_ids are three distinct identifier
    namespaces (job requirement/responsibility IDs vs. profile claim IDs)
    and are never compared against one another.
    """

    _require_dimension_shape(dimension)
    active_policy = policy or DEFAULT_POLICY
    reason_codes = active_policy["reason_codes"]
    dimension_rules = active_policy["dimension_rules"]

    matched = tuple(dict.fromkeys(matched_job_ids))
    relevant = tuple(dict.fromkeys(relevant_job_ids))
    unmatched = tuple(job_id for job_id in relevant if job_id not in set(matched))
    supporting = tuple(supporting_profile_evidence_ids or ())

    if dimension["status"] == "READY":
        outcome = dimension_rules["READY"]
        reason_code = "dimension_ready"
    elif not relevant:
        outcome = dimension_rules["NEEDS_REVIEW_NO_RELEVANT_JOB_IDS"]
        reason_code = "dimension_no_relevant_job_ids"
    elif matched:
        outcome = dimension_rules["NEEDS_REVIEW_PARTIAL_COVERAGE"]
        reason_code = "dimension_partial_coverage"
    else:
        outcome = dimension_rules["NEEDS_REVIEW_ZERO_COVERAGE"]
        reason_code = "dimension_zero_coverage"

    return DecisionRecord(
        review_item_type="human_judgment_question",
        subject_key=f"dimension:{dimension['dimension_id']}",
        outcome=outcome,
        reason_code=reason_code,
        reason=reason_codes[reason_code],
        matched_job_requirement_ids=matched,
        unmatched_job_requirement_ids=unmatched,
        supporting_profile_evidence_ids=supporting,
    )

#!/usr/bin/env python3
"""Application Intelligence v0.

Ticket 8 consumes a validated Job Fit Result v1 (Ticket 7) and produces an
evidence-traceable application recommendation, positioning narrative, and
structured CV/cover-letter content. It does not re-derive job fit and never
overrides Ticket 7's matches, gaps, dimension assessments, blocked state,
status, or verdict.

Provider-proposed content is structured atom selections and bounded rendering
choices only — never free text for candidate-bearing content. Local code is
the sole authority that renders final text, from a template table gated by
the structural strength of the cited Profile Snapshot evidence. Deterministic
rendering must be evidence-preserving, not merely deterministic: a template
may restate what evidence structurally supports; it may never strengthen it.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Iterable

from product.evaluation_policy import load_evaluation_policy
from product.job_fit import profile_snapshot_content_id
from product.profile_snapshot import SnapshotValidationError, validate_snapshot


MODULE_DIR = Path(__file__).parent
SCHEMA_PATH = MODULE_DIR / "schemas" / "application-intelligence-contract.v1.schema.json"
POLICY_PATH = MODULE_DIR / "application_intelligence_policy.v0.json"
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
DEFAULT_POLICY = json.loads(POLICY_PATH.read_text(encoding="utf-8"))

REQUEST_VERSION = SCHEMA["$defs"]["requestVersion"]["const"]
RESULT_VERSION = SCHEMA["$defs"]["resultVersion"]["const"]
POLICY_VERSION = SCHEMA["$defs"]["policyVersion"]["const"]
ID_RE = re.compile(SCHEMA["$defs"]["id"]["pattern"])
ASSERTION_TYPES = set(SCHEMA["$defs"]["assertionType"]["enum"])
RENDERING_VARIANTS = set(SCHEMA["$defs"]["renderingVariant"]["enum"])
STRENGTH_LEVELS = tuple(SCHEMA["$defs"]["strengthLevel"]["enum"])
UNIT_TYPES = set(SCHEMA["$defs"]["unitType"]["enum"])
UNIT_STATUSES = set(SCHEMA["$defs"]["unitStatus"]["enum"])
RESULT_STATUSES = set(SCHEMA["$defs"]["resultStatus"]["enum"])
RECOMMENDATIONS = set(SCHEMA["$defs"]["recommendation"]["enum"])

# Ordered weakest-to-strongest; index comparison decides template eligibility.
STRENGTH_ORDER = {level: index for index, level in enumerate(STRENGTH_LEVELS)}


class ApplicationIntelligenceValidationError(ValueError):
    """Raised when Ticket 8 input or output violates the v0 contract."""

    def __init__(self, errors: str | Iterable[str]):
        if isinstance(errors, str):
            self.errors = [errors]
        else:
            self.errors = list(errors)
        super().__init__("; ".join(self.errors))


def validate_application_intelligence_policy(policy: Any) -> None:
    errors: list[str] = []
    required = {"schema_version", "id", "recommendation_rules"}
    if not _object_shape(policy, required, required, "$.application_intelligence_policy", errors):
        raise ApplicationIntelligenceValidationError(errors)
    if policy.get("schema_version") != POLICY_VERSION:
        errors.append("$.application_intelligence_policy.schema_version: unsupported version")
    _id(policy.get("id"), "$.application_intelligence_policy.id", errors)
    rules = _list(policy.get("recommendation_rules"), "$.application_intelligence_policy.recommendation_rules", errors)
    if not rules:
        errors.append("$.application_intelligence_policy.recommendation_rules: must not be empty")

    known_verdict_ids = _known_verdict_ids()
    seen_rule_ids: set[str] = set()
    covered_verdict_ids: set[str] = set()
    has_blocked_rule = False
    has_unavailable_rule = False
    has_needs_review_rule = False

    for index, rule in enumerate(rules):
        path = f"$.application_intelligence_policy.recommendation_rules[{index}]"
        allowed = {"rule_id", "when_blocked", "when_status", "when_verdict_in", "recommendation", "reason"}
        required_rule = {"rule_id", "recommendation", "reason"}
        if not _object_shape(rule, required_rule, allowed, path, errors):
            continue
        rule_id = rule.get("rule_id")
        _nonempty_string(rule_id, f"{path}.rule_id", errors)
        if isinstance(rule_id, str):
            if rule_id in seen_rule_ids:
                errors.append(f"{path}.rule_id: duplicate rule_id {rule_id!r}")
            seen_rule_ids.add(rule_id)
        _enum(rule.get("recommendation"), RECOMMENDATIONS, f"{path}.recommendation", errors)
        _nonempty_string(rule.get("reason"), f"{path}.reason", errors)

        if "when_blocked" in rule:
            if not isinstance(rule["when_blocked"], bool):
                errors.append(f"{path}.when_blocked: must be boolean")
            elif rule["when_blocked"] is True:
                has_blocked_rule = True

        if "when_status" in rule:
            _enum(rule["when_status"], RESULT_STATUSES, f"{path}.when_status", errors)
            if rule.get("when_status") == "UNAVAILABLE":
                has_unavailable_rule = True
            if rule.get("when_status") == "NEEDS_REVIEW":
                has_needs_review_rule = True

        if "when_verdict_in" in rule:
            verdict_ids = _string_list(rule["when_verdict_in"], f"{path}.when_verdict_in", errors)
            for verdict_id in verdict_ids:
                if verdict_id not in known_verdict_ids:
                    errors.append(f"{path}.when_verdict_in: unknown verdict id {verdict_id!r}")
                covered_verdict_ids.add(verdict_id)
            # A rule combining when_status and when_verdict_in is only
            # coherent when when_status is one Ticket 7 can actually produce
            # a non-null verdict alongside. Ticket 7's _result_status
            # (semantic_job_fit.py) returns NEEDS_REVIEW whenever ANY
            # dimension -- required or not -- resolves to non-READY, which
            # is checked independently of whether evaluate_scores() ran and
            # produced a real verdict. A non-required dimension can be
            # NEEDS_REVIEW while every required dimension is READY and no
            # gate blocks, in which case Ticket 7 legitimately produces
            # status=NEEDS_REVIEW with a real, non-null verdict. UNAVAILABLE
            # is the only status that can never carry a verdict (blocked
            # results short-circuit before evaluate_scores() runs).
            if "when_status" in rule and rule.get("when_status") not in {"READY", "NEEDS_REVIEW"}:
                errors.append(
                    f"{path}: when_verdict_in is only meaningful when when_status is "
                    f"'READY' or 'NEEDS_REVIEW' (Ticket 7 never produces a verdict for "
                    f"blocked/UNAVAILABLE results)"
                )

    if not has_blocked_rule:
        errors.append("$.application_intelligence_policy.recommendation_rules: must include a rule for blocked=true")
    if not has_unavailable_rule:
        errors.append("$.application_intelligence_policy.recommendation_rules: must include a rule for status=UNAVAILABLE")
    if not has_needs_review_rule:
        errors.append("$.application_intelligence_policy.recommendation_rules: must include a rule for status=NEEDS_REVIEW")
    missing_verdicts = known_verdict_ids - covered_verdict_ids
    if missing_verdicts:
        errors.append(
            f"$.application_intelligence_policy.recommendation_rules: "
            f"missing coverage for verdict ids {sorted(missing_verdicts)}"
        )

    if errors:
        raise ApplicationIntelligenceValidationError(errors)


def validate_application_intelligence_request(request: Any) -> None:
    errors: list[str] = []
    required = {"schema_version", "request_id", "job_fit_result", "resolved_job_evidence", "profile_snapshot", "policy"}
    if not _object_shape(request, required, required, "$", errors):
        raise ApplicationIntelligenceValidationError(errors)
    if request.get("schema_version") != REQUEST_VERSION:
        errors.append("$.schema_version: unsupported application intelligence request version")
    _id(request.get("request_id"), "$.request_id", errors)
    try:
        validate_snapshot(request.get("profile_snapshot"))
    except SnapshotValidationError as exc:
        errors.append(f"$.profile_snapshot: {exc}")
    _validate_consumed_job_fit_result_shape(request.get("job_fit_result"), errors)
    _validate_resolved_job_evidence_shape(request.get("resolved_job_evidence"), errors)
    _validate_upstream_identity(request, errors)
    try:
        validate_application_intelligence_policy(request.get("policy"))
    except ApplicationIntelligenceValidationError as exc:
        errors.extend(exc.errors)
    if errors:
        raise ApplicationIntelligenceValidationError(errors)


def _validate_resolved_job_evidence_shape(value: Any, errors: list[str]) -> None:
    # Ticket 8 trusts this bundle structurally (id/text/category per item) but
    # does not re-run Ticket 7's full validate_resolved_job_evidence_bundle,
    # which requires the original job_snapshot for identity-matching -- Ticket
    # 8's request does not carry job_snapshot separately, only the already-
    # resolved evidence bundle. This mirrors "consumes, does not re-derive."
    required = {"schema_version", "evidence"}
    if not _object_shape(value, required, {"schema_version", "job_snapshot", "evidence", "aliases", "excluded", "summary"}, "$.resolved_job_evidence", errors):
        return
    for index, item in enumerate(_list(value.get("evidence"), "$.resolved_job_evidence.evidence", errors)):
        path = f"$.resolved_job_evidence.evidence[{index}]"
        item_required = {"id", "category", "text"}
        _object_shape(item, item_required, item_required | {"kind", "origin", "status", "source_section", "citations"}, path, errors)


def _bundle_content_id(bundle: dict[str, Any]) -> str:
    """Content-derived Resolved Job Evidence Bundle identifier.

    Mirrors product.semantic_job_fit's private _bundle_identity/_content_id
    computation exactly (prefix "resolvedjobev", sha256[:20] over canonical
    JSON) so Ticket 8 can independently recompute the identity Ticket 7
    already stamped into its result, without importing Ticket 7's private
    helpers or duplicating validation logic -- only this one hash.
    """

    canonical = json.dumps(bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return f"resolvedjobev_{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:20]}"


def _validate_upstream_identity(request: dict[str, Any], errors: list[str]) -> None:
    """Reject a request whose supplied profile/evidence don't match what the
    consumed Job Fit Result actually recorded seeing.

    This is the staleness guard: if the caller supplies a Profile Snapshot or
    Resolved Job Evidence Bundle that has since changed from what Ticket 7
    evaluated, Ticket 8 must not silently reason over the mismatch.
    """

    job_fit_result = request.get("job_fit_result")
    profile_snapshot = request.get("profile_snapshot")
    resolved_job_evidence = request.get("resolved_job_evidence")
    if not isinstance(job_fit_result, dict) or not isinstance(profile_snapshot, dict) or not isinstance(resolved_job_evidence, dict):
        return  # shape errors already reported elsewhere; nothing more to check here

    recorded_profile = job_fit_result.get("profile_snapshot")
    if isinstance(recorded_profile, dict):
        actual_content_id = profile_snapshot_content_id(profile_snapshot)
        if recorded_profile.get("content_id") != actual_content_id:
            errors.append(
                "$.profile_snapshot: does not match the profile snapshot identity "
                "recorded in the consumed job_fit_result (stale or mismatched upstream input)"
            )

    recorded_bundle = job_fit_result.get("resolved_job_evidence")
    if isinstance(recorded_bundle, dict):
        actual_content_id = _bundle_content_id(resolved_job_evidence)
        if recorded_bundle.get("content_id") != actual_content_id:
            errors.append(
                "$.resolved_job_evidence: does not match the resolved job evidence identity "
                "recorded in the consumed job_fit_result (stale or mismatched upstream input)"
            )


JOB_FIT_RESULT_FIELDS = {
    "schema_version", "request_id", "profile_snapshot", "job_snapshot", "resolved_job_evidence",
    "active_extension_versions", "evaluation_policy_version", "semantic_fit_policy",
    "gate_assessments", "gate_results", "direct_matches", "functionally_equivalent_matches",
    "transferable_matches", "gaps", "unsupported_claims", "human_judgment_questions",
    "dimension_assessments", "dimension_scores", "overall_score", "verdict", "blocked",
    "blocking_gate_ids", "status", "notes",
}


def _validate_consumed_job_fit_result_shape(value: Any, errors: list[str]) -> None:
    """Accept the real Ticket 7 Job Fit Result v1 shape (21 top-level fields).

    Ticket 8 does not strip or reinvent this envelope -- it validates that the
    consumed result actually has Ticket 7's real shape, then reads only the
    fields it needs (status, blocked, verdict, the match/gap/question
    collections). The full envelope, including identity fields, is preserved
    in job_fit_result for downstream use (job_fit_result_ref construction).
    """

    if not _object_shape(value, JOB_FIT_RESULT_FIELDS, JOB_FIT_RESULT_FIELDS, "$.job_fit_result", errors):
        return
    _enum(value.get("status"), RESULT_STATUSES, "$.job_fit_result.status", errors)
    if not isinstance(value.get("blocked"), bool):
        errors.append("$.job_fit_result.blocked: must be boolean")
    _validate_consumed_verdict_shape(value.get("verdict"), errors)


def _validate_consumed_verdict_shape(value: Any, errors: list[str]) -> None:
    if value is None:
        return
    required = {"id", "display_name", "score"}
    if not _object_shape(value, required, required, "$.job_fit_result.verdict", errors):
        return
    verdict_ids = _known_verdict_ids()
    if value.get("id") not in verdict_ids:
        errors.append(f"$.job_fit_result.verdict.id: must be one of {sorted(verdict_ids)}")


def _known_verdict_ids() -> set[str]:
    """Load the real verdict id vocabulary from the Evaluation Policy, not a hardcoded set."""

    policy = load_evaluation_policy()
    return {threshold["id"] for threshold in policy["verdict_thresholds"]}


def _compute_recommendation(job_fit_result: dict[str, Any], policy: dict[str, Any]) -> tuple[str, str]:
    """Pure, provider-blind projection of Ticket 7 state onto a recommendation.

    Evaluates ``policy['recommendation_rules']`` top-to-bottom; first matching
    rule wins, mirroring the classification_precedence style already used by
    ``semantic_fit_policy.v0.json``. Ticket 7's verdict is either None or a
    dict {id, display_name, score} (product.evaluation_policy.classify_verdict);
    this function compares against verdict["id"], never the dict itself.
    """

    blocked = job_fit_result["blocked"]
    status = job_fit_result["status"]
    verdict = job_fit_result.get("verdict")
    verdict_id = verdict["id"] if isinstance(verdict, dict) else None
    for rule in policy["recommendation_rules"]:
        if rule.get("when_blocked") is True and not blocked:
            continue
        if "when_status" in rule and rule["when_status"] != status:
            continue
        if "when_verdict_in" in rule and verdict_id not in rule["when_verdict_in"]:
            continue
        return rule["recommendation"], rule["reason"]
    raise ApplicationIntelligenceValidationError(
        f"$.policy.recommendation_rules: no rule matched blocked={blocked!r} status={status!r} verdict_id={verdict_id!r}"
    )


def _object_shape(value: Any, required: set[str], allowed: set[str], path: str, errors: list[str]) -> bool:
    if not isinstance(value, dict):
        errors.append(f"{path}: must be an object")
        return False
    for key in sorted(required - value.keys()):
        errors.append(f"{path}.{key}: required field is missing")
    for key in sorted(value.keys() - allowed):
        errors.append(f"{path}.{key}: unsupported field")
    return required <= value.keys()


def _list(value: Any, path: str, errors: list[str]) -> list[Any]:
    if not isinstance(value, list):
        errors.append(f"{path}: must be an array")
        return []
    return value


def _string_list(value: Any, path: str, errors: list[str]) -> list[str]:
    items = _list(value, path, errors)
    result = []
    for index, item in enumerate(items):
        if not isinstance(item, str) or not item.strip():
            errors.append(f"{path}[{index}]: must be a non-empty string")
            continue
        result.append(item)
    return result


def _id(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        errors.append(f"{path}: malformed identifier")


def _nonempty_string(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{path}: must be a non-empty string")


def _enum(value: Any, allowed: set[str], path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or value not in allowed:
        errors.append(f"{path}: must be one of {', '.join(sorted(allowed))}")


# --- Evidence-preserving rendering ------------------------------------------
#
# Each template declares an ELIGIBILITY PREDICATE over the specific claims
# cited for one atom, not a scalar "strength level" compared with >=. This
# closes two defects the ordinal-ladder approach had:
#   1. A scalar max() across all cited claims let a strong claim's tier leak
#      onto an unrelated weak claim on the same atom (e.g. German proficiency
#      evidence could not previously upgrade a Python skill claim's strength
#      only because no atom in practice cited both -- but nothing in the
#      logic actually prevented it structurally).
#   2. "STATED" was treated as a real permission tier, so a bare technical_skill
#      claim (no linked employment) could select AS_CAPABILITY_STATEMENT and
#      render "Experience with {value}" -- itself an unearned experience claim.
#      Now AS_CAPABILITY_STATEMENT for technical_skill requires the same
#      structural employment linkage as AS_STRENGTH; a bare skill claim can
#      only ever render its neutral PLAIN form.
#
# Templates may restate what evidence structurally supports; they may never
# strengthen it.


def _has_employment_linkage(claim: dict[str, Any], all_claims: dict[str, dict[str, Any]]) -> bool:
    """True if this claim shares a record_id with an employment job_title/employer claim."""

    linked = _linked_claims(claim, all_claims)
    linked_fields = {(item["category"], item["field"]) for item in linked}
    return ("employment", "job_title") in linked_fields or ("employment", "employer") in linked_fields


def _is_explicit_proficiency(claim: dict[str, Any]) -> bool:
    return claim["field"] == "proficiency"


def _is_explicit_duration(claim: dict[str, Any]) -> bool:
    return claim["category"] == "employment" and claim["field"] == "date_range"


def _is_explicit_hands_on(claim: dict[str, Any], all_claims: dict[str, dict[str, Any]]) -> bool:
    return claim["field"] == "responsibility_or_achievement" and _has_employment_linkage(claim, all_claims)


# Each entry: (assertion_type, rendering_variant) -> a predicate function
# taking (claims: list[dict], all_claims: dict) -> bool, and a format string.
# The predicate evaluates the SPECIFIC claims cited on this atom -- it never
# takes a precomputed scalar, so there is no cross-claim leakage possible.
TEMPLATE_TABLE: dict[tuple[str, str], dict[str, Any]] = {
    ("skill", "PLAIN"): {
        "eligible": lambda claims, all_claims: list(claims),
        "format": "{value}",
    },
    ("technical_skill", "PLAIN"): {
        "eligible": lambda claims, all_claims: list(claims),
        "format": "{value}",
    },
    ("technical_skill", "AS_CAPABILITY_STATEMENT"): {
        # Requires structural employment linkage -- a bare skill claim is no
        # longer eligible for this variant; it renders PLAIN only. Returns
        # the SPECIFIC qualifying claim(s), not a bool, so the renderer can
        # never render an unlinked claim's value under a template whose
        # eligibility was satisfied only by a DIFFERENT cited claim.
        "eligible": lambda claims, all_claims: [
            claim for claim in claims if _has_employment_linkage(claim, all_claims)
        ],
        "format": "Experience with {value}",
    },
    ("technical_skill", "AS_STRENGTH"): {
        "eligible": lambda claims, all_claims: [
            claim for claim in claims if _is_explicit_hands_on(claim, all_claims)
        ],
        "format": "Strong hands-on experience with {value}",
    },
    ("employment", "PLAIN"): {
        "eligible": lambda claims, all_claims: list(claims),
        "format": "{value}",
    },
    ("responsibility", "PLAIN"): {
        "eligible": lambda claims, all_claims: list(claims),
        "format": "{value}",
    },
    ("responsibility", "AS_STRENGTH"): {
        "eligible": lambda claims, all_claims: [
            claim for claim in claims if _is_explicit_hands_on(claim, all_claims)
        ],
        # Responsibility evidence is already candidate-authored prose. A
        # generic prefix can turn a valid sentence into malformed text (for
        # example, "Hands-on delivery of Planned..."). Preserve it verbatim.
        "format": "{value}",
    },
    ("certification", "PLAIN"): {
        "eligible": lambda claims, all_claims: list(claims),
        "format": "{value}",
    },
    ("language", "AS_CAPABILITY_STATEMENT"): {
        "eligible": lambda claims, all_claims: [
            claim for claim in claims if _is_explicit_proficiency(claim)
        ],
        "format": "Proficient in {value}",
    },
}

# Closed-class connective allowlist. No nouns/verbs describing capability, no
# numbers, no named entities — mechanically checkable, not heuristic NLP.
CONNECTIVE_ALLOWLIST = frozenset(
    {
        "additionally", "in this role", "as a result", "furthermore",
        "and", "with", "while", "in addition", "notably", ",", ".", ";",
    }
)

PLAN_RATIONALE_KINDS = frozenset({
    "covers_uncovered_requirement", "reinforces_required_dimension",
    "strengthens_direct_match", "addresses_gap_context",
})


def _linked_claims(claim: dict[str, Any], all_claims: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    record_id = claim.get("record_id")
    if not record_id:
        return []
    return [other for other in all_claims.values() if other.get("record_id") == record_id]


def _select_template(
    assertion_type: str,
    rendering_variant: str,
    claims: list[dict[str, Any]],
    all_claims: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]]] | tuple[None, list]:
    """Return (template, qualifying_claims) if eligible, or (None, []).

    qualifying_claims is the SPECIFIC subset of the cited claims that
    satisfied the template's eligibility predicate -- never the full
    ``claims`` list by default. This closes a correctness gap: eligibility
    and the value actually rendered must come from the same claim, or a
    claim that satisfies eligibility only via a DIFFERENT cited claim's
    structural linkage could have its own (weaker) value rendered under a
    template it does not itself qualify for.
    """

    template = TEMPLATE_TABLE.get((assertion_type, rendering_variant))
    if template is None:
        return None, []
    qualifying_claims = template["eligible"](claims, all_claims)
    if not qualifying_claims:
        return None, []
    return template, qualifying_claims


def _validate_connective(text: str) -> bool:
    normalized = text.strip().lower()
    return normalized in CONNECTIVE_ALLOWLIST


def _render_candidate_fact_atom(
    atom: dict[str, Any],
    context: dict[str, Any],
) -> dict[str, Any]:
    """Validate one candidate_fact_atom and render its text, or reject it.

    Callers must run _validate_atom_shape first -- this function trusts that
    atom['assertion_type']/['rendering_variant'] are present and well-typed,
    but uses .get() defensively rather than bracket access, so a caller that
    skips shape validation gets a clean UNSUPPORTED rejection instead of a
    KeyError.
    """

    profile_ids = atom.get("profile_evidence_ids", [])
    if not profile_ids:
        return {"status": "UNSUPPORTED", "text": None, "reason": "candidate fact atom requires profile evidence"}

    assertion_type = atom.get("assertion_type")
    rendering_variant = atom.get("rendering_variant")
    if assertion_type not in ASSERTION_TYPES:
        return {"status": "UNSUPPORTED", "text": None, "reason": f"unknown assertion_type {assertion_type!r}"}

    claims = []
    for claim_id in profile_ids:
        claim = context["profile_by_id"].get(claim_id)
        if claim is None:
            return {"status": "UNSUPPORTED", "text": None, "reason": f"unknown profile evidence id {claim_id!r}"}
        if claim.get("placeholder") or claim.get("concept_id") in context["conflicted_concepts"]:
            return {"status": "UNSUPPORTED", "text": None, "reason": f"placeholder or conflicted evidence {claim_id!r}"}
        if claim["category"] != _assertion_category(assertion_type) or claim["field"] not in _assertion_fields(assertion_type):
            return {
                "status": "UNSUPPORTED",
                "text": None,
                "reason": f"evidence {claim_id!r} category/field does not match assertion_type {assertion_type!r}",
            }
        claims.append(claim)

    template_key = (assertion_type, rendering_variant)
    if template_key not in TEMPLATE_TABLE:
        return {
            "status": "UNSUPPORTED",
            "text": None,
            "reason": (
                f"no rendering template is registered for assertion_type "
                f"{assertion_type!r} with rendering_variant {rendering_variant!r}"
            ),
        }
    template, qualifying_claims = _select_template(assertion_type, rendering_variant, claims, context["profile_by_id"])
    if template is None:
        return {
            "status": "UNSUPPORTED",
            "text": None,
            "reason": (
                f"rendering_variant {rendering_variant!r} for assertion_type "
                f"{assertion_type!r} requires structural evidence linkage that the cited claims do not have"
            ),
        }

    # Render from a claim that ITSELF satisfied eligibility, never from
    # claims[0] regardless of which claim qualified -- closes the gap where
    # a strengthened template's wording could be applied to an unrelated,
    # weaker claim's bare value just because both were cited on one atom.
    rendered = template["format"].format(value=qualifying_claims[0]["value"])
    return {"status": "READY", "text": rendered}


# assertion_type -> (category, allowed fields). Closed mapping to the Profile
# Snapshot's existing category/field vocabulary from profile_snapshot.py.
_ASSERTION_TYPE_SHAPES: dict[str, tuple[str, set[str]]] = {
    "skill": ("skills", {"technical_skill", "domain_skill", "software_or_tool"}),
    "technical_skill": ("skills", {"technical_skill"}),
    "employment": ("employment", {"job_title", "employer", "date_range", "location"}),
    "responsibility": ("employment", {"responsibility_or_achievement"}),
    "certification": ("certifications", {"certification"}),
    "education": ("education", {"qualification", "institution", "date_range"}),
    "publication": ("publications", {"publication"}),
    "award": ("awards", {"award"}),
    "language": ("languages", {"language", "proficiency"}),
}


def _assertion_category(assertion_type: str) -> str:
    return _ASSERTION_TYPE_SHAPES[assertion_type][0]


def _assertion_fields(assertion_type: str) -> set[str]:
    return _ASSERTION_TYPE_SHAPES[assertion_type][1]


def _build_positioning(job_fit_result: dict[str, Any]) -> dict[str, Any]:
    """Build the positioning section directly from Ticket 7's own STRUCTURED
    records -- never from match['rationale'].

    PM ruling: rationale is excluded from positioning too, not just from
    rendered cv_content/cover_letter_content. There is one uniform rule
    across the whole Application Intelligence Result: rationale was
    validated by Ticket 7 as "a reason a match holds," not as safe-to-surface
    text anywhere in Ticket 8's output, rendered or summarized. Positioning
    entries carry structured provenance (match/gap/question ids,
    classification, evidence ids, status/limitations/conditions where
    relevant) instead of prose text.

    gap.notes and human_judgment_questions.question ARE included verbatim --
    these are distinct fields Ticket 7 populates specifically as human-facing
    review text (not audit/rationale metadata), so they remain as-is.
    """

    direct_strengths = [
        {
            "match_id": match["match_id"],
            "classification": match["classification"],
            "job_requirement_ids": list(match.get("job_requirement_ids", [])),
            "profile_evidence_ids": list(match.get("profile_evidence_ids", [])),
        }
        for match in job_fit_result.get("direct_matches", [])
    ]
    functional_strengths = [
        {
            "match_id": match["match_id"],
            "classification": match["classification"],
            "job_requirement_ids": list(match.get("job_requirement_ids", [])),
            "profile_evidence_ids": list(match.get("profile_evidence_ids", [])),
        }
        for match in job_fit_result.get("functionally_equivalent_matches", [])
    ]
    transferable_strengths = [
        {
            "match_id": match["match_id"],
            "classification": match["classification"],
            "job_requirement_ids": list(match.get("job_requirement_ids", [])),
            "profile_evidence_ids": list(match.get("profile_evidence_ids", [])),
            "limitations": list(match.get("limitations", [])),
            "conditions": list(match.get("conditions", [])),
            "status": match["status"],
        }
        for match in job_fit_result.get("transferable_matches", [])
    ]
    material_gaps = [
        {"text": gap["notes"], "gap_ids": [gap["gap_id"]]}
        for gap in job_fit_result.get("gaps", [])
    ]
    open_questions = [
        {"text": question["question"], "question_ids": [question["question_id"]]}
        for question in job_fit_result.get("human_judgment_questions", [])
    ]
    return {
        "direct_strengths": direct_strengths,
        "functional_strengths": functional_strengths,
        "transferable_strengths": transferable_strengths,
        "material_gaps": material_gaps,
        "open_questions": open_questions,
    }


def _compute_requirement_coverage(
    job_fit_result: dict[str, Any], accepted_units: list[dict[str, Any]],
) -> dict[str, list[str]]:
    """required: union of job_requirement_ids across direct/functionally_equivalent/
    transferable matches. covered: the subset backed by at least one accepted
    unit (status READY, non-empty text) citing a profile_evidence_id that
    belongs to a match carrying that requirement id. Computed strictly from
    accepted_units -- never from a raw provider proposal or plan entry."""

    required: set[str] = set()
    requirement_to_evidence: dict[str, set[str]] = {}
    for match_list_key in ("direct_matches", "functionally_equivalent_matches", "transferable_matches"):
        for match in job_fit_result.get(match_list_key, []):
            evidence_ids = set(match.get("profile_evidence_ids", []))
            for requirement_id in match.get("job_requirement_ids", []):
                required.add(requirement_id)
                requirement_to_evidence.setdefault(requirement_id, set()).update(evidence_ids)

    cited_evidence_ids: set[str] = set()
    for unit in accepted_units:
        if unit.get("status") != "READY" or not isinstance(unit.get("text"), str) or not unit["text"].strip():
            continue
        cited_evidence_ids.update(unit.get("profile_evidence_ids", []))

    covered = {
        requirement_id
        for requirement_id, evidence_ids in requirement_to_evidence.items()
        if evidence_ids & cited_evidence_ids
    }
    uncovered = required - covered
    return {
        "required": sorted(required),
        "covered": sorted(covered),
        "uncovered": sorted(uncovered),
    }


def _job_fit_result_content_id(job_fit_result: dict[str, Any]) -> str:
    """Content-derived identifier for the exact consumed Job Fit Result.

    Lets a downstream consumer (e.g. Ticket 9) detect if the Application
    Intelligence Result was built against a Job Fit Result that has since
    changed, the same staleness-detection pattern used throughout Tickets 1-7.
    """

    canonical = json.dumps(job_fit_result, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return f"jobfitresult_{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:20]}"


def validate_application_intelligence_result(request: dict[str, Any], result: Any) -> None:
    """Validate an Application Intelligence Result v0 against its request.

    Mirrors product.semantic_job_fit.validate_semantic_job_fit_result's
    pattern: validate the request first, then check result shape and
    cross-reference identities/evidence ids against the request's context.
    """

    validate_application_intelligence_request(request)
    errors: list[str] = []
    required = {
        "schema_version", "request_id", "job_fit_result_ref", "profile_snapshot",
        "recommendation", "recommendation_reason", "positioning", "cv_emphasis_plan",
        "cv_content", "cover_letter_plan", "cover_letter_content", "unsupported_claims",
        "plan_issues", "requirement_coverage", "status", "notes",
    }
    if not _object_shape(result, required, required, "$.result", errors):
        raise ApplicationIntelligenceValidationError(errors)

    if result.get("schema_version") != RESULT_VERSION:
        errors.append("$.result.schema_version: unsupported version")
    if result.get("request_id") != request["request_id"]:
        errors.append("$.result.request_id: must match request")

    job_fit_result = request["job_fit_result"]
    expected_ref = {
        "schema_version": job_fit_result["schema_version"],
        "request_id": job_fit_result["request_id"],
        "content_id": _job_fit_result_content_id(job_fit_result),
    }
    if result.get("job_fit_result_ref") != expected_ref:
        errors.append("$.result.job_fit_result_ref: must identify the consumed job_fit_result")

    expected_profile_ref = {
        "schema_version": request["profile_snapshot"]["schema_version"],
        "content_id": profile_snapshot_content_id(request["profile_snapshot"]),
    }
    if result.get("profile_snapshot") != expected_profile_ref:
        errors.append("$.result.profile_snapshot: must identify the request profile snapshot")

    _enum(result.get("recommendation"), RECOMMENDATIONS, "$.result.recommendation", errors)
    _nonempty_string(result.get("recommendation_reason"), "$.result.recommendation_reason", errors)
    _enum(result.get("status"), RESULT_STATUSES, "$.result.status", errors)
    _string_list(result.get("notes"), "$.result.notes", errors)

    if not isinstance(result.get("positioning"), dict):
        errors.append("$.result.positioning: must be an object")
    if not isinstance(result.get("cv_emphasis_plan"), list):
        errors.append("$.result.cv_emphasis_plan: must be an array")
    if not isinstance(result.get("cover_letter_plan"), list):
        errors.append("$.result.cover_letter_plan: must be an array")
    for field in ("cv_content", "cover_letter_content"):
        for index, unit in enumerate(_list(result.get(field), f"$.result.{field}", errors)):
            path = f"$.result.{field}[{index}]"
            unit_required = {"unit_id", "unit_type", "text", "status", "profile_evidence_ids"}
            _object_shape(unit, unit_required, unit_required, path, errors)
    for index, claim in enumerate(_list(result.get("unsupported_claims"), "$.result.unsupported_claims", errors)):
        path = f"$.result.unsupported_claims[{index}]"
        claim_required = {"claim_id", "reason", "rejected_atom_ids"}
        _object_shape(claim, claim_required, claim_required, path, errors)
    for index, issue in enumerate(_list(result.get("plan_issues"), "$.result.plan_issues", errors)):
        path = f"$.result.plan_issues[{index}]"
        issue_required = {"field", "index", "reason"}
        _object_shape(issue, issue_required, issue_required, path, errors)

    coverage = result.get("requirement_coverage")
    if not isinstance(coverage, dict) or set(coverage.keys()) != {"required", "covered", "uncovered"}:
        errors.append("$.result.requirement_coverage: must be an object with exactly required/covered/uncovered")
    else:
        for key in ("required", "covered", "uncovered"):
            _string_list(coverage.get(key), f"$.result.requirement_coverage.{key}", errors)

    if errors:
        raise ApplicationIntelligenceValidationError(errors)


def analyze_application_intelligence(request: dict[str, Any], proposal: dict[str, Any] | None = None) -> dict[str, Any]:
    """Produce a validated Application Intelligence Result v0.

    ``proposal`` is the untrusted provider payload (atom selections, rendering
    variants, connectives, transferability atom references). When omitted,
    the result contains only the deterministic recommendation and positioning
    plan sections with no rendered content units.
    """

    validate_application_intelligence_request(request)
    job_fit_result = request["job_fit_result"]
    policy = request["policy"]
    profile_by_id = {claim["id"]: claim for claim in request["profile_snapshot"]["claims"]}
    conflicted_concepts = {
        conflict["concept_id"] for conflict in request["profile_snapshot"].get("conflicts", [])
    }
    transferable_by_match_id = {
        match["match_id"]: match for match in job_fit_result.get("transferable_matches", [])
    }
    job_evidence_by_id = {
        item["id"]: item for item in request["resolved_job_evidence"].get("evidence", [])
    }
    context = {
        "profile_by_id": profile_by_id,
        "conflicted_concepts": conflicted_concepts,
        "transferable_by_match_id": transferable_by_match_id,
        "job_evidence_by_id": job_evidence_by_id,
    }

    recommendation, recommendation_reason = _compute_recommendation(job_fit_result, policy)

    positioning = _build_positioning(job_fit_result)

    cv_content: list[dict[str, Any]] = []
    cover_letter_content: list[dict[str, Any]] = []
    unsupported_claims: list[dict[str, Any]] = []
    for unit_proposal in (proposal or {}).get("content_units", []):
        adjudicated = _adjudicate_content_unit(unit_proposal, context)
        unit = adjudicated["unit"]
        unsupported_claims.extend(adjudicated["unsupported"])
        if unit["unit_type"] in {"cv_bullet", "cv_summary_line"}:
            cv_content.append(unit)
        elif unit["unit_type"] in {"cover_letter_paragraph", "positioning_statement"}:
            cover_letter_content.append(unit)
        else:
            unsupported_claims.append(
                {
                    "claim_id": _stable_id("uns", f"unknown-unit-type:{unit_proposal.get('unit_id', '')}"),
                    "reason": f"unknown unit_type {unit_proposal.get('unit_type')!r}",
                    "rejected_atom_ids": [],
                }
            )

    all_units = cv_content + cover_letter_content
    usable_units = [unit for unit in all_units if isinstance(unit.get("text"), str) and unit["text"].strip()]
    result_status = "READY"
    if job_fit_result["blocked"] or job_fit_result["status"] == "UNAVAILABLE":
        result_status = "UNAVAILABLE"
    elif (
        not usable_units
        or job_fit_result["status"] == "NEEDS_REVIEW"
        or any(unit["status"] != "READY" for unit in all_units)
        or unsupported_claims
    ):
        result_status = "NEEDS_REVIEW"

    notes = []
    if not usable_units:
        notes.append("No usable application material was generated.")


    cv_emphasis_plan, cv_plan_issues = _validate_plan((proposal or {}).get("cv_emphasis_plan"), "cv_emphasis_plan")
    cover_letter_plan, cover_letter_plan_issues = _validate_plan((proposal or {}).get("cover_letter_plan"), "cover_letter_plan")
    plan_issues = cv_plan_issues + cover_letter_plan_issues
    requirement_coverage = _compute_requirement_coverage(job_fit_result, all_units)
    result = {
        "schema_version": RESULT_VERSION,
        "request_id": request["request_id"],
        "job_fit_result_ref": {
            "schema_version": job_fit_result["schema_version"],
            "request_id": job_fit_result["request_id"],
            "content_id": _job_fit_result_content_id(job_fit_result),
        },
        "profile_snapshot": {
            "schema_version": request["profile_snapshot"]["schema_version"],
            "content_id": profile_snapshot_content_id(request["profile_snapshot"]),
        },
        "recommendation": recommendation,
        "recommendation_reason": recommendation_reason,
        "positioning": positioning,
        "cv_emphasis_plan": cv_emphasis_plan,
        "cv_content": cv_content,
        "cover_letter_plan": cover_letter_plan,
        "cover_letter_content": cover_letter_content,
        "unsupported_claims": unsupported_claims,
        "plan_issues": plan_issues,
        "requirement_coverage": requirement_coverage,
        "status": result_status,
        "notes": notes,
    }
    validate_application_intelligence_result(request, result)
    return result


def _validate_atom_shape(atom: Any) -> str | None:
    """Return an error reason string if this atom is structurally malformed,
    or None if it's well-formed enough to attempt adjudication.

    This runs BEFORE any bracket-access into the atom, so a malformed atom
    (missing keys, wrong types) is quarantined here rather than raising a
    KeyError deep inside _render_candidate_fact_atom. Fixes parked finding 1.
    """

    if not isinstance(atom, dict):
        return "atom must be an object"
    atom_kind = atom.get("atom_kind")
    if atom_kind not in {"candidate_fact", "job_reference", "transferability"}:
        return f"unknown or missing atom_kind {atom_kind!r}"
    if not isinstance(atom.get("atom_id"), str) or not atom["atom_id"].strip():
        return "atom_id must be a non-empty string"
    if "rendering_variant" not in atom or atom["rendering_variant"] not in RENDERING_VARIANTS:
        return f"rendering_variant must be one of {sorted(RENDERING_VARIANTS)}"

    if atom_kind == "candidate_fact":
        if "assertion_type" not in atom or atom["assertion_type"] not in ASSERTION_TYPES:
            return f"assertion_type must be one of {sorted(ASSERTION_TYPES)}"
        profile_ids = atom.get("profile_evidence_ids")
        if not isinstance(profile_ids, list) or not all(isinstance(item, str) for item in profile_ids):
            return "profile_evidence_ids must be a list of strings"
    elif atom_kind == "job_reference":
        job_ids = atom.get("job_evidence_ids")
        if not isinstance(job_ids, list) or not all(isinstance(item, str) for item in job_ids):
            return "job_evidence_ids must be a list of strings"
    elif atom_kind == "transferability":
        if not isinstance(atom.get("job_fit_match_id"), str) or not atom["job_fit_match_id"].strip():
            return "job_fit_match_id must be a non-empty string"

    return None


def _validate_connective_shape(connective: Any, num_atoms: int) -> str | None:
    """Return an error reason if this connective entry is malformed or its
    after_atom_index is out of range for the unit's atom list.

    Fixes: previously, connectives_by_index = {c["after_atom_index"]: c["text"]
    for c in ...} would silently accept any integer index, including negative
    or out-of-range values, and the dict.get(index) lookup would simply never
    match during adjudication -- an out-of-range connective was silently
    ignored rather than rejected. This makes that rejection explicit and
    deterministic.
    """

    if not isinstance(connective, dict):
        return "connective must be an object"
    index = connective.get("after_atom_index")
    if not isinstance(index, int) or isinstance(index, bool):
        return "after_atom_index must be an integer"
    if index < 0 or index >= num_atoms:
        return f"after_atom_index {index} is out of range for {num_atoms} atom(s)"
    if not isinstance(connective.get("text"), str) or not connective["text"].strip():
        return "connective text must be a non-empty string"
    return None


def _validate_unit_proposal_shape(unit_proposal: Any) -> str | None:
    """Return an error reason if the unit's own top-level shape is malformed
    (unit_id/unit_type/atoms/connectives types), before per-atom validation."""

    if not isinstance(unit_proposal, dict):
        return "content unit proposal must be an object"
    if not isinstance(unit_proposal.get("unit_id"), str) or not unit_proposal["unit_id"].strip():
        return "unit_id must be a non-empty string"
    if unit_proposal.get("unit_type") not in UNIT_TYPES:
        return f"unit_type must be one of {sorted(UNIT_TYPES)}"
    if not isinstance(unit_proposal.get("atoms", []), list):
        return "atoms must be an array"
    if not isinstance(unit_proposal.get("connectives", []), list):
        return "connectives must be an array"
    return None


def _validate_plan_entry_shape(entry: Any) -> str | None:
    """Return an error reason if this cv_emphasis_plan/cover_letter_plan entry
    is malformed, or None if it is well-formed. Mirrors _validate_atom_shape's
    return convention exactly."""

    if not isinstance(entry, dict):
        return "plan entry must be an object"
    if not isinstance(entry.get("plan_id"), str) or not entry["plan_id"].strip():
        return "plan_id must be a non-empty string"
    if entry.get("target_unit_type") not in UNIT_TYPES:
        return f"target_unit_type must be one of {sorted(UNIT_TYPES)}"
    ids = entry.get("target_job_requirement_ids")
    if not isinstance(ids, list) or not all(isinstance(item, str) for item in ids):
        return "target_job_requirement_ids must be a list of strings"
    if entry.get("rationale_kind") not in PLAN_RATIONALE_KINDS:
        return f"rationale_kind must be one of {sorted(PLAN_RATIONALE_KINDS)}"
    return None


def _validate_plan(raw_plan: Any, field_name: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Validate a cv_emphasis_plan or cover_letter_plan list. Malformed entries
    are dropped fail-closed and reported as plan_issues -- never raised, never
    routed into unsupported_claims, which is reserved for candidate-content
    rejection (a distinct concept from malformed planning metadata)."""

    if not isinstance(raw_plan, list):
        return [], []
    valid: list[dict[str, Any]] = []
    issues: list[dict[str, Any]] = []
    for index, entry in enumerate(raw_plan):
        error = _validate_plan_entry_shape(entry)
        if error is not None:
            issues.append({"field": field_name, "index": index, "reason": error})
            continue
        valid.append(entry)
    return valid, issues


def _adjudicate_content_unit(unit_proposal: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    rendered_by_index: dict[int, str] = {}
    unit_status = "READY"
    unsupported: list[dict[str, Any]] = []
    atom_evidence_ids: list[str] = []

    unit_shape_error = _validate_unit_proposal_shape(unit_proposal)
    if unit_shape_error is not None:
        return {
            "unit": {
                "unit_id": unit_proposal.get("unit_id") if isinstance(unit_proposal, dict) else None,
                "unit_type": unit_proposal.get("unit_type") if isinstance(unit_proposal, dict) else None,
                "text": "",
                "status": "NEEDS_REVIEW",
                "profile_evidence_ids": [],
            },
            "unsupported": [
                {
                    "claim_id": _stable_id("uns", f"malformed-unit:{id(unit_proposal)}"),
                    "reason": unit_shape_error,
                    "rejected_atom_ids": [],
                }
            ],
        }

    atoms = unit_proposal.get("atoms", [])
    num_atoms = len(atoms)

    connectives_by_index: dict[int, str] = {}
    for connective in unit_proposal.get("connectives", []):
        connective_error = _validate_connective_shape(connective, num_atoms)
        if connective_error is not None:
            unit_status = "NEEDS_REVIEW"
            unsupported.append(
                {
                    "claim_id": _stable_id("uns", f"malformed-connective:{unit_proposal.get('unit_id', '')}:{connective!r}"),
                    "reason": connective_error,
                    "rejected_atom_ids": [],
                }
            )
            continue
        connectives_by_index[connective["after_atom_index"]] = connective["text"]

    for index, atom in enumerate(atoms):
        atom_shape_error = _validate_atom_shape(atom)
        if atom_shape_error is not None:
            unit_status = "NEEDS_REVIEW"
            unsupported.append(
                {
                    "claim_id": _stable_id("uns", f"{unit_proposal.get('unit_id', '')}:{index}"),
                    "reason": atom_shape_error,
                    "rejected_atom_ids": [atom.get("atom_id") if isinstance(atom, dict) else None],
                }
            )
            continue

        atom_kind = atom.get("atom_kind")

        if atom_kind == "transferability":
            match = context["transferable_by_match_id"].get(atom.get("job_fit_match_id"))
            if match is None:
                unit_status = "NEEDS_REVIEW"
                unsupported.append(
                    {
                        "claim_id": _stable_id("uns", f"{unit_proposal.get('unit_id', '')}:{index}"),
                        "reason": f"unknown job_fit_match_id {atom.get('job_fit_match_id')!r}",
                        "rejected_atom_ids": [atom.get("atom_id")],
                    }
                )
                continue
            atom_evidence_ids.extend(match.get("profile_evidence_ids", []))
            rendered = _render_transferability_atom(match)
            rendered_by_index[index] = rendered["text"]
            if match["status"] != "READY":
                unit_status = "NEEDS_REVIEW"
            continue

        if atom_kind == "job_reference":
            # job_reference atoms cite job evidence text, never profile
            # evidence -- they motivate why a requirement matters, they never
            # assert a candidate fact. Rendered from resolved_job_evidence
            # text only, gated the same way as candidate_fact atoms (valid
            # id required, no free text from the provider).
            rendered = _render_job_reference_atom(atom, context)
            if rendered["status"] != "READY":
                unit_status = "NEEDS_REVIEW"
                unsupported.append(
                    {
                        "claim_id": _stable_id("uns", f"{unit_proposal.get('unit_id', '')}:{index}"),
                        "reason": rendered["reason"],
                        "rejected_atom_ids": [atom.get("atom_id")],
                    }
                )
                continue
            rendered_by_index[index] = rendered["text"]
            continue

        # atom_kind is guaranteed to be "candidate_fact" here: _validate_atom_shape
        # already rejected any atom whose atom_kind was not one of the three
        # known values, and the "transferability"/"job_reference" branches above
        # both `continue` before reaching this point.
        rendered = _render_candidate_fact_atom(atom, context)
        if rendered["status"] != "READY":
            unit_status = "NEEDS_REVIEW"
            unsupported.append(
                {
                    "claim_id": _stable_id("uns", f"{unit_proposal.get('unit_id', '')}:{index}"),
                    "reason": rendered["reason"],
                    "rejected_atom_ids": [atom.get("atom_id")],
                }
            )
            continue
        atom_evidence_ids.extend(atom.get("profile_evidence_ids", []))
        rendered_by_index[index] = rendered["text"]

    rendered_fragments: list[str] = []
    for index in sorted(rendered_by_index):
        rendered_fragments.append(rendered_by_index[index])
        connective_text = connectives_by_index.get(index)
        if connective_text is None:
            continue
        if not _validate_connective(connective_text):
            unit_status = "NEEDS_REVIEW"
            continue
        if index + 1 not in rendered_by_index:
            unit_status = "NEEDS_REVIEW"
            unsupported.append({
                "claim_id": _stable_id(
                    "uns", f"dangling-connective:{unit_proposal.get('unit_id', '')}:{index}"
                ),
                "reason": f"connective after atom index {index} has no following rendered atom",
                "rejected_atom_ids": [],
            })
            continue
        rendered_fragments.append(connective_text)

    unit = {
        "unit_id": unit_proposal.get("unit_id"),
        "unit_type": unit_proposal.get("unit_type"),
        "text": " ".join(rendered_fragments),
        "status": unit_status if rendered_fragments else "NEEDS_REVIEW",
        "profile_evidence_ids": sorted(set(atom_evidence_ids)),
    }
    return {"unit": unit, "unsupported": unsupported}


def _render_job_reference_atom(atom: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """Validate and render a job_reference atom from resolved job evidence text.

    job_reference atoms never assert a candidate fact -- they motivate why a
    requirement matters (e.g. "the role requires X"). The rendered text is the
    job evidence's own text field, never provider-authored, never a profile
    claim.
    """

    job_ids = atom.get("job_evidence_ids", [])
    if not job_ids:
        return {"status": "UNSUPPORTED", "text": None, "reason": "job reference atom requires job evidence"}
    fragments = []
    for job_id in job_ids:
        evidence = context["job_evidence_by_id"].get(job_id)
        if evidence is None:
            return {"status": "UNSUPPORTED", "text": None, "reason": f"unknown job evidence id {job_id!r}"}
        fragments.append(evidence["text"])
    return {"status": "READY", "text": "; ".join(fragments)}


def _render_transferability_atom(match: dict[str, Any]) -> dict[str, Any]:
    """Render a transferability atom from Ticket 7's structured match fields only.

    Never reads match['rationale'] -- rationale is excluded from the renderer
    input boundary per the design (it was validated as "a reason a match
    holds," not as safe-to-quote candidate-facing prose).
    """

    limitations = "; ".join(match.get("limitations", []))
    suffix = f" (Limitations: {limitations})" if limitations else ""
    return {"text": f"Transferable capability supported by extension mapping{suffix}"}


def _stable_id(prefix: str, value: str) -> str:
    return f"{prefix}_{hashlib.sha256(value.encode('utf-8')).hexdigest()[:16]}"

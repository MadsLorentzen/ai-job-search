"""Versioned vocabulary of semantic subjects a resolved blocker answer can
be about (Phase 4C spec §3), plus the one deterministic classifier that
maps requirement text into that vocabulary.

This is the product-level contract: what subjects exist, and what each
denotes. Adding a new subject (salary, relocation, language proficiency,
security clearance, etc.) is a new registry entry; changing what an
existing key denotes, or reusing a key for an unrelated concept, is a
breaking change and must be a new key instead.

classify_semantic_subject lives here rather than in
webapp/services/decision_policy.py (its original home, moved by a
corrective follow-up commit) because product/ (the domain layer) must
never depend on webapp/ (the orchestration layer) -- not even via a
function-local import. product/semantic_job_fit.py needs this exact
classifier (Phase 4C spec §8 point 4's target-side semantic-subject
check), and webapp/services/decision_policy.py needs it too (blocker
creation, spec §3). Colocating the registry (the product contract) and
the classifier (the one deterministic implementation that maps into it)
in the same product-level module avoids introducing a third module for a
two-function unit, and is consistent with spec §3's own framing:
"registry (product contract) <- classifier (implementation) maps into
it." webapp/services/decision_policy.py now imports
classify_semantic_subject from here (webapp depending on product is the
correct direction) and re-exports it for backward compatibility with
existing callers that import it from its old location.
"""

from __future__ import annotations

import re

SEMANTIC_SUBJECT_REGISTRY_VERSION = "v1"

SEMANTIC_SUBJECTS: dict[str, str] = {
    "work_authorization.right_to_work": (
        "Right to work in the target country, including citizenship-based eligibility."
    ),
    "work_authorization.sponsorship_required": (
        "Whether the candidate requires visa/work-permit sponsorship."
    ),
    "employment.notice_period": "The candidate's current notice period.",
    "licence.driving": "Whether the candidate holds a valid driving licence.",
}


def is_valid_semantic_subject(key: str | None) -> bool:
    if key is None:
        return False
    return key in SEMANTIC_SUBJECTS


# Duplicated from webapp/services/decision_policy.py's own
# _ATTESTATION_ACTION_PATTERN (which keeps its own copy for its unrelated
# caller, _is_stable_fact_requirement -- the scope-widening check behind
# _blocker_allowed_scopes). This is the SAME pattern, deliberately
# duplicated rather than shared via an import in either direction: the two
# callers are conceptually independent uses of "is this text an
# employer-specific attestation action, not a durable candidate fact,"
# and decision_policy.py must not import this module in a way that
# recreates a webapp<->product cross-dependency for a single regex.
# Changing this pattern's matching behavior must be mirrored in both
# copies -- see webapp/services/decision_policy.py's own copy for the
# other call site.
_ATTESTATION_ACTION_PATTERN = re.compile(
    r"\b(?:sign|disclose|complete|submit)\b.*\b(?:form|declaration|disclosure|pledge|attestation)\b"
    r"|\b(?:form|declaration|disclosure|pledge|attestation)\b.*\b(?:sign|disclose|complete|submit)\b"
    r"|\bviolations?\b",
    re.IGNORECASE,
)

# Each family maps to exactly one of this module's own SEMANTIC_SUBJECTS
# keys. This mapping lives in the classifier, deliberately separate from
# the registry dict itself (spec §3): changing or adding a pattern here
# never redefines what a registry key means, and SEMANTIC_SUBJECTS' four
# initial keys are the authority on which values classify_semantic_subject
# may ever return.
_SEMANTIC_SUBJECT_PATTERNS: tuple[tuple[re.Pattern, str], ...] = (
    (re.compile(r"\bright to work\b", re.IGNORECASE), "work_authorization.right_to_work"),
    (re.compile(r"\bcitizen(?:ship)?\b", re.IGNORECASE), "work_authorization.right_to_work"),
    (re.compile(r"\bsponsorship\b", re.IGNORECASE), "work_authorization.sponsorship_required"),
    (re.compile(r"\bvisa\b", re.IGNORECASE), "work_authorization.sponsorship_required"),
    (re.compile(r"\bwork permit\b", re.IGNORECASE), "work_authorization.sponsorship_required"),
    (re.compile(r"\bdriv(?:ing|er'?s) licen[sc]e\b", re.IGNORECASE), "licence.driving"),
    (re.compile(r"\bnotice period\b", re.IGNORECASE), "employment.notice_period"),
)


def classify_semantic_subject(blocker_type: str, requirement_texts: list[str]) -> str | None:
    """Map gate requirement text to a SEMANTIC_SUBJECTS key, or None
    (Phase 4C spec §3). Dimension blockers never classify (rule 1).
    Attestation-action text is excluded before matching (rule 4, mirrors
    webapp/services/decision_policy.py's _is_stable_fact_requirement's own
    exclusion). Text matching more than one registry family classifies to
    None (rule 3) -- Phase 4C has no per-fact decomposition of a single
    gate's evidence.

    Pure text/regex logic -- no I/O, no webapp import. Moved verbatim
    (logic unchanged) from webapp/services/decision_policy.py by a
    corrective follow-up commit; see this module's own docstring for why.
    """

    if blocker_type != "gate_flag":
        return None

    matched_keys: set[str] = set()
    for text in requirement_texts:
        if _ATTESTATION_ACTION_PATTERN.search(text):
            continue
        for pattern, registry_key in _SEMANTIC_SUBJECT_PATTERNS:
            if pattern.search(text):
                matched_keys.add(registry_key)

    if len(matched_keys) != 1:
        return None
    (key,) = matched_keys
    assert key in SEMANTIC_SUBJECTS  # registry is the authority; classifier must never invent a key
    return key

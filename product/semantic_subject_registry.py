"""Versioned vocabulary of semantic subjects a resolved blocker answer can
be about (Phase 4C spec §3). This is the product-level contract: what
subjects exist, and what each denotes. The deterministic classifier in
webapp/services/decision_policy.py maps requirement text into these keys
(or NULL) -- it does not define them. Adding a new subject (salary,
relocation, language proficiency, security clearance, etc.) is a new
registry entry; changing what an existing key denotes, or reusing a key
for an unrelated concept, is a breaking change and must be a new key
instead."""

from __future__ import annotations

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

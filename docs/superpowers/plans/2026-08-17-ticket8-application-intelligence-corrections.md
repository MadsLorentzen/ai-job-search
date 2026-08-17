# Ticket 8 Application Intelligence — Correction Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five categories of real defects in the already-implemented (uncommitted) Ticket 8 code, found by PM review of the actual working tree: a fake Ticket 7 seam (fixtures don't match the real contract), an incomplete result envelope (missing 6 of 7 approved sections), evidence-rendering bugs that let bare skill claims assert unearned experience and let unrelated evidence cross-strengthen facts, dropped transferability provenance and weak policy validation, and an unhardened provider-proposal boundary that still has the two previously-parked findings.

**Architecture:** No redesign. This corrects the existing `product/application_intelligence.py` / `product/application_intelligence_providers.py` / `product/openai_application_intelligence_provider.py` modules and their tests/fixtures in place, replacing invented fixtures with real Ticket 7 output, replacing the flat `content_units` result with the full seven-section contract, replacing the single-ordinal strength ladder with per-template structural-linkage predicates, and adding a proposal-shape validation pass before adjudication.

**Tech Stack:** Python 3.11+ stdlib, `pytest`/`unittest`, reuses `product.semantic_job_fit` (Ticket 7) and `product.job_fit` (v0) functions directly rather than re-deriving their logic.

## Global Constraints

- This is a correction pass, not a redesign. Do not add scope beyond the 5 categories below plus the final verification task.
- Still no changes to any Ticket 1–7 file (`product/profile_snapshot.py`, `product/extensions.py`, `product/job_posting.py`, `product/job_understanding.py`, `product/job_understanding_providers.py`, `product/openai_job_understanding_provider.py`, `product/evaluation_policy.py`, `product/job_fit.py`, `product/semantic_job_fit.py`, their schemas/policies, or their tests). Every task only modifies Ticket 8's own files.
- No commits until explicit separate PM authorization — same as before. Ledger tracks task completion state, not commit SHAs (per the prior correction-policy override, still in force).
- Ticket 7's real `Job Fit Result v1` has exactly these 21 top-level fields (verified against `product/semantic_job_fit.py:414-441`): `schema_version`, `request_id`, `profile_snapshot`, `job_snapshot`, `resolved_job_evidence`, `active_extension_versions`, `evaluation_policy_version`, `semantic_fit_policy`, `gate_assessments`, `gate_results`, `direct_matches`, `functionally_equivalent_matches`, `transferable_matches`, `gaps`, `unsupported_claims`, `human_judgment_questions`, `dimension_assessments`, `dimension_scores`, `overall_score`, `verdict`, `blocked`, `blocking_gate_ids`, `status`, `notes`. Ticket 8's shape validator must accept exactly this set, not a reduced one.
- `verdict` is `None` or a dict `{"id": str, "display_name": str, "score": float}` (from `product/evaluation_policy.py::classify_verdict`, lines 172-193), never a bare string. Every place Ticket 8 reads a verdict value must read `verdict["id"]` after a `None`-check.
- The real verdict id vocabulary is `poor_fit`, `weak_fit`, `moderate_fit`, `good_fit`, `strong_fit` — loaded at runtime from `product/evaluation-policy.v0.json`'s `verdict_thresholds`, never hardcoded as a Python literal set.
- `job_fit_result["profile_snapshot"]` is `{"schema_version": str, "content_id": str}` (Ticket 7's `_profile_identity`, `semantic_job_fit.py:1322-1326`) — content_id computed as `profilesnap_<sha256[:20]>` over canonical JSON of the full profile snapshot dict. This is identical to `product.job_fit.profile_snapshot_content_id`'s output (same prefix, same algorithm) — reuse that public function, do not duplicate the hash logic for the profile check.
- `job_fit_result["resolved_job_evidence"]` is `{"schema_version": str, "content_id": str}` (Ticket 7's `_bundle_identity`, `semantic_job_fit.py:1337-1341`) — content_id computed as `resolvedjobev_<sha256[:20]>` over canonical JSON of the full resolved-evidence-bundle dict. No public function for this exists outside `semantic_job_fit.py` (only a private `_bundle_identity`/`_content_id`); Task 1 adds one small local helper in `application_intelligence.py` replicating the exact same algorithm (this mirrors the existing pattern: `job_fit.py` and `semantic_job_fit.py` already each have their own private `_content_id` doing the identical canonical-JSON-SHA256 computation — a third copy for the one prefix Ticket 8 needs is consistent with, not a deviation from, established practice).
- Full suite baseline before this correction pass: 609 passed, 1 skipped (Ticket 8's prior — now-being-corrected — implementation). This baseline itself is not trustworthy for regression comparison since the fixtures it validated against were wrong; the number to watch is that Ticket 1-7's own suites (`tests/test_semantic_job_fit.py`, `tests/test_job_fit.py`, and the rest) remain unchanged in pass count throughout, since this plan touches no Ticket 1-7 file.

---

## File Structure

```
product/
  application_intelligence.py                  [heavily modified — same file, most tasks touch it]
  openai_application_intelligence_provider.py   [modified — Task 5 proposal-shape enums may need schema additions]
tests/
  fixtures/application_intelligence/
    job-fit-result-ready.json                   [REPLACED with real Ticket 7 output]
    job-fit-result-blocked.json                 [REPLACED with real Ticket 7 output]
    job-fit-result-needs-review.json             [REPLACED with real Ticket 7 output]
    generate_fixtures.py                         [NEW — one-time generation script, kept for reproducibility/documentation]
  test_application_intelligence.py               [heavily modified — new tests throughout]
  test_application_intelligence_providers.py     [modified — proposal-shape validation tests]
```

No new production files. All changes are within Ticket 8's existing five files plus its fixtures.

---

### Task 1: Fix the Real Ticket 7 Seam

**Files:**
- Modify: `product/application_intelligence.py` (`_validate_consumed_job_fit_result_shape`, `_compute_recommendation`, `validate_application_intelligence_request` — add upstream-identity staleness check, add `_bundle_content_id` helper, add import of `product.job_fit.profile_snapshot_content_id` and `product.evaluation_policy.load_evaluation_policy`)
- Create: `tests/fixtures/application_intelligence/generate_fixtures.py`
- Modify (replace content): `tests/fixtures/application_intelligence/job-fit-result-ready.json`, `job-fit-result-blocked.json`, `job-fit-result-needs-review.json`
- Modify: `tests/test_application_intelligence.py` (fix `application_intelligence_request` helper to also supply `job_snapshot`-derived identity where needed; add new `TestRealTicket7Seam` integration test class)

**Interfaces:**
- Consumes: `product.job_fit.profile_snapshot_content_id(profile: dict) -> str` (public, existing). `product.evaluation_policy.load_evaluation_policy() -> dict` (public, existing, used to load `verdict_thresholds` for later tasks too — imported here since this task first needs the real verdict vocabulary for `_compute_recommendation`'s dict-access fix, even though full policy validation is Task 4).
- Produces: `_bundle_content_id(bundle: dict) -> str` (new local helper, mirrors `job_fit.py`'s `_content_id` pattern with prefix `"resolvedjobev"`); `_validate_upstream_identity(request: dict, errors: list[str]) -> None` (new, checks `job_fit_result["profile_snapshot"]["content_id"]` matches `profile_snapshot_content_id(request["profile_snapshot"])`, and `job_fit_result["resolved_job_evidence"]["content_id"]` matches `_bundle_content_id(request["resolved_job_evidence"])`). Consumed by `validate_application_intelligence_request`. `_compute_recommendation`'s corrected verdict-dict-aware logic is consumed by all later tasks (unchanged signature).

**Why fixtures must be generated, not hand-authored:** Ticket 7's result is produced by `analyze_semantic_job_fit`, which computes `dimension_assessments`, `gate_assessments`, `overall_score`, and `verdict` deterministically from policy + evidence + proposals — these are not values a human can safely invent by hand without risking exactly the kind of drift this correction pass exists to fix. Generating them by calling the real function is the only way to guarantee the fixture matches the real contract, now and after any future Ticket 7 change.

- [ ] **Step 1: Write the fixture-generation script**

Create `tests/fixtures/application_intelligence/generate_fixtures.py`:

```python
#!/usr/bin/env python3
"""One-time generator for Ticket 8's Job Fit Result v1 fixtures.

Run manually with `python -m tests.fixtures.application_intelligence.generate_fixtures`
whenever these fixtures need to be regenerated (e.g. after a Ticket 7 contract
change). The output JSON is committed as a frozen fixture -- this script is not
executed by the test suite itself, only by a human/agent regenerating fixtures.

These fixtures are GENERATED, not hand-authored, specifically so they always
match Ticket 7's real analyze_semantic_job_fit output shape rather than a
maintainer's guess at that shape.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

from product.semantic_job_fit import (
    analyze_semantic_job_fit,
    build_resolved_job_evidence_bundle,
    build_semantic_job_fit_request,
)

from tests.test_semantic_job_fit import (
    fully_scoring_policy,
    proposals_for_full_fit,
    ready_candidate,
    rich_profile,
    understanding_pair,
)

OUTPUT_DIR = Path(__file__).parent


def _base_bundle_and_profile() -> tuple[dict, dict, dict]:
    """Build one real, evidence-rich Ticket 7 request/result pair.

    Reuses tests/test_semantic_job_fit.py's own fixture-building helpers so
    this fixture is generated through the exact same path Ticket 7's own
    tests trust, not a separate reimplementation.
    """

    request_understanding, result_understanding = understanding_pair()
    job = request_understanding["job_snapshot"] if isinstance(request_understanding, dict) and "job_snapshot" in request_understanding else None
    # understanding_pair() takes job=None by default and builds its own job
    # snapshot internally via job_snapshot(); recover the actual job snapshot
    # used so the resolved evidence bundle is built against the same object.
    from tests.test_semantic_job_fit import job_snapshot as _job_snapshot_fixture
    job = _job_snapshot_fixture()

    bundle = build_resolved_job_evidence_bundle(job, request_understanding, result_understanding)
    profile = rich_profile()
    return job, bundle, profile


def build_ready_result() -> dict:
    job, bundle, profile = _base_bundle_and_profile()
    proposals = proposals_for_full_fit(bundle)
    request = build_semantic_job_fit_request(
        request_id="appintel-fixture-ready",
        profile_snapshot=profile,
        job_snapshot=job,
        resolved_job_evidence=bundle,
        evaluation_policy=fully_scoring_policy(),
        user_intent={"intent": "evaluate_with_transferability"},
        semantic_proposals=proposals,
    )
    return analyze_semantic_job_fit(request)


def build_blocked_result() -> dict:
    job, bundle, profile = _base_bundle_and_profile()
    # No eligibility/language/location_logistics gate proposals supplied at all
    # -> every gate defaults to UNVERIFIED -> not a hard FAIL block by default
    # in Ticket 7's gate policy, so force an explicit FAIL gate proposal with
    # supporting evidence to produce a genuinely blocked result.
    work_id = next(
        item["id"] for item in bundle["evidence"]
        if item["text"] == "Applicants must already have the right to work in the UK."
    )
    proposals = {
        "matches": [],
        "gates": [
            {
                "gate_id": "eligibility",
                "status": "FAIL",
                "reason": "Candidate lacks the required right-to-work evidence.",
                "job_evidence_ids": [work_id],
                "profile_evidence_ids": ["clm_4444444444444444"],
            },
        ],
    }
    request = build_semantic_job_fit_request(
        request_id="appintel-fixture-blocked",
        profile_snapshot=profile,
        job_snapshot=job,
        resolved_job_evidence=bundle,
        evaluation_policy=fully_scoring_policy(),
        user_intent={"intent": "evaluate_with_transferability"},
        semantic_proposals=proposals,
    )
    return analyze_semantic_job_fit(request)


def build_needs_review_result() -> dict:
    job, bundle, profile = _base_bundle_and_profile()
    pipeline_id = next(
        item["id"] for item in bundle["evidence"]
        if item["text"] == "Build reliable data pipelines."
    )
    proposals = {
        "matches": [
            {
                "proposal_id": "sem-pipelines-transfer",
                "job_evidence_id": pipeline_id,
                "profile_evidence_ids": ["clm_2222222222222222"],
                "classification": "transferable",
                "rationale": "Pipeline building responsibility transfers via extension mapping.",
                "confidence": "medium",
                "extension_ref": {
                    "extension_id": "data-engineering-knowledge",
                    "extension_version": "0.1.0",
                    "record_type": "transferable_mapping",
                    "record_id": "map-pipelines-to-etl",
                },
            },
        ],
        "gates": [],
    }
    request = build_semantic_job_fit_request(
        request_id="appintel-fixture-needs-review",
        profile_snapshot=profile,
        job_snapshot=job,
        resolved_job_evidence=bundle,
        evaluation_policy=fully_scoring_policy(),
        user_intent={"intent": "evaluate_with_transferability"},
        semantic_proposals=proposals,
    )
    return analyze_semantic_job_fit(request)


def main() -> None:
    for name, builder in (
        ("job-fit-result-ready.json", build_ready_result),
        ("job-fit-result-blocked.json", build_blocked_result),
        ("job-fit-result-needs-review.json", build_needs_review_result),
    ):
        result = builder()
        (OUTPUT_DIR / name).write_text(
            json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(f"wrote {name}: status={result['status']!r} blocked={result['blocked']!r} verdict={result.get('verdict')!r}")


if __name__ == "__main__":
    main()
```

**Note for the implementer:** this script requires an `extension_ref` pointing at `data-engineering-knowledge`/`map-pipelines-to-etl` for the needs-review case's transferable match — but Ticket 8's fixtures have no `active_extensions` supplied to the Ticket 7 request above, so this match will be rejected by Ticket 7's own adjudication (`_transferable_mapping` returns `None` for an unknown extension), landing as an `unsupported_claims`/gap entry instead of a `transferable_matches` entry. **This is fine and actually more realistic** — but if you want a fixture that genuinely exercises a `NEEDS_REVIEW` transferable match with real `conditions`, you need to also build and pass a minimal valid extension package as `active_extensions=[...]` in `build_semantic_job_fit_request`. Check `product/extensions.py`'s `validate_extension` for the minimal required shape (needs `schema_version`, `id`, `name`, `version`, `status`, `description`, `publisher`, `trust`, `metadata`, `scope`, plus a `transferable_mappings` entry with `id="map-pipelines-to-etl"`, a `source`/`target` endpoint pair using `concept` keys (not `competency_id`, to avoid needing a competency record too), `rationale`, `transfer_strength`, and a non-empty `conditions` list e.g. `["Requires evidence of supervisory scope."]`). Build this minimal extension dict directly in the script if needed — do not import extension fixtures from another ticket's tests if none conveniently exist; construct the smallest valid one inline. Run the script, inspect the actual output's `status`/`transferable_matches` to confirm you got a genuine `NEEDS_REVIEW` result with a transferable match present, and iterate the proposal until you do. This is expected exploratory work for this step — the exact proposal shape needed depends on how Ticket 7's adjudication resolves it, which you must observe, not predict.

- [ ] **Step 2: Run the generation script and inspect output**

Run: `python -m tests.fixtures.application_intelligence.generate_fixtures`
Expected: three JSON files written; console output shows `status`, `blocked`, `verdict` for each. Manually inspect each generated file:
- `job-fit-result-ready.json` should have `"status": "READY"`, `"blocked": false`, and a non-null `"verdict"` object with a real `"id"` (one of the 5 verdict ids).
- `job-fit-result-blocked.json` should have `"blocked": true` and a non-empty `"blocking_gate_ids"`.
- `job-fit-result-needs-review.json` should have `"status": "NEEDS_REVIEW"`.

If any of these don't hold, adjust the proposal data in Step 1 and regenerate — do not hand-edit the generated JSON afterward.

- [ ] **Step 3: Confirm the generated fixtures validate against Ticket 7's own validator**

Run:
```
python -c "
import json
from pathlib import Path
from product.semantic_job_fit import validate_semantic_job_fit_result, build_semantic_job_fit_request
# Re-validation requires the original request, which the fixture alone doesn't carry.
# Instead, just confirm each fixture is well-formed JSON with the expected top-level keys.
expected_keys = {
    'schema_version', 'request_id', 'profile_snapshot', 'job_snapshot', 'resolved_job_evidence',
    'active_extension_versions', 'evaluation_policy_version', 'semantic_fit_policy',
    'gate_assessments', 'gate_results', 'direct_matches', 'functionally_equivalent_matches',
    'transferable_matches', 'gaps', 'unsupported_claims', 'human_judgment_questions',
    'dimension_assessments', 'dimension_scores', 'overall_score', 'verdict', 'blocked',
    'blocking_gate_ids', 'status', 'notes',
}
for name in ('job-fit-result-ready.json', 'job-fit-result-blocked.json', 'job-fit-result-needs-review.json'):
    data = json.loads((Path('tests/fixtures/application_intelligence') / name).read_text())
    missing = expected_keys - set(data.keys())
    extra = set(data.keys()) - expected_keys
    assert not missing, f'{name} missing keys: {missing}'
    assert not extra, f'{name} has unexpected keys: {extra}'
    print(f'{name}: OK, {len(data)} keys, verdict={data.get(\"verdict\")}')
"
```
Expected: all three print `OK`, confirming they carry the real 21-key Ticket 7 shape.

- [ ] **Step 4: Fix `_validate_consumed_job_fit_result_shape` to accept the real shape**

In `product/application_intelligence.py`, replace the existing `_validate_consumed_job_fit_result_shape` (currently lines 128-138) with:

```python
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
```

Note: `RESULT_STATUSES` here refers to Ticket 8's own `unitStatus`/`resultStatus`-style enum already loaded from Ticket 8's schema (`SCHEMA["$defs"]["resultStatus"]["enum"]`, i.e. `{"READY", "NEEDS_REVIEW", "UNAVAILABLE"}`). Ticket 7's actual `status` field uses a **different**, wider enum (`SEMANTIC_STATUSES` in `semantic_job_fit.py`: `{"READY", "NEEDS_REVIEW", "UNAVAILABLE", "UNSUPPORTED"}`). Check this before reusing `RESULT_STATUSES` for validating `job_fit_result["status"]` — if `"UNSUPPORTED"` is a value Ticket 7 can actually produce at top level (check `_result_status` in `semantic_job_fit.py:1282-1293` — it only returns `UNAVAILABLE`/`NEEDS_REVIEW`/`READY`, never `UNSUPPORTED` at the top-level `status` field, so `RESULT_STATUSES` as currently defined for Ticket 8 is actually correct here and no change is needed on this specific point — this note exists so you verify it explicitly rather than assume).

Add near the top of `product/application_intelligence.py`, in the imports section:

```python
from product.evaluation_policy import load_evaluation_policy
from product.job_fit import profile_snapshot_content_id
```

- [ ] **Step 5: Add the upstream-identity staleness check**

In `product/application_intelligence.py`, add:

```python
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
```

Then wire it into `validate_application_intelligence_request` (currently lines 91-110) by adding one call after the existing `_validate_resolved_job_evidence_shape` call:

```python
    _validate_resolved_job_evidence_shape(request.get("resolved_job_evidence"), errors)
    _validate_upstream_identity(request, errors)
```

- [ ] **Step 6: Fix `_compute_recommendation` to read `verdict["id"]`**

In `product/application_intelligence.py`, replace the current `_compute_recommendation` body's verdict handling (currently `verdict = job_fit_result.get("verdict")` at line 151, used raw at line 157) with:

```python
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
```

- [ ] **Step 7: Fix the test helper that builds Ticket 8 requests from fixtures**

In `tests/test_application_intelligence.py`, the existing `application_intelligence_request` helper function needs no signature change, but every test that previously asserted a bare-string verdict (e.g. `self.assertEqual(fixture("job-fit-result-ready.json")["verdict"], "strong_fit")` in `TestFixturesLoad`, and any exhaustive-table test in `TestComputeRecommendation` that constructed `{"verdict": "strong_fit", ...}` fake dicts) must be updated to use the dict shape. Specifically:

Find and fix `TestFixturesLoad.test_all_fixtures_parse_as_json_with_expected_status` — change:
```python
        self.assertEqual(fixture("job-fit-result-ready.json")["verdict"], "strong_fit")
```
to:
```python
        self.assertIsInstance(fixture("job-fit-result-ready.json")["verdict"], dict)
        self.assertIn(fixture("job-fit-result-ready.json")["verdict"]["id"], {"poor_fit", "weak_fit", "moderate_fit", "good_fit", "strong_fit"})
```
(Do not assert a specific verdict id here since it now depends on the real scoring computation from Step 1's generation — assert the shape and that it's a valid id, not a specific value, unless Step 2's manual inspection confirmed a specific stable value, in which case assert that exact value instead for a tighter test.)

Find and fix `TestComputeRecommendation`'s exhaustive 9-case table test (`test_every_status_verdict_blocked_combination_is_covered`) — it currently builds fake job_fit_result dicts like `{"blocked": False, "status": "READY", "verdict": "strong_fit"}`. Change every such literal to the dict shape:
```python
def _fake_verdict(verdict_id):
    return None if verdict_id is None else {"id": verdict_id, "display_name": verdict_id, "score": 50.0}
```
and use `"verdict": _fake_verdict("strong_fit")` etc. in each of the 9 cases. Also update `test_blocked_is_always_do_not_proceed`, `test_needs_review_is_proceed_with_review`, `test_ready_strong_fit_is_proceed`, and `test_no_matching_rule_raises` similarly wherever they construct fake `job_fit_result` dicts with a bare-string verdict.

- [ ] **Step 8: Write the real-seam integration test**

Add to `tests/test_application_intelligence.py`:

```python
class TestRealTicket7Seam(unittest.TestCase):
    """Proves analyze_application_intelligence works against a genuine Ticket 7
    result built through Ticket 7's own functions, not a hand-built fixture."""

    def test_real_ticket7_result_is_accepted_and_produces_a_result(self):
        from product.semantic_job_fit import (
            analyze_semantic_job_fit,
            build_resolved_job_evidence_bundle,
            build_semantic_job_fit_request,
        )
        from tests.test_semantic_job_fit import (
            fully_scoring_policy,
            job_snapshot,
            proposals_for_full_fit,
            rich_profile,
            understanding_pair,
        )

        job = job_snapshot()
        request_understanding, result_understanding = understanding_pair(job=job)
        bundle = build_resolved_job_evidence_bundle(job, request_understanding, result_understanding)
        profile = rich_profile()
        proposals = proposals_for_full_fit(bundle)
        ticket7_request = build_semantic_job_fit_request(
            request_id="real-seam-test",
            profile_snapshot=profile,
            job_snapshot=job,
            resolved_job_evidence=bundle,
            evaluation_policy=fully_scoring_policy(),
            user_intent={"intent": "evaluate_with_transferability"},
            semantic_proposals=proposals,
        )
        ticket7_result = analyze_semantic_job_fit(ticket7_request)

        ticket8_request = {
            "schema_version": "application-intelligence-request.v0",
            "request_id": "appintel-real-seam",
            "job_fit_result": ticket7_result,
            "resolved_job_evidence": bundle,
            "profile_snapshot": profile,
            "policy": DEFAULT_POLICY,
        }

        result = analyze_application_intelligence(ticket8_request, None)

        self.assertIn(result["recommendation"], {"proceed", "proceed_with_review", "do_not_proceed"})
        self.assertIn(result["status"], {"READY", "NEEDS_REVIEW", "UNAVAILABLE"})

    def test_stale_profile_snapshot_is_rejected(self):
        from product.semantic_job_fit import (
            analyze_semantic_job_fit,
            build_resolved_job_evidence_bundle,
            build_semantic_job_fit_request,
        )
        from tests.test_semantic_job_fit import (
            fully_scoring_policy,
            job_snapshot,
            proposals_for_full_fit,
            rich_profile,
            understanding_pair,
        )

        job = job_snapshot()
        request_understanding, result_understanding = understanding_pair(job=job)
        bundle = build_resolved_job_evidence_bundle(job, request_understanding, result_understanding)
        profile = rich_profile()
        proposals = proposals_for_full_fit(bundle)
        ticket7_request = build_semantic_job_fit_request(
            request_id="stale-test",
            profile_snapshot=profile,
            job_snapshot=job,
            resolved_job_evidence=bundle,
            evaluation_policy=fully_scoring_policy(),
            user_intent={"intent": "evaluate_with_transferability"},
            semantic_proposals=proposals,
        )
        ticket7_result = analyze_semantic_job_fit(ticket7_request)

        # Mutate the profile AFTER Ticket 7 evaluated it -- simulates a caller
        # supplying stale/changed evidence alongside an old Ticket 7 result.
        stale_profile = copy.deepcopy(profile)
        stale_profile["claims"].append(
            {
                "id": "clm_9999999999999998",
                "record_id": "rec_9999999999999998",
                "concept_id": "cpt_9999999999999998",
                "category": "skills",
                "field": "technical_skill",
                "value": "Rust",
                "source": {"file": "CLAUDE.md", "section": "Technical Skills", "line_start": 99, "line_end": 99},
                "placeholder": False,
                "confidence": "high",
                "extraction_status": "explicit",
            }
        )
        stale_profile["summary"]["claim_count"] = len(stale_profile["claims"])

        ticket8_request = {
            "schema_version": "application-intelligence-request.v0",
            "request_id": "appintel-stale",
            "job_fit_result": ticket7_result,
            "resolved_job_evidence": bundle,
            "profile_snapshot": stale_profile,
            "policy": DEFAULT_POLICY,
        }

        with self.assertRaises(ApplicationIntelligenceValidationError) as ctx:
            analyze_application_intelligence(ticket8_request, None)
        self.assertTrue(any("stale or mismatched" in error for error in ctx.exception.errors))
```

- [ ] **Step 9: Run the targeted test file**

Run: `python -m pytest tests/test_application_intelligence.py -v`
Expected: all tests pass, including the two new `TestRealTicket7Seam` tests and the corrected verdict-dict tests. Some tests from the prior implementation may still reference the old fixtures' bare-string verdicts elsewhere in the file — search for any remaining `"verdict"` string literals you haven't yet fixed and correct them the same way as Step 7.

- [ ] **Step 10: Do not commit**

---

### Task 2: Implement the Full Approved Result Contract

**Files:**
- Modify: `product/application_intelligence.py` (`analyze_application_intelligence`, add `validate_application_intelligence_result`, add `_build_positioning`, restructure how content units populate `cv_content`/`cover_letter_content`)
- Modify: `tests/test_application_intelligence.py` (update all existing tests that assert on the old flat `content_units` result shape; add new tests for the seven-section contract)

**Interfaces:**
- Consumes: `_adjudicate_content_unit` (from the existing Task 6 code, unchanged internally), `job_fit_result`'s `direct_matches`/`functionally_equivalent_matches`/`transferable_matches`/`gaps`/`human_judgment_questions` (real Ticket 7 shape, per Task 1).
- Produces: the new result shape (below), `validate_application_intelligence_result(request: dict, result: dict) -> None`.

**New result shape** (Application Intelligence Result v0, per the frozen design's seven sections):

```python
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
    "positioning": positioning,       # see _build_positioning below
    "cv_emphasis_plan": cv_emphasis_plan,
    "cv_content": cv_content,          # content units with unit_type in {"cv_bullet", "cv_summary_line"}
    "cover_letter_plan": cover_letter_plan,
    "cover_letter_content": cover_letter_content,  # unit_type == "cover_letter_paragraph" or "positioning_statement"
    "unsupported_claims": unsupported_claims,
    "status": result_status,
    "notes": [],
}
```

- [ ] **Step 1: Write the positioning builder**

Add to `product/application_intelligence.py`:

```python
def _build_positioning(job_fit_result: dict[str, Any]) -> dict[str, Any]:
    """Build the positioning section directly from Ticket 7's own STRUCTURED
    records -- never from match['rationale'].

    PM ruling (2026-08-17): rationale is excluded from positioning too, not
    just from rendered cv_content/cover_letter_content. There is one uniform
    rule across the whole Application Intelligence Result: rationale was
    validated by Ticket 7 as "a reason a match holds," not as safe-to-surface
    text anywhere in Ticket 8's output, rendered or summarized. Positioning
    entries carry structured provenance (match/gap/question ids,
    classification, evidence ids, status/limitations/conditions where
    relevant) instead of prose text. A future consumer (e.g. Ticket 9) that
    wants human-readable strength descriptions renders them from this
    structured data using the same evidence-preserving template mechanism as
    cv_content/cover_letter_content -- positioning is not a second,
    unguarded prose channel.

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
```

This closes the question I flagged before implementation started: the PM ruled that positioning must avoid `rationale` entirely, matching the uniform rule already enforced for `cv_content`/`cover_letter_content`. No rendered-vs-summary carve-out exists anywhere in the result contract.

- [ ] **Step 2: Write `_job_fit_result_content_id`**

Add to `product/application_intelligence.py`:

```python
def _job_fit_result_content_id(job_fit_result: dict[str, Any]) -> str:
    """Content-derived identifier for the exact consumed Job Fit Result.

    Lets a downstream consumer (e.g. Ticket 9) detect if the Application
    Intelligence Result was built against a Job Fit Result that has since
    changed, the same staleness-detection pattern used throughout Tickets 1-7.
    """

    canonical = json.dumps(job_fit_result, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return f"jobfitresult_{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:20]}"
```

- [ ] **Step 3: Restructure `analyze_application_intelligence` to populate the full contract**

Replace the current `analyze_application_intelligence` body (from `content_units: list[dict[str, Any]] = []` through the `return result` at the end, currently lines 419-441) with:

```python
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
    result_status = "READY"
    if job_fit_result["blocked"] or job_fit_result["status"] == "UNAVAILABLE":
        result_status = "UNAVAILABLE"
    elif job_fit_result["status"] == "NEEDS_REVIEW" or any(unit["status"] != "READY" for unit in all_units) or unsupported_claims:
        result_status = "NEEDS_REVIEW"

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
        "cv_emphasis_plan": (proposal or {}).get("cv_emphasis_plan", []),
        "cv_content": cv_content,
        "cover_letter_plan": (proposal or {}).get("cover_letter_plan", []),
        "cover_letter_content": cover_letter_content,
        "unsupported_claims": unsupported_claims,
        "status": result_status,
        "notes": [],
    }
    validate_application_intelligence_result(request, result)
    return result
```

Note: `cv_emphasis_plan` and `cover_letter_plan` are currently pass-through from the proposal with no local validation beyond basic list-of-dicts shape (added in Step 4's `validate_application_intelligence_result`). These are lower-stakes than `cv_content`/`cover_letter_content` because they're *plans* (which evidence to emphasize and in what order), not rendered candidate-facing prose — but if either field's proposal-shape entries reference invalid evidence ids, that is still worth catching structurally. Task 5 (proposal-shape hardening) adds this validation; this task only wires the pass-through and the result contract shape.

- [ ] **Step 4: Write `validate_application_intelligence_result`**

Add to `product/application_intelligence.py`:

```python
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
        "status", "notes",
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

    if errors:
        raise ApplicationIntelligenceValidationError(errors)
```

- [ ] **Step 5: Update every test that asserts on the old flat result shape**

Search `tests/test_application_intelligence.py` for every place that does `result["content_units"]` and update to `result["cv_content"]` or `result["cover_letter_content"]` depending on the `unit_type` used in that test's proposal (check the `unit_type` field each test sets: `"cv_bullet"` → `cv_content`; `"cover_letter_paragraph"` → `cover_letter_content`). This affects (at minimum, verify against the actual current file): `TestBareSkillClaimCannotReachHandsOnTemplate` (uses `cv_bullet` → check `cv_content`), `TestJobReferenceAtom` (uses `cover_letter_paragraph` → check `cover_letter_content`), `TestRationaleNeverRendered` (uses `cover_letter_paragraph` → check `cover_letter_content`), `TestConnectiveGuard` (uses `cv_bullet` → check `cv_content`), `TestExtensionOnlyFactsRejected`, `TestMissingEvidenceDoesNotBecomeNegativeClaim`, `TestByteForByteReproducibility` (all use `cv_bullet` → check `cv_content`). `TestResultStatusPropagation.test_no_proposal_yields_empty_content_units` should be renamed to reflect the new shape and assert `result["cv_content"] == []` and `result["cover_letter_content"] == []` instead of `result["content_units"] == []`.

- [ ] **Step 6: Add tests for the new contract sections**

Append to `tests/test_application_intelligence.py`:

```python
class TestFullResultContract(unittest.TestCase):
    def test_result_has_all_seven_approved_sections(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        result = analyze_application_intelligence(request, None)
        for field in (
            "job_fit_result_ref", "profile_snapshot", "recommendation", "positioning",
            "cv_emphasis_plan", "cv_content", "cover_letter_plan", "cover_letter_content",
            "unsupported_claims", "status", "notes",
        ):
            self.assertIn(field, result, f"missing {field}")

    def test_positioning_direct_strengths_populated_from_real_ticket7_matches(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        result = analyze_application_intelligence(request, None)
        job_fit_result = fixture("job-fit-result-ready.json")
        expected_count = len(job_fit_result.get("direct_matches", []))
        self.assertEqual(len(result["positioning"]["direct_strengths"]), expected_count)

    def test_positioning_transferable_strengths_preserve_conditions_and_status(self):
        request = application_intelligence_request("job-fit-result-needs-review.json")
        result = analyze_application_intelligence(request, None)
        job_fit_result = fixture("job-fit-result-needs-review.json")
        ticket7_matches = job_fit_result.get("transferable_matches", [])
        if not ticket7_matches:
            self.skipTest("needs-review fixture has no transferable_matches to verify against")
        positioning_matches = result["positioning"]["transferable_strengths"]
        self.assertEqual(len(positioning_matches), len(ticket7_matches))
        for expected, actual in zip(ticket7_matches, positioning_matches):
            self.assertEqual(actual["conditions"], expected.get("conditions", []))
            self.assertEqual(actual["limitations"], expected.get("limitations", []))
            self.assertEqual(actual["status"], expected["status"])

    def test_validate_application_intelligence_result_accepts_own_output(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        result = analyze_application_intelligence(request, None)
        validate_application_intelligence_result(request, result)  # must not raise
```

- [ ] **Step 7: Run the targeted test file**

Run: `python -m pytest tests/test_application_intelligence.py -v`
Expected: all tests pass, including the four new `TestFullResultContract` tests.

- [ ] **Step 8: Do not commit**

---

### Task 3: Close Evidence-Rendering Defects

**Files:**
- Modify: `product/application_intelligence.py` (replace `STRENGTH_ORDER`/`_max_strength`/`_select_template`/`TEMPLATE_TABLE` eligibility mechanism with explicit per-template predicates; fix bare-skill `AS_CAPABILITY_STATEMENT` bug)
- Modify: `tests/test_application_intelligence.py` (add regression tests for cross-strengthening and the bare-skill neutral-wording fix)

**Interfaces:**
- Consumes: `_claim_strength_level`-equivalent structural facts (rebuilt below), `_linked_claims` (existing helper, unchanged).
- Produces: `TemplateEligibility` (a small dataclass or plain-dict spec replacing `TEMPLATE_TABLE`'s single `required_strength` field), `_atom_facts(claims: list[dict], all_claims: dict) -> dict[str, Any]` (new — computes a small structured fact bundle *per claim group*, not one scalar), `_select_template(assertion_type: str, rendering_variant: str, claims: list[dict], all_claims: dict) -> dict | None` (signature changes — now takes the actual claims, not a precomputed scalar).

**The core fix:** the current design computes one scalar "max strength" across all cited claims and compares it against a single required-strength threshold. This has two bugs: (1) it lets unrelated claims' strength leak onto each other via `max()`, and (2) `AS_CAPABILITY_STATEMENT` at `required_strength: "STATED"` lets a bare skill claim render `"Experience with {value}"`, which itself asserts experience — an unearned candidate fact — even though `"STATED"` was supposed to mean "no extra claim beyond the bare value."

**Replacement approach:** each template declares an explicit **eligibility predicate** over the *specific* claims cited for that atom, not a scalar comparison. Predicates check structural facts directly (same `record_id` linkage, specific `field` match) rather than computing an intermediate ordinal.

- [ ] **Step 1: Write the new eligibility-predicate mechanism**

Replace the current `STRENGTH_LEVELS`/`STRENGTH_ORDER` module-level constants (currently lines 42, 49) — **keep `STRENGTH_LEVELS` and the schema's `strengthLevel` enum as-is** (the schema/contract still names these tiers; only the comparison mechanism changes) but remove `STRENGTH_ORDER`'s use as a `>=` comparison for template eligibility. Replace the whole `TEMPLATE_TABLE`/`_claim_strength_level`/`_max_strength`/`_select_template` block (currently lines 209-310) with:

```python
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
        "eligible": lambda claims, all_claims: True,
        "format": "{value}",
    },
    ("technical_skill", "PLAIN"): {
        "eligible": lambda claims, all_claims: True,
        "format": "{value}",
    },
    ("technical_skill", "AS_CAPABILITY_STATEMENT"): {
        # Requires structural employment linkage -- a bare skill claim is no
        # longer eligible for this variant; it renders PLAIN only.
        "eligible": lambda claims, all_claims: any(
            _has_employment_linkage(claim, all_claims) for claim in claims
        ),
        "format": "Experience with {value}",
    },
    ("technical_skill", "AS_STRENGTH"): {
        "eligible": lambda claims, all_claims: any(
            _is_explicit_hands_on(claim, all_claims) for claim in claims
        ),
        "format": "Strong hands-on experience with {value}",
    },
    ("employment", "PLAIN"): {
        "eligible": lambda claims, all_claims: True,
        "format": "{value}",
    },
    ("responsibility", "PLAIN"): {
        "eligible": lambda claims, all_claims: True,
        "format": "{value}",
    },
    ("responsibility", "AS_STRENGTH"): {
        "eligible": lambda claims, all_claims: any(
            _is_explicit_hands_on(claim, all_claims) for claim in claims
        ),
        "format": "Hands-on delivery of {value}",
    },
    ("certification", "PLAIN"): {
        "eligible": lambda claims, all_claims: True,
        "format": "{value}",
    },
    ("language", "AS_CAPABILITY_STATEMENT"): {
        "eligible": lambda claims, all_claims: any(
            _is_explicit_proficiency(claim) for claim in claims
        ),
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
) -> dict[str, Any] | None:
    template = TEMPLATE_TABLE.get((assertion_type, rendering_variant))
    if template is None:
        return None
    if not template["eligible"](claims, all_claims):
        return None
    return template


def _validate_connective(text: str) -> bool:
    normalized = text.strip().lower()
    return normalized in CONNECTIVE_ALLOWLIST
```

Important: the `_is_explicit_hands_on` predicate checks each claim's OWN structural linkage individually (`any(...)` over the specific `claims` list passed for this atom, not `all_claims`) — this is the fix for cross-strengthening. If an atom cites two claims, only claims that individually satisfy the predicate make the atom eligible; a strong claim cannot "lend" its eligibility to an unrelated weak claim on the same atom, because the predicate is evaluated per-template against the whole `claims` list using `any()`, which is intentional: **at least one cited claim must independently satisfy the structural requirement** — but critically, this is different from the old `max()` approach because there is no shared scalar computed first that could be influenced by an unrelated claim's data. Re-read this carefully before implementing: `any(_is_explicit_hands_on(c, all_claims) for c in claims)` looks at each `c` independently and checks `c`'s own linkage via `_linked_claims(c, all_claims)` — a different claim `c2` in the same `claims` list cannot affect whether `c`'s predicate returns True. This is the structural fix.

- [ ] **Step 2: Update `_render_candidate_fact_atom` to use the new `_select_template` signature**

In `product/application_intelligence.py`, find the current `_render_candidate_fact_atom` (previously calling `_claim_strength_level`/`_max_strength` then `_select_template(atom["assertion_type"], atom["rendering_variant"], max_strength)`). Replace the strength-computation block:

```python
    max_strength = _max_strength(_claim_strength_level(claim, context["profile_by_id"]) for claim in claims)
    template = _select_template(atom["assertion_type"], atom["rendering_variant"], max_strength)
    if template is None:
        return {
            "status": "UNSUPPORTED",
            "text": None,
            "reason": (
                f"rendering_variant {atom['rendering_variant']!r} for assertion_type "
                f"{atom['assertion_type']!r} requires evidence strength unsupported by cited claims"
            ),
        }
```

with (this also folds in Task 5's parked-finding-2 fix — distinguishing "no template" from "template exists but ineligible" — since both fixes touch the same lines; implement both together here rather than touching this block twice across two tasks):

```python
    template_key = (atom["assertion_type"], atom["rendering_variant"])
    if template_key not in TEMPLATE_TABLE:
        return {
            "status": "UNSUPPORTED",
            "text": None,
            "reason": (
                f"no rendering template is registered for assertion_type "
                f"{atom['assertion_type']!r} with rendering_variant {atom['rendering_variant']!r}"
            ),
        }
    template = _select_template(atom["assertion_type"], atom["rendering_variant"], claims, context["profile_by_id"])
    if template is None:
        return {
            "status": "UNSUPPORTED",
            "text": None,
            "reason": (
                f"rendering_variant {atom['rendering_variant']!r} for assertion_type "
                f"{atom['assertion_type']!r} requires structural evidence linkage that the cited claims do not have"
            ),
        }
```

- [ ] **Step 3: Write the failing regression tests**

Append to `tests/test_application_intelligence.py`:

```python
class TestNoStrengthCrossLeakage(unittest.TestCase):
    def test_bare_skill_claim_cannot_get_capability_statement(self):
        """Regression for the fixed bug: bare technical_skill claims must not
        be able to render 'Experience with X' (AS_CAPABILITY_STATEMENT),
        which itself asserts unearned experience."""

        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-cap",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "technical_skill",
                            "profile_evidence_ids": ["clm_1111111111111111"],
                            "rendering_variant": "AS_CAPABILITY_STATEMENT",
                        }
                    ],
                    "connectives": [],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        self.assertEqual(result["cv_content"][0]["status"], "NEEDS_REVIEW")
        self.assertEqual(len(result["unsupported_claims"]), 1)
        self.assertIn("structural evidence linkage", result["unsupported_claims"][0]["reason"])

    def test_linked_skill_claim_can_get_capability_statement(self):
        """A technical_skill claim WITH employment linkage should still be
        eligible for AS_CAPABILITY_STATEMENT (positive control)."""

        request = application_intelligence_request("job-fit-result-ready.json")
        # clm_4444444444444444 is the linked responsibility claim in the
        # fixture; this test needs a technical_skill claim that IS linked --
        # if the current profile-snapshot fixture has no such claim, add one
        # (a technical_skill claim sharing record_id with the employment
        # record) to tests/fixtures/application_intelligence/profile-snapshot.json
        # as part of this step, and reference its id here.
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-linked-cap",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "technical_skill",
                            "profile_evidence_ids": ["clm_linked_python"],  # add this claim to the fixture
                            "rendering_variant": "AS_CAPABILITY_STATEMENT",
                        }
                    ],
                    "connectives": [],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        self.assertEqual(result["cv_content"][0]["status"], "READY")
        self.assertEqual(result["cv_content"][0]["text"], "Experience with Python")

    def test_unrelated_strong_claim_does_not_leak_into_weak_claim_eligibility(self):
        """Regression: an atom citing BOTH a strong (linked) claim and an
        unrelated weak (unlinked) claim for a DIFFERENT fact must not let the
        strong claim's eligibility apply to the weak one. Since each atom
        renders from claims[0] only (see _render_candidate_fact_atom), this
        test constructs two SEPARATE atoms citing different claims and
        confirms each is judged solely on its own evidence."""

        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-mixed",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            # Strong: linked responsibility claim.
                            "atom_id": "atom-strong",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "responsibility",
                            "profile_evidence_ids": ["clm_4444444444444444"],
                            "rendering_variant": "AS_STRENGTH",
                        },
                        {
                            # Weak: bare unlinked skill claim, same unit.
                            "atom_id": "atom-weak",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "technical_skill",
                            "profile_evidence_ids": ["clm_1111111111111111"],
                            "rendering_variant": "AS_STRENGTH",
                        },
                    ],
                    "connectives": [],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        # The unit overall is NEEDS_REVIEW because one atom failed, but
        # critically the failure must be the weak atom, not a false pass.
        self.assertEqual(result["cv_content"][0]["status"], "NEEDS_REVIEW")
        self.assertEqual(len(result["unsupported_claims"]), 1)
        self.assertIn("atom-weak", result["unsupported_claims"][0]["rejected_atom_ids"])
```

For the second test (`test_linked_skill_claim_can_get_capability_statement`), you must add a new claim to `tests/fixtures/application_intelligence/profile-snapshot.json`: a `technical_skill` claim sharing `record_id` with the existing employment record (`rec_2222222222222222`), e.g.:

```json
{
  "id": "clm_linked_python",
  "record_id": "rec_2222222222222222",
  "concept_id": "cpt_linked_python",
  "category": "skills",
  "field": "technical_skill",
  "value": "Python",
  "source": {"file": "CLAUDE.md", "section": "Technical Skills", "line_start": 22, "line_end": 22},
  "placeholder": false,
  "confidence": "high",
  "extraction_status": "explicit"
}
```

Wait — `_linked_claims` matches on `record_id`, and `_has_employment_linkage` checks whether the linked claims include an `("employment", "job_title")` or `("employment", "employer")` field. Verify this claim's `record_id` (`rec_2222222222222222`) is indeed shared with the fixture's existing `job_title`/`employer` claims (check `tests/fixtures/application_intelligence/profile-snapshot.json` directly — Task 4 of the original plan established `clm_2222222222222222`/`clm_3333333333333333`/`clm_4444444444444444` all share `rec_2222222222222222`, so this new claim reusing that same `record_id` should work correctly; confirm by reading the file before adding).

Also update `tests/fixtures/application_intelligence/profile-snapshot.json`'s `summary.claim_count` to reflect the new claim count after adding `clm_linked_python`.

- [ ] **Step 4: Run test to verify it fails, then passes after the fix**

Run: `python -m pytest tests/test_application_intelligence.py -v -k "TestNoStrengthCrossLeakage or TestBareSkillClaimCannotReachHandsOnTemplate"`
Expected: after Steps 1-2's changes are in place, all pass. If you implement Steps 1-2 before writing these tests, run them once and confirm PASS directly; there's no strict requirement to observe a pre-fix FAIL state here since the fix and tests are being introduced together in this task, but if you want a genuine red-green cycle, comment out the `eligible` check temporarily, confirm the new tests fail, then restore it.

- [ ] **Step 5: Run the full targeted file**

Run: `python -m pytest tests/test_application_intelligence.py -v`
Expected: all pass, including the pre-existing `TestBareSkillClaimCannotReachHandsOnTemplate` tests (these should still pass since `AS_STRENGTH` eligibility logic is behaviorally unchanged for that specific case — only `AS_CAPABILITY_STATEMENT`'s eligibility got stricter).

- [ ] **Step 6: Do not commit**

---

### Task 4: Finish Transferability Provenance and Recommendation-Policy Enforcement

**Files:**
- Modify: `product/application_intelligence.py` (`validate_application_intelligence_policy` — strengthen; already-done positioning transferable_strengths in Task 2 covers most of the provenance requirement, this task focuses on policy validation and any remaining content-unit-level provenance gaps)
- Modify: `tests/test_application_intelligence.py` (policy validation tests)

**Interfaces:**
- Consumes: `_known_verdict_ids()` (from Task 1), `RESULT_STATUSES` (existing).
- Produces: strengthened `validate_application_intelligence_policy`.

**Note on transferability conditions/limitations:** Task 2's `_build_positioning` already preserves both `limitations` and `conditions` verbatim into `positioning.transferable_strengths` (see Task 2 Step 1's code — both fields are explicitly copied). This task's remaining scope is specifically the **policy validation hardening** described below; verify Task 2's positioning fix is in place first (it should be, since Task 2 runs before Task 4) rather than re-doing that work here.

- [ ] **Step 1: Strengthen `validate_application_intelligence_policy`**

Replace the current `validate_application_intelligence_policy` (currently lines 63-88) with:

```python
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
            # coherent when when_status is READY -- Ticket 7 only produces a
            # non-null verdict when status is READY (see _result_status in
            # semantic_job_fit.py). Any other combination is ambiguous.
            if "when_status" in rule and rule.get("when_status") != "READY":
                errors.append(
                    f"{path}: when_verdict_in is only meaningful when when_status is 'READY' "
                    f"(Ticket 7 only produces a verdict for READY results)"
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
```

- [ ] **Step 2: Write the failing/passing policy validation tests**

Append to `tests/test_application_intelligence.py`:

```python
class TestStrengthenedPolicyValidation(unittest.TestCase):
    def test_default_policy_covers_all_real_verdict_ids(self):
        validate_application_intelligence_policy(DEFAULT_POLICY)  # must not raise

    def test_policy_missing_blocked_rule_is_rejected(self):
        bad_policy = copy.deepcopy(DEFAULT_POLICY)
        bad_policy["recommendation_rules"] = [
            rule for rule in bad_policy["recommendation_rules"] if not rule.get("when_blocked")
        ]
        with self.assertRaises(ApplicationIntelligenceValidationError) as ctx:
            validate_application_intelligence_policy(bad_policy)
        self.assertTrue(any("blocked=true" in error for error in ctx.exception.errors))

    def test_policy_with_unknown_verdict_id_is_rejected(self):
        bad_policy = copy.deepcopy(DEFAULT_POLICY)
        bad_policy["recommendation_rules"].append(
            {
                "rule_id": "bogus",
                "when_status": "READY",
                "when_verdict_in": ["not_a_real_verdict"],
                "recommendation": "proceed",
                "reason": "test",
            }
        )
        with self.assertRaises(ApplicationIntelligenceValidationError) as ctx:
            validate_application_intelligence_policy(bad_policy)
        self.assertTrue(any("unknown verdict id" in error for error in ctx.exception.errors))

    def test_policy_with_non_boolean_when_blocked_is_rejected(self):
        bad_policy = copy.deepcopy(DEFAULT_POLICY)
        bad_policy["recommendation_rules"][0] = dict(bad_policy["recommendation_rules"][0])
        bad_policy["recommendation_rules"][0]["when_blocked"] = "yes"
        with self.assertRaises(ApplicationIntelligenceValidationError) as ctx:
            validate_application_intelligence_policy(bad_policy)
        self.assertTrue(any("when_blocked: must be boolean" in error for error in ctx.exception.errors))

    def test_policy_with_verdict_rule_not_scoped_to_ready_is_rejected(self):
        bad_policy = copy.deepcopy(DEFAULT_POLICY)
        bad_policy["recommendation_rules"].append(
            {
                "rule_id": "ambiguous",
                "when_status": "NEEDS_REVIEW",
                "when_verdict_in": ["strong_fit"],
                "recommendation": "proceed",
                "reason": "test",
            }
        )
        with self.assertRaises(ApplicationIntelligenceValidationError) as ctx:
            validate_application_intelligence_policy(bad_policy)
        self.assertTrue(any("only meaningful when when_status is 'READY'" in error for error in ctx.exception.errors))

    def test_duplicate_rule_id_is_rejected(self):
        bad_policy = copy.deepcopy(DEFAULT_POLICY)
        bad_policy["recommendation_rules"].append(dict(bad_policy["recommendation_rules"][0]))
        with self.assertRaises(ApplicationIntelligenceValidationError) as ctx:
            validate_application_intelligence_policy(bad_policy)
        self.assertTrue(any("duplicate rule_id" in error for error in ctx.exception.errors))


class TestRecommendationIsProviderBlind(unittest.TestCase):
    def test_compute_recommendation_signature_takes_no_proposal_argument(self):
        import inspect
        signature = inspect.signature(_compute_recommendation)
        self.assertEqual(list(signature.parameters), ["job_fit_result", "policy"])
```

- [ ] **Step 3: Run test to verify the default policy still validates, then all new tests pass**

Run: `python -m pytest tests/test_application_intelligence.py -v -k "TestStrengthenedPolicyValidation or TestRecommendationIsProviderBlind"`
Expected: `test_default_policy_covers_all_real_verdict_ids` must PASS — if it fails, `product/application_intelligence_policy.v0.json` itself needs a fix (check whether its existing rules already cover all 5 verdict ids and both the `blocked`/`unavailable`/`needs_review` cases; per the original Task 2 policy file content, they should, but confirm). All other new tests should pass against the strengthened validator.

- [ ] **Step 4: Run the full targeted file**

Run: `python -m pytest tests/test_application_intelligence.py -v`
Expected: all pass.

- [ ] **Step 5: Do not commit**

---

### Task 5: Harden the Proposal Boundary, Clear the Two Parked Findings

**Files:**
- Modify: `product/application_intelligence.py` (add `_validate_proposal_shape`, wire it into `analyze_application_intelligence` before adjudication; fix the `KeyError` risk in atom field access; connective index bounds-checking)
- Modify: `product/openai_application_intelligence_provider.py` (if the wire schema needs any enum additions to match the new proposal-shape validation — check whether `atom_kind`'s three-value enum and `unit_type`'s enum in the OpenAI schema already match what `_validate_proposal_shape` will require; likely no change needed here since Task 7 of the original plan already closed the wire-schema gap, but verify)
- Modify: `tests/test_application_intelligence.py` (proposal-shape validation tests, including the two parked-finding regression tests)

**Interfaces:**
- Consumes: `ASSERTION_TYPES`, `RENDERING_VARIANTS`, `UNIT_TYPES` (existing schema-loaded constants).
- Produces: `_validate_proposal_shape(proposal: Any, num_atoms_by_unit: dict[str, int]) -> list[str]` (returns a list of error strings rather than raising, since a malformed proposal should degrade to an empty/partial result with unsupported_claims entries, not abort the whole `analyze_application_intelligence` call — this is a deliberate design choice: the OVERALL request must still be well-formed per `validate_application_intelligence_request`, but a malformed PROPOSAL, coming from an untrusted provider, must never crash the pipeline).

**Design decision for this task:** proposal malformation is handled differently from request malformation. `validate_application_intelligence_request` raising is correct — a malformed *request* is a caller bug. But `proposal` comes from an untrusted provider (Task 6/7's whole point), so a malformed *proposal* must degrade gracefully: reject the malformed unit/atom into `unsupported_claims`, continue processing whatever else is valid. This task adds a validation pass that runs *per unit/atom*, folding malformed entries into the same `unsupported_claims` quarantine path that already exists for other rejection reasons, rather than a single all-or-nothing raise.

- [ ] **Step 1: Write the proposal-shape validation function**

Add to `product/application_intelligence.py`:

```python
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
```

- [ ] **Step 2: Wire shape validation into `_adjudicate_content_unit`**

Modify `_adjudicate_content_unit` (currently starting at line 444) to validate shape before doing anything else. Replace the function's opening (before the `for index, atom in enumerate(atoms):` loop) with:

```python
def _adjudicate_content_unit(unit_proposal: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    rendered_fragments: list[str] = []
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
```

The rest of the function (the `if atom_kind == "transferability":` branch onward) stays as-is, EXCEPT: remove the now-redundant `if atom_kind != "candidate_fact":` catch-all branch (currently checking for unknown atom_kind) since `_validate_atom_shape` now catches that earlier — replace that branch's condition check, since by this point `atom_kind` is guaranteed to be one of the three valid values. The final `if atom_kind != "candidate_fact":` branch becomes unreachable dead code once shape validation runs first; either delete it or leave it as a defensive fallback with a comment noting it should be unreachable. **Prefer deleting it** — unreachable defensive code that can never execute is not simplicity, it's a false sense of safety; if shape validation has a bug that lets an unknown atom_kind through, a test will catch that via the new shape-validation tests below, not via dead code.

Also fix the `_render_candidate_fact_atom` internal accesses: it currently does `atom["assertion_type"]` (bracket access, KeyErrors on missing key) in several places (category/field mismatch check, template lookup, error message construction). Since shape validation now guarantees `assertion_type`/`rendering_variant`/`profile_evidence_ids` are present and well-typed by the time this function runs, bracket access is now actually safe — but change it to `.get()` with the shape-validation guarantee documented in a comment anyway, as defense in depth against a future caller of `_render_candidate_fact_atom` that bypasses `_adjudicate_content_unit`'s shape check:

```python
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
    template = _select_template(assertion_type, rendering_variant, claims, context["profile_by_id"])
    if template is None:
        return {
            "status": "UNSUPPORTED",
            "text": None,
            "reason": (
                f"rendering_variant {rendering_variant!r} for assertion_type "
                f"{assertion_type!r} requires structural evidence linkage that the cited claims do not have"
            ),
        }

    rendered = template["format"].format(value=claims[0]["value"])
    return {"status": "READY", "text": rendered}
```

This supersedes Task 3 Step 2's edit to this same function — if you're implementing tasks in order, Task 3 already changed the template-lookup block; this step further changes the `assertion_type`/`rendering_variant` access pattern around it. Apply this full version of `_render_candidate_fact_atom`, which includes Task 3's template-lookup fix already folded in.

- [ ] **Step 3: Write the parked-finding regression tests**

Append to `tests/test_application_intelligence.py`:

```python
class TestParkedFindingsFixed(unittest.TestCase):
    """Regression tests for the two findings parked during the original
    Task 6 review: a malformed atom crashing instead of quarantining, and a
    misleading rejection-reason string. Both are now fixed."""

    def test_malformed_atom_missing_assertion_type_does_not_crash(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-malformed",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            # assertion_type deliberately missing
                            "profile_evidence_ids": ["clm_1111111111111111"],
                            "rendering_variant": "PLAIN",
                        }
                    ],
                    "connectives": [],
                }
            ]
        }

        # Must not raise -- this used to KeyError.
        result = analyze_application_intelligence(request, proposal)

        self.assertEqual(result["cv_content"][0]["status"], "NEEDS_REVIEW")
        self.assertEqual(len(result["unsupported_claims"]), 1)

    def test_no_template_vs_insufficient_strength_have_distinct_reasons(self):
        request = application_intelligence_request("job-fit-result-ready.json")

        # Case A: no template exists at all for this (assertion_type, variant).
        proposal_no_template = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-no-template",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "award",
                            "profile_evidence_ids": ["clm_1111111111111111"],
                            "rendering_variant": "AS_STRENGTH",  # no ("award", "AS_STRENGTH") entry exists
                        }
                    ],
                    "connectives": [],
                }
            ]
        }
        result_a = analyze_application_intelligence(request, proposal_no_template)
        reason_a = result_a["unsupported_claims"][0]["reason"]

        # Case B: template exists but evidence doesn't support it.
        proposal_insufficient = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-insufficient",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "technical_skill",
                            "profile_evidence_ids": ["clm_1111111111111111"],
                            "rendering_variant": "AS_STRENGTH",  # template exists, evidence too weak
                        }
                    ],
                    "connectives": [],
                }
            ]
        }
        result_b = analyze_application_intelligence(request, proposal_insufficient)
        reason_b = result_b["unsupported_claims"][0]["reason"]

        self.assertIn("no rendering template is registered", reason_a)
        self.assertIn("structural evidence linkage", reason_b)
        self.assertNotEqual(reason_a, reason_b)


class TestConnectiveIndexBoundsChecking(unittest.TestCase):
    def test_negative_after_atom_index_is_rejected(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-neg-idx",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "technical_skill",
                            "profile_evidence_ids": ["clm_1111111111111111"],
                            "rendering_variant": "PLAIN",
                        }
                    ],
                    "connectives": [{"after_atom_index": -1, "text": "and"}],
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        self.assertEqual(result["cv_content"][0]["status"], "NEEDS_REVIEW")
        self.assertTrue(any("out of range" in claim["reason"] for claim in result["unsupported_claims"]))

    def test_out_of_range_after_atom_index_is_rejected(self):
        request = application_intelligence_request("job-fit-result-ready.json")
        proposal = {
            "content_units": [
                {
                    "unit_id": "cv-bullet-oob-idx",
                    "unit_type": "cv_bullet",
                    "atoms": [
                        {
                            "atom_id": "atom-1",
                            "atom_kind": "candidate_fact",
                            "assertion_type": "technical_skill",
                            "profile_evidence_ids": ["clm_1111111111111111"],
                            "rendering_variant": "PLAIN",
                        }
                    ],
                    "connectives": [{"after_atom_index": 5, "text": "and"}],  # only 1 atom exists (index 0)
                }
            ]
        }

        result = analyze_application_intelligence(request, proposal)

        self.assertEqual(result["cv_content"][0]["status"], "NEEDS_REVIEW")
        self.assertTrue(any("out of range" in claim["reason"] for claim in result["unsupported_claims"]))
```

- [ ] **Step 4: Run the new tests**

Run: `python -m pytest tests/test_application_intelligence.py -v -k "TestParkedFindingsFixed or TestConnectiveIndexBoundsChecking"`
Expected: all pass, confirming both parked findings are closed and connective bounds-checking works.

- [ ] **Step 5: Check whether the OpenAI provider's wire schema needs updates**

Read `product/openai_application_intelligence_provider.py`'s `openai_atom_proposal_schema()` function. Confirm its `atom_kind` enum already matches `{"candidate_fact", "job_reference", "transferability"}` (it should, from the original implementation) and that `after_atom_index` in the `connectives` schema is typed as `{"type": "integer"}` with no explicit range constraint. OpenAI's Structured Outputs JSON Schema dialect (per the existing `OPENAI_SUPPORTED_SCHEMA_KEYWORDS` pattern used in `openai_job_understanding_provider.py`) supports `minimum`/`maximum` keywords — if so, add `"minimum": 0` to `after_atom_index`'s schema as defense-in-depth at the wire level (mirroring the same defense-in-depth pattern already used for `connectives[].text`'s enum constraint from the prior correction round). If OpenAI's strict mode does NOT support `minimum` for integers in this dialect (verify against the existing `OPENAI_SUPPORTED_SCHEMA_KEYWORDS`/`OPENAI_SUPPORTED_SCHEMA_TYPES` constants in `openai_job_understanding_provider.py` if this module reuses that validation, or check independently), skip this and rely on Task 5's Python-side `_validate_connective_shape` bounds check as the sole enforcement — document which case applies in your task report.

- [ ] **Step 6: Run the full targeted file**

Run: `python -m pytest tests/test_application_intelligence.py tests/test_application_intelligence_providers.py -v`
Expected: all pass.

- [ ] **Step 7: Do not commit**

---

### Task 6: Final Verification and Live Smoke Test

**Files:** none created or modified — verification only.

**Interfaces:** none.

- [ ] **Step 1: Run the targeted Ticket 8 suite**

Run: `python -m pytest tests/test_application_intelligence.py tests/test_application_intelligence_providers.py -v`
Expected: all pass. Record the exact count.

- [ ] **Step 2: Run the Ticket 7 semantic-job-fit suite**

Run: `python -m pytest tests/test_semantic_job_fit.py -v`
Expected: all pass, same count as before this correction pass began (this plan touches no Ticket 7 file, so this is a pure regression check — if anything here changed, something went wrong).

- [ ] **Step 3: Run the Job Fit v0 suite**

Run: `python -m pytest tests/test_job_fit.py -v`
Expected: all pass, unchanged count.

- [ ] **Step 4: Run the full Python suite**

Run: `python -m pytest -q`
Expected: all pass except the one known skip. Record the exact `X passed, 1 skipped` count and compare against the pre-correction baseline (609 passed, 1 skipped) — the count will differ since this pass adds new tests and may remove/rename some; what matters is zero *failures*, not matching the old number exactly.

- [ ] **Step 5: Compile check**

Run: `python -m py_compile product/application_intelligence.py product/application_intelligence_providers.py product/openai_application_intelligence_provider.py tests/test_application_intelligence.py tests/test_application_intelligence_providers.py tests/fixtures/application_intelligence/generate_fixtures.py`
Expected: no output, exit 0.

Also run `python -m compileall product/ tests/ -q` for a broader compile sweep across the whole tree, confirming this correction pass introduced no syntax errors anywhere else either.

- [ ] **Step 6: JSON validation**

Run:
```
python -c "
import json, pathlib
paths = [
    'product/schemas/application-intelligence-contract.v0.schema.json',
    'product/application_intelligence_policy.v0.json',
    'tests/fixtures/application_intelligence/profile-snapshot.json',
    'tests/fixtures/application_intelligence/resolved-job-evidence.json',
    'tests/fixtures/application_intelligence/job-fit-result-ready.json',
    'tests/fixtures/application_intelligence/job-fit-result-blocked.json',
    'tests/fixtures/application_intelligence/job-fit-result-needs-review.json',
]
for p in paths:
    json.loads(pathlib.Path(p).read_text(encoding='utf-8'))
print('all JSON files valid')
"
```
Expected: `all JSON files valid`.

- [ ] **Step 7: Diff hygiene**

Run: `git diff --check`
Expected: no output (clean). For untracked/modified files, also run a per-file check as done in the prior correction round: `git diff --no-index --check /dev/null <file>` for each of the 5 Python files and 7 JSON/fixture files touched by this plan, confirming no trailing whitespace or conflict markers.

- [ ] **Step 8: Live OpenAI smoke test (gated on OPENAI_API_KEY)**

Run:
```
python -c "
import os
if not os.environ.get('OPENAI_API_KEY', '').strip():
    print('OPENAI_API_KEY not set -- skipping live smoke test (this is not a failure)')
else:
    from product.openai_application_intelligence_provider import OpenAIApplicationIntelligenceProvider
    provider = OpenAIApplicationIntelligenceProvider()
    request = {
        'request_id': 'smoke-test-1',
        'job_fit_result': {
            'status': 'READY', 'blocked': False,
            'direct_matches': [], 'functionally_equivalent_matches': [],
            'transferable_matches': [], 'gaps': [],
        },
        'resolved_job_evidence': {'evidence': []},
        'profile_snapshot': {'claims': []},
    }
    try:
        response = provider.propose(request)
        print('LIVE SMOKE TEST SUCCEEDED')
        print('payload keys:', list(response.payload.keys()) if isinstance(response.payload, dict) else type(response.payload))
        print('audit:', response.audit)
    except Exception as exc:
        print(f'LIVE SMOKE TEST FAILED: {type(exc).__name__}: {exc}')
        raise
"
```
Expected: either the graceful skip message (if `OPENAI_API_KEY` is not configured in this environment — check first with a harmless read, do not print the key itself), or `LIVE SMOKE TEST SUCCEEDED` with a real response payload and audit record. If it fails with the key present, report the exact failure — do not silently treat a real failure as equivalent to the graceful-skip case. This is the only step in this entire plan that may make a real network call; it must not run as part of the automated pytest suite (it isn't — it's a standalone script step here), and must not be retried in a loop.

- [ ] **Step 9: Report final status — do not commit**

Compile a summary: exact test counts from Steps 1-4, compile/JSON/diff-check results from Steps 5-7, and the live smoke test outcome from Step 8 (succeeded / failed / skipped-no-key). State explicitly: no commit has been made; all changes remain in the working tree pending PM review of a fresh review bundle (bundle-building is a separate follow-up step, not part of this plan).

This is the end of the correction plan. Do not commit, push, or build the review bundle as part of executing this plan — those are separate authorized steps.

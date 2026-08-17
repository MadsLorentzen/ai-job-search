"""Tests for grounded Job Understanding / Evidence Extraction v0."""

import copy
import json
import socket
import unittest
from pathlib import Path
from unittest.mock import patch

from product.job_understanding import (
    CANDIDATE_VERSION,
    DEFAULT_POLICY,
    EVIDENCE_CATEGORIES,
    POLICY_VERSION,
    REQUEST_VERSION,
    RESULT_VERSION,
    SCHEMA,
    JobUnderstandingValidationError,
    build_job_understanding_request,
    extract_job_understanding,
    job_snapshot_content_id,
    load_job_understanding_policy,
    policy_content_id,
    source_content_id,
    validate_job_understanding_policy,
    validate_job_understanding_request,
    validate_job_understanding_result,
    validate_provider_candidate,
)
from product.job_understanding_providers import (
    DeterministicFakeProvider,
    JobUnderstandingProviderError,
    ProviderResponse,
)


FIXTURE_DIR = Path(__file__).parent / "fixtures" / "job_understanding"
PROMPT_PATH = (
    Path(__file__).resolve().parents[1]
    / "product"
    / "prompts"
    / "job-understanding.v0.txt"
)


def fixture(name: str) -> dict:
    return json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))


def snapshot() -> dict:
    return fixture("job-snapshot.json")


def ready_candidate() -> dict:
    return fixture("provider-ready.json")


def empty_candidate() -> dict:
    return {
        "schema_version": CANDIDATE_VERSION,
        "items": [],
        "suggestions": [],
        "ambiguous_statements": [],
        "warnings": [],
    }


def one_item(
    quote="Python is required.",
    *,
    proposal_id="proposal-one",
    category="requirements",
    kind="required",
    certainty="explicit",
) -> dict:
    candidate = empty_candidate()
    candidate["items"] = [
        {
            "proposal_id": proposal_id,
            "category": category,
            "kind": kind,
            "quote": quote,
            "certainty": certainty,
        }
    ]
    return candidate


class Ticket6TestCase(unittest.TestCase):
    def assert_invalid(self, callback, fragment=None):
        with self.assertRaises(JobUnderstandingValidationError) as context:
            callback()
        if fragment:
            self.assertIn(fragment, str(context.exception))


class PolicyAndContractTests(Ticket6TestCase):
    def test_prompt_defines_zero_based_occurrence_disambiguation(self):
        prompt = PROMPT_PATH.read_text(encoding="utf-8")
        self.assertIn("zero-based ordinal", prompt)
        self.assertIn("first match = 0, second", prompt)
        self.assertIn("occurs exactly once, occurrence may be null", prompt)
        self.assertIn("occurs more than once, occurrence is required", prompt)
        self.assertIn("never guess", prompt)

    def test_versions_are_owned_by_machine_readable_schema(self):
        self.assertEqual(REQUEST_VERSION, SCHEMA["$defs"]["requestVersion"]["const"])
        self.assertEqual(CANDIDATE_VERSION, SCHEMA["$defs"]["candidateVersion"]["const"])
        self.assertEqual(RESULT_VERSION, SCHEMA["$defs"]["resultVersion"]["const"])
        self.assertEqual(POLICY_VERSION, SCHEMA["$defs"]["policyVersion"]["const"])
        for contract in ("request", "candidateResponse", "result"):
            self.assertIn(contract, SCHEMA["$defs"])

    def test_policy_enums_remain_aligned_with_schema(self):
        self.assertEqual(
            set(DEFAULT_POLICY["evidence_categories"]),
            set(SCHEMA["$defs"]["category"]["enum"]),
        )
        self.assertEqual(
            set(DEFAULT_POLICY["requirement_kinds"]),
            set(SCHEMA["$defs"]["requirementKind"]["enum"]),
        )
        self.assertEqual(
            set(DEFAULT_POLICY["result_statuses"]),
            set(SCHEMA["$defs"]["resultStatus"]["enum"]),
        )

    def test_default_policy_loads_and_validates(self):
        loaded = load_job_understanding_policy()
        self.assertEqual(loaded, DEFAULT_POLICY)
        validate_job_understanding_policy(loaded)
        self.assertTrue(policy_content_id(loaded).startswith("jupolicy_"))

    def test_policy_rejects_weakened_grounding_rule(self):
        policy = copy.deepcopy(DEFAULT_POLICY)
        policy["rules"]["fuzzy_quote_matching"] = True
        self.assert_invalid(lambda: validate_job_understanding_policy(policy), "fuzzy_quote_matching")

    def test_policy_rejects_unknown_nested_field(self):
        policy = copy.deepcopy(DEFAULT_POLICY)
        policy["prompt"]["temperature"] = 1
        self.assert_invalid(lambda: validate_job_understanding_policy(policy), "unsupported field")

    def test_policy_cannot_redirect_prompt_to_candidate_data(self):
        policy = copy.deepcopy(DEFAULT_POLICY)
        policy["prompt"]["path"] = "../CLAUDE.md"
        self.assert_invalid(
            lambda: validate_job_understanding_policy(policy),
            "product-owned v0 prompt",
        )

    def test_policy_malformed_nested_values_do_not_leak_raw_exception(self):
        malformed_values = [None, [], "text", 3]
        for value in malformed_values:
            with self.subTest(value=value):
                policy = copy.deepcopy(DEFAULT_POLICY)
                policy["rules"] = value
                self.assert_invalid(lambda p=policy: validate_job_understanding_policy(p))


class RequestAndSourceSelectionTests(Ticket6TestCase):
    def test_raw_text_is_selected_without_description_concatenation(self):
        job = snapshot()
        request = build_job_understanding_request(job, "request-raw")
        self.assertEqual(request["source"]["field"], "raw_text")
        self.assertEqual(request["source"]["text"], job["raw_text"])
        self.assertNotIn(job["description"], request["source"]["text"])

    def test_description_is_fallback_when_raw_text_is_absent(self):
        job = snapshot()
        job.pop("raw_text")
        request = build_job_understanding_request(job, "request-description")
        self.assertEqual(request["source"]["field"], "description")
        self.assertEqual(request["source"]["text"], job["description"])

    def test_missing_text_creates_source_less_request(self):
        job = snapshot()
        job.pop("raw_text")
        job.pop("description")
        request = build_job_understanding_request(job, "request-unavailable")
        self.assertIsNone(request["source"])

    def test_source_hash_and_unicode_character_length_use_exact_string(self):
        job = snapshot()
        request = build_job_understanding_request(job, "request-unicode")
        self.assertEqual(request["source"]["content_id"], source_content_id(job["raw_text"]))
        self.assertEqual(request["source"]["character_length"], len(job["raw_text"]))

    def test_request_carries_exact_snapshot_identity(self):
        job = snapshot()
        request = build_job_understanding_request(job, "request-identity")
        self.assertEqual(request["job_snapshot"]["content_id"], job_snapshot_content_id(job))
        self.assertEqual(request["job_snapshot"]["job_id"], job["job_id"])

    def test_request_preserves_existing_evidence_ids(self):
        request = build_job_understanding_request(snapshot(), "request-existing")
        self.assertEqual(request["preserved_evidence"]["requirements"], ["jobev_req_python"])
        self.assertEqual(request["preserved_evidence"]["responsibilities"], [])

    def test_requested_categories_must_be_supported_unique_and_nonempty(self):
        job = snapshot()
        for categories in ([], ["unknown"], ["requirements", "requirements"], "requirements"):
            with self.subTest(categories=categories):
                self.assert_invalid(
                    lambda c=categories: build_job_understanding_request(
                        job, "request-categories", requested_categories=c
                    )
                )

    def test_request_rejects_stale_snapshot_even_with_same_job_id(self):
        original = snapshot()
        request = build_job_understanding_request(original, "request-stale")
        changed = copy.deepcopy(original)
        changed["metadata"]["revision"] = 2
        self.assert_invalid(
            lambda: validate_job_understanding_request(changed, request),
            "exact supplied Job Posting Snapshot",
        )

    def test_request_rejects_unknown_source_field(self):
        job = snapshot()
        request = build_job_understanding_request(job, "request-source-field")
        request["source"]["field"] = "source_url"
        self.assert_invalid(
            lambda: validate_job_understanding_request(job, request),
            "must be one of",
        )

    def test_request_content_id_survives_json_key_reordering(self):
        job = snapshot()
        reordered = {key: job[key] for key in reversed(list(job))}
        self.assertEqual(job_snapshot_content_id(job), job_snapshot_content_id(reordered))


class ReadyExtractionTests(Ticket6TestCase):
    def test_ready_fixture_extracts_all_requested_evidence_categories(self):
        result = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(ready_candidate()), "extract-ready"
        )
        self.assertEqual(result["status"], "READY")
        self.assertEqual(len(result["requirements"]), 1)
        self.assertEqual(len(result["responsibilities"]), 1)
        self.assertEqual(len(result["language_requirements"]), 1)
        self.assertEqual(len(result["eligibility_requirements"]), 1)
        self.assertEqual(len(result["logistics_requirements"]), 1)

    def test_required_and_preferred_kinds_are_preserved(self):
        result = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(ready_candidate()), "extract-kinds"
        )
        self.assertEqual(result["requirements"][0]["kind"], "required")
        self.assertEqual(result["language_requirements"][0]["kind"], "preferred")

    def test_citation_offsets_are_calculated_locally_and_exact(self):
        job = snapshot()
        result = extract_job_understanding(
            job, DeterministicFakeProvider(one_item()), "extract-citation"
        )
        citation = result["requirements"][0]["citations"][0]
        self.assertEqual(job["raw_text"][citation["start"] : citation["end"]], citation["quote"])
        self.assertEqual(citation["quote"], "Python is required.")
        self.assertEqual(citation["source_content_id"], source_content_id(job["raw_text"]))

    def test_unicode_offsets_are_python_code_point_offsets(self):
        job = snapshot()
        candidate = one_item(
            "Café collaboration is encouraged.",
            proposal_id="proposal-unicode",
            kind="informational",
        )
        result = extract_job_understanding(job, DeterministicFakeProvider(candidate), "extract-unicode")
        citation = result["requirements"][0]["citations"][0]
        self.assertEqual(citation["start"], job["raw_text"].index("Café"))
        self.assertEqual(job["raw_text"][citation["start"] : citation["end"]], citation["quote"])

    def test_accepted_id_is_deterministic(self):
        provider = DeterministicFakeProvider(one_item())
        first = extract_job_understanding(snapshot(), provider, "extract-id-one")
        second = extract_job_understanding(snapshot(), provider, "extract-id-two")
        self.assertEqual(first["requirements"][0]["id"], second["requirements"][0]["id"])

    def test_accepted_id_ignores_provider_proposal_id(self):
        first_candidate = one_item(proposal_id="proposal-provider-a")
        second_candidate = one_item(proposal_id="proposal-provider-b")
        first = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(first_candidate), "extract-proposal-a"
        )
        second = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(second_candidate), "extract-proposal-b"
        )
        self.assertEqual(first["requirements"][0]["id"], second["requirements"][0]["id"])

    def test_accepted_id_ignores_provider_and_model_metadata(self):
        class AlternateFakeProvider(DeterministicFakeProvider):
            provider_id = "alternate-provider"
            model_id = "alternate-model"
            model_version = "v9"

        first = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(one_item()), "extract-provider-a"
        )
        second = extract_job_understanding(
            snapshot(), AlternateFakeProvider(one_item()), "extract-provider-b"
        )
        self.assertNotEqual(first["execution"], second["execution"])
        self.assertEqual(first["requirements"][0]["id"], second["requirements"][0]["id"])

    def test_accepted_id_changes_with_exact_source_content(self):
        original = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(one_item()), "extract-source-original"
        )
        changed_job = snapshot()
        changed_job["raw_text"] = "New preface.\n" + changed_job["raw_text"]
        changed = extract_job_understanding(
            changed_job,
            DeterministicFakeProvider(one_item()),
            "extract-source-changed",
        )
        self.assertNotEqual(
            original["requirements"][0]["id"], changed["requirements"][0]["id"]
        )

    def test_accepted_id_changes_with_category_or_requirement_kind(self):
        required = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(one_item()), "extract-id-required"
        )["requirements"][0]["id"]
        preferred = extract_job_understanding(
            snapshot(),
            DeterministicFakeProvider(one_item(kind="preferred")),
            "extract-id-preferred",
        )["requirements"][0]["id"]
        responsibility = extract_job_understanding(
            snapshot(),
            DeterministicFakeProvider(one_item(category="responsibilities")),
            "extract-id-responsibility",
        )["responsibilities"][0]["id"]
        self.assertEqual(len({required, preferred, responsibility}), 3)

    def test_accepted_ids_ignore_provider_item_order(self):
        candidate = ready_candidate()
        reversed_candidate = copy.deepcopy(candidate)
        reversed_candidate["items"].reverse()
        first = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(candidate), "extract-order-a"
        )
        second = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(reversed_candidate), "extract-order-b"
        )
        first_ids = {
            item["text"]: item["id"]
            for category in EVIDENCE_CATEGORIES
            for item in first[category]
        }
        second_ids = {
            item["text"]: item["id"]
            for category in EVIDENCE_CATEGORIES
            for item in second[category]
        }
        self.assertEqual(first_ids, second_ids)

    def test_exact_explicit_duplicate_is_linked_not_replaced(self):
        job = snapshot()
        original = copy.deepcopy(job["requirements"])
        result = extract_job_understanding(
            job, DeterministicFakeProvider(one_item()), "extract-duplicate-link"
        )
        self.assertEqual(job["requirements"], original)
        self.assertEqual(result["requirements"][0]["exact_duplicate_of"], "jobev_req_python")
        self.assertEqual(result["reconciliation"][0]["type"], "EXACT_DUPLICATE")

    def test_non_exact_evidence_is_not_semantically_reconciled(self):
        candidate = one_item("Build reliable data pipelines.", kind="required")
        result = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(candidate), "extract-no-semantic-merge"
        )
        self.assertNotIn("exact_duplicate_of", result["requirements"][0])
        self.assertEqual(result["reconciliation"], [])

    def test_absent_information_remains_empty_not_negative_fact(self):
        result = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(empty_candidate()), "extract-absence"
        )
        self.assertEqual(result["status"], "READY")
        for category in EVIDENCE_CATEGORIES:
            self.assertEqual(result[category], [])
        self.assertNotIn("sponsorship", json.dumps(result).lower())

    def test_full_provider_payload_is_not_copied_into_result(self):
        candidate = one_item()
        provider = DeterministicFakeProvider(candidate, response_id="bounded-response-id")
        result = extract_job_understanding(snapshot(), provider, "extract-bounded")
        self.assertNotIn("items", result)
        self.assertNotIn(candidate, result.values())
        self.assertEqual(result["execution"]["provider_response_id"], "bounded-response-id")


class ReviewSeparationTests(Ticket6TestCase):
    def test_unique_quote_occurrence_is_locally_canonicalized(self):
        job = snapshot()
        quote = "Python is required."
        expected_start = job["raw_text"].index(quote)
        evidence_ids = set()
        for supplied in (None, 0, 1, 10_000):
            with self.subTest(supplied=supplied):
                candidate = one_item(quote, proposal_id=f"proposal-unique-{supplied}")
                if supplied is not None:
                    candidate["items"][0]["occurrence"] = supplied
                result = extract_job_understanding(
                    job,
                    DeterministicFakeProvider(candidate),
                    f"extract-unique-{supplied}",
                )
                accepted = result["requirements"][0]
                citation = accepted["citations"][0]
                evidence_ids.add(accepted["id"])
                self.assertEqual(citation["occurrence"], 0)
                self.assertEqual(citation["start"], expected_start)
                self.assertEqual(citation["end"], expected_start + len(quote))
                self.assertEqual(citation["quote"], quote)
                self.assertEqual(citation["source_content_id"], result["source"]["content_id"])
        self.assertEqual(len(evidence_ids), 1)

    def test_repeated_quote_occurrence_zero_resolves_first_match(self):
        job = snapshot()
        quote = "Repeated phrase."
        candidate = one_item(quote, proposal_id="proposal-repeated-first")
        candidate["items"][0]["occurrence"] = 0
        result = extract_job_understanding(
            job, DeterministicFakeProvider(candidate), "extract-repeated-first"
        )
        citation = result["requirements"][0]["citations"][0]
        self.assertEqual(citation["occurrence"], 0)
        self.assertEqual(citation["start"], job["raw_text"].index(quote))

    def test_ambiguous_item_cannot_enter_accepted_collection(self):
        candidate = one_item(certainty="ambiguous")
        result = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(candidate), "extract-ambiguous"
        )
        self.assertEqual(result["requirements"], [])
        self.assertEqual(len(result["suggestions"]), 1)
        self.assertEqual(result["status"], "NEEDS_REVIEW")

    def test_grounded_item_can_coexist_with_separate_ambiguity(self):
        candidate = one_item()
        candidate["ambiguous_statements"] = [
            {
                "proposal_id": "proposal-ambiguous-hybrid",
                "text": "The schedule may vary.",
                "reason": "The posting does not state whether the schedule is fixed.",
                "category": "logistics_requirements",
                "quote": "Hybrid role: two days per week in London.",
            }
        ]
        result = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(candidate), "extract-mixed"
        )
        self.assertEqual(len(result["requirements"]), 1)
        self.assertEqual(len(result["ambiguous_statements"]), 1)
        self.assertEqual(result["status"], "NEEDS_REVIEW")

    def test_repeated_quote_without_occurrence_is_not_retained(self):
        candidate = one_item("Repeated phrase.", proposal_id="proposal-repeated")
        result = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(candidate), "extract-repeated"
        )
        self.assertEqual(result["requirements"], [])
        self.assertEqual(result["suggestions"], [])
        self.assertEqual(len(result["warnings"]), 1)
        self.assertNotIn("Repeated phrase", result["warnings"][0])
        self.assertEqual(result["status"], "NEEDS_REVIEW")

    def test_explicit_occurrence_resolves_repeated_quote(self):
        candidate = one_item("Repeated phrase.", proposal_id="proposal-repeated-second")
        candidate["items"][0]["occurrence"] = 1
        result = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(candidate), "extract-occurrence"
        )
        citation = result["requirements"][0]["citations"][0]
        self.assertEqual(citation["occurrence"], 1)
        self.assertEqual(citation["start"], snapshot()["raw_text"].rindex("Repeated phrase."))

    def test_final_validation_accepts_correct_second_occurrence(self):
        job = snapshot()
        candidate = one_item("Repeated phrase.", proposal_id="proposal-second-valid")
        candidate["items"][0]["occurrence"] = 1
        request = build_job_understanding_request(job, "request-second-valid")
        result = extract_job_understanding(
            job,
            DeterministicFakeProvider(candidate),
            "request-second-valid",
        )
        validate_job_understanding_result(job, request, result)

    def test_final_validation_rejects_occurrence_that_points_to_other_span(self):
        job = snapshot()
        candidate = one_item("Repeated phrase.", proposal_id="proposal-second-forged")
        candidate["items"][0]["occurrence"] = 1
        request = build_job_understanding_request(job, "request-second-forged")
        result = extract_job_understanding(
            job,
            DeterministicFakeProvider(candidate),
            "request-second-forged",
        )
        result["requirements"][0]["citations"][0]["occurrence"] = 0
        self.assert_invalid(
            lambda: validate_job_understanding_result(job, request, result),
            "does not identify the cited source span",
        )

    def test_final_validation_rejects_out_of_range_occurrence(self):
        job = snapshot()
        request = build_job_understanding_request(job, "request-occurrence-range")
        result = extract_job_understanding(
            job,
            DeterministicFakeProvider(one_item()),
            "request-occurrence-range",
        )
        result["requirements"][0]["citations"][0]["occurrence"] = 7
        self.assert_invalid(
            lambda: validate_job_understanding_result(job, request, result),
            "outside exact quote occurrences",
        )

    def test_final_validation_rejects_nonzero_single_occurrence(self):
        job = snapshot()
        request = build_job_understanding_request(job, "request-single-forged")
        result = extract_job_understanding(
            job,
            DeterministicFakeProvider(one_item()),
            "request-single-forged",
        )
        result["requirements"][0]["citations"][0]["occurrence"] = 1
        self.assert_invalid(
            lambda: validate_job_understanding_result(job, request, result),
            "outside exact quote occurrences",
        )

    def test_unknown_kind_is_grounded_but_requires_review(self):
        candidate = one_item(kind="unknown")
        result = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(candidate), "extract-unknown-kind"
        )
        self.assertEqual(len(result["requirements"]), 1)
        self.assertEqual(result["status"], "NEEDS_REVIEW")

    def test_provider_suggestion_is_never_accepted(self):
        candidate = empty_candidate()
        candidate["suggestions"] = [
            {
                "proposal_id": "proposal-seniority",
                "text": "Possibly five years of experience",
                "reason": "The title alone does not establish years.",
                "category": "requirements",
                "quote": "Python is required.",
            }
        ]
        result = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(candidate), "extract-suggestion"
        )
        self.assertEqual(result["requirements"], [])
        self.assertEqual(len(result["suggestions"]), 1)
        self.assertEqual(result["suggestions"][0]["grounding_status"], "EXACT")
        self.assertIn("citation", result["suggestions"][0])

    def test_citation_free_suggestion_is_rejected(self):
        candidate = empty_candidate()
        candidate["suggestions"] = [
            {
                "proposal_id": "proposal-uncited",
                "text": "Possibly five years of experience",
                "reason": "Tentative interpretation",
            }
        ]
        request = build_job_understanding_request(snapshot(), "request-uncited")
        self.assert_invalid(
            lambda: validate_provider_candidate(request, candidate),
            "quote: required field is missing",
        )

    def test_hallucinated_suggestion_quote_is_rejected(self):
        candidate = empty_candidate()
        candidate["suggestions"] = [
            {
                "proposal_id": "proposal-hallucinated-suggestion",
                "text": "Five years are required",
                "reason": "Tentative interpretation",
                "quote": "Applicants need five years of experience.",
            }
        ]
        self.assert_invalid(
            lambda: extract_job_understanding(
                snapshot(),
                DeterministicFakeProvider(candidate),
                "extract-hallucinated-suggestion",
            ),
            "does not occur exactly",
        )

    def test_hallucinated_ambiguous_statement_is_rejected(self):
        candidate = empty_candidate()
        candidate["ambiguous_statements"] = [
            {
                "proposal_id": "proposal-hallucinated-ambiguity",
                "text": "The role might require travel",
                "reason": "Tentative interpretation",
                "quote": "Regular international travel may be required.",
            }
        ]
        self.assert_invalid(
            lambda: extract_job_understanding(
                snapshot(),
                DeterministicFakeProvider(candidate),
                "extract-hallucinated-ambiguity",
            ),
            "does not occur exactly",
        )

    def test_repeated_review_quote_without_occurrence_is_dropped(self):
        candidate = empty_candidate()
        candidate["suggestions"] = [
            {
                "proposal_id": "proposal-repeated-review",
                "text": "Repeated wording requires review",
                "reason": "Repeated source wording",
                "quote": "Repeated phrase.",
            }
        ]
        result = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(candidate), "extract-repeated-review"
        )
        self.assertEqual(result["suggestions"], [])
        self.assertEqual(len(result["warnings"]), 1)

    def test_many_repeated_quote_rejections_are_aggregated_and_bounded(self):
        candidate = empty_candidate()
        for index in range(40):
            candidate["items"].append(
                {
                    "proposal_id": f"proposal-item-{index}",
                    "category": "requirements",
                    "kind": "required",
                    "quote": "Repeated phrase.",
                    "certainty": "explicit",
                }
            )
            candidate["suggestions"].append(
                {
                    "proposal_id": f"proposal-suggestion-{index}",
                    "text": f"Provider assertion text suggestion {index}",
                    "reason": "Repeated wording",
                    "quote": "Repeated phrase.",
                }
            )
            candidate["ambiguous_statements"].append(
                {
                    "proposal_id": f"proposal-ambiguity-{index}",
                    "text": f"Provider assertion text ambiguity {index}",
                    "reason": "Repeated wording",
                    "quote": "Repeated phrase.",
                }
            )
        result = extract_job_understanding(
            snapshot(),
            DeterministicFakeProvider(candidate),
            "extract-many-rejections",
        )
        self.assertEqual(result["requirements"], [])
        self.assertEqual(result["suggestions"], [])
        self.assertEqual(result["ambiguous_statements"], [])
        self.assertEqual(result["status"], "NEEDS_REVIEW")
        self.assertLessEqual(len(result["warnings"]), 100)
        self.assertEqual(len(result["warnings"]), 1)
        self.assertIn("120 provider proposal(s)", result["warnings"][0])
        self.assertNotIn("Provider assertion text", result["warnings"][0])

    def test_arbitrary_provider_warning_content_is_not_retained(self):
        candidate = empty_candidate()
        candidate["warnings"] = ["Candidate definitely lacks a work permit."]
        result = extract_job_understanding(
            snapshot(), DeterministicFakeProvider(candidate), "extract-provider-warning"
        )
        self.assertEqual(result["status"], "NEEDS_REVIEW")
        self.assertEqual(len(result["warnings"]), 1)
        self.assertNotIn("work permit", result["warnings"][0])
        self.assertIn("1 warning message", result["warnings"][0])


class UntrustedCandidateTests(Ticket6TestCase):
    def test_malformed_or_negative_unique_occurrence_is_rejected(self):
        for occurrence in (-1, True, "0"):
            with self.subTest(occurrence=occurrence):
                candidate = one_item()
                candidate["items"][0]["occurrence"] = occurrence
                self.assert_invalid(
                    lambda: extract_job_understanding(
                        snapshot(),
                        DeterministicFakeProvider(candidate),
                        f"extract-malformed-occurrence-{occurrence}",
                    ),
                    "occurrence",
                )

    def test_hallucinated_quote_is_rejected(self):
        candidate = one_item("Five years of experience required.")
        self.assert_invalid(
            lambda: extract_job_understanding(
                snapshot(), DeterministicFakeProvider(candidate), "extract-hallucination"
            ),
            "does not occur exactly",
        )

    def test_invalid_occurrence_is_rejected(self):
        candidate = one_item("Repeated phrase.")
        candidate["items"][0]["occurrence"] = 7
        self.assert_invalid(
            lambda: extract_job_understanding(
                snapshot(), DeterministicFakeProvider(candidate), "extract-bad-occurrence"
            ),
            "outside exact quote matches",
        )

    def test_duplicate_grounded_extraction_is_rejected(self):
        candidate = one_item()
        duplicate = copy.deepcopy(candidate["items"][0])
        duplicate["proposal_id"] = "proposal-two"
        candidate["items"].append(duplicate)
        self.assert_invalid(
            lambda: extract_job_understanding(
                snapshot(), DeterministicFakeProvider(candidate), "extract-duplicate"
            ),
            "duplicate grounded extraction",
        )

    def test_duplicate_proposal_id_is_rejected_across_sections(self):
        candidate = one_item()
        candidate["suggestions"] = [
            {
                "proposal_id": "proposal-one",
                "text": "x",
                "reason": "y",
                "quote": "Python is required.",
            }
        ]
        request = build_job_understanding_request(snapshot(), "request-duplicate-proposal")
        self.assert_invalid(lambda: validate_provider_candidate(request, candidate), "duplicate proposal id")

    def test_unsupported_category_and_kind_are_rejected(self):
        request = build_job_understanding_request(snapshot(), "request-enums")
        for field, value in (("category", "salary_requirements"), ("kind", "mandatory")):
            with self.subTest(field=field):
                candidate = one_item()
                candidate["items"][0][field] = value
                self.assert_invalid(lambda c=candidate: validate_provider_candidate(request, c))

    def test_provider_offsets_are_rejected_as_unknown_fields(self):
        candidate = one_item()
        candidate["items"][0]["start"] = 0
        candidate["items"][0]["end"] = 19
        request = build_job_understanding_request(snapshot(), "request-offset-spoof")
        self.assert_invalid(lambda: validate_provider_candidate(request, candidate), "unsupported field")

    def test_candidate_cannot_spoof_local_identity_or_execution_metadata(self):
        request = build_job_understanding_request(snapshot(), "request-spoof")
        for field in ("job_snapshot", "source_identity", "provider_id", "model_id", "policy"):
            with self.subTest(field=field):
                candidate = one_item()
                candidate[field] = "spoofed"
                self.assert_invalid(lambda c=candidate: validate_provider_candidate(request, c), "unsupported field")

    def test_malformed_candidate_json_types_never_leak_raw_python_exceptions(self):
        request = build_job_understanding_request(snapshot(), "request-malformed")
        malformed_values = [None, "text", 1, [], {"schema_version": CANDIDATE_VERSION}]
        for value in malformed_values:
            with self.subTest(value=value):
                self.assert_invalid(lambda v=value: validate_provider_candidate(request, v))
        for field, value in (("items", None), ("suggestions", {}), ("warnings", "warning")):
            with self.subTest(field=field):
                candidate = empty_candidate()
                candidate[field] = value
                self.assert_invalid(lambda c=candidate: validate_provider_candidate(request, c))

    def test_hostile_posting_text_is_data_and_cannot_change_provider_contract(self):
        job = snapshot()
        provider = DeterministicFakeProvider(empty_candidate())
        result = extract_job_understanding(job, provider, "extract-hostile")
        sent = provider.calls[0]
        self.assertIn("Ignore previous instructions", sent["source"]["text"])
        self.assertIn("untrusted data", sent["policy"]["instructions"])
        self.assertNotIn("company", sent)
        self.assertNotIn("job_snapshot", sent)
        self.assertEqual(result["status"], "READY")


class ResultTrustBoundaryTests(Ticket6TestCase):
    def ready_result(self):
        job = snapshot()
        request = build_job_understanding_request(job, "request-result-validation")
        result = extract_job_understanding(
            job, DeterministicFakeProvider(one_item()), "request-result-validation"
        )
        return job, request, result

    def test_result_rejects_changed_job_text_with_same_job_id(self):
        job, request, result = self.ready_result()
        changed = copy.deepcopy(job)
        changed["raw_text"] += "Changed."
        self.assert_invalid(
            lambda: validate_job_understanding_result(changed, request, result),
            "exact supplied Job Posting Snapshot",
        )

    def test_result_rejects_changed_unrelated_snapshot_metadata(self):
        job, request, result = self.ready_result()
        changed = copy.deepcopy(job)
        changed["metadata"]["later"] = True
        self.assert_invalid(lambda: validate_job_understanding_result(changed, request, result))

    def test_result_rejects_source_identity_tampering(self):
        job, request, result = self.ready_result()
        result["source"]["content_id"] = "jobtext_" + "0" * 64
        self.assert_invalid(
            lambda: validate_job_understanding_result(job, request, result), "must match request"
        )

    def test_result_rejects_citation_outside_bounds(self):
        job, request, result = self.ready_result()
        result["requirements"][0]["citations"][0]["end"] = len(job["raw_text"]) + 1
        self.assert_invalid(lambda: validate_job_understanding_result(job, request, result), "outside source bounds")

    def test_result_rejects_citation_quote_span_mismatch(self):
        job, request, result = self.ready_result()
        result["requirements"][0]["citations"][0]["quote"] = "Build reliable data"
        self.assert_invalid(lambda: validate_job_understanding_result(job, request, result), "does not match")

    def test_result_rejects_suggested_status_inside_accepted_collection(self):
        job, request, result = self.ready_result()
        result["requirements"][0]["extraction_status"] = "SUGGESTED"
        self.assert_invalid(lambda: validate_job_understanding_result(job, request, result), "must be 'ACCEPTED'")

    def test_result_rejects_ambiguous_certainty_inside_accepted_collection(self):
        job, request, result = self.ready_result()
        result["requirements"][0]["certainty"] = "ambiguous"
        self.assert_invalid(lambda: validate_job_understanding_result(job, request, result), "must be 'explicit'")

    def test_review_only_content_cannot_bypass_citation_validation(self):
        job = snapshot()
        candidate = one_item()
        candidate["ambiguous_statements"] = [
            {
                "proposal_id": "proposal-grounded-review",
                "text": "The schedule deserves review.",
                "reason": "Human judgment required.",
                "quote": "Hybrid role: two days per week in London.",
            }
        ]
        request = build_job_understanding_request(job, "request-review-citation")
        result = extract_job_understanding(
            job,
            DeterministicFakeProvider(candidate),
            "request-review-citation",
        )
        result["ambiguous_statements"][0]["citation"]["start"] = 0
        self.assert_invalid(
            lambda: validate_job_understanding_result(job, request, result),
            "does not identify the cited source span",
        )

    def test_result_rejects_duplicate_accepted_ids(self):
        job, request, result = self.ready_result()
        result["responsibilities"] = [copy.deepcopy(result["requirements"][0])]
        self.assert_invalid(lambda: validate_job_understanding_result(job, request, result), "duplicate accepted evidence id")

    def test_result_rejects_accepted_evidence_for_unrequested_category(self):
        job = snapshot()
        request = build_job_understanding_request(
            job,
            "request-narrow",
            requested_categories=["requirements"],
        )
        result = extract_job_understanding(
            job,
            DeterministicFakeProvider(one_item()),
            "request-narrow",
            requested_categories=["requirements"],
        )
        result["responsibilities"] = [copy.deepcopy(result["requirements"][0])]
        result["responsibilities"][0]["id"] = "juev_resp_00000000000000000000"
        self.assert_invalid(
            lambda: validate_job_understanding_result(job, request, result),
            "unrequested category",
        )

    def test_result_reconciliation_must_match_accepted_duplicate_link(self):
        job, request, result = self.ready_result()
        result["reconciliation"] = []
        self.assert_invalid(
            lambda: validate_job_understanding_result(job, request, result),
            "every exact duplicate link",
        )

    def test_result_rejects_wrong_snapshot_identity(self):
        job, request, result = self.ready_result()
        result["job_snapshot"]["content_id"] = "jobsnap_" + "0" * 20
        self.assert_invalid(lambda: validate_job_understanding_result(job, request, result), "must match request")

    def test_malformed_nested_result_never_leaks_raw_python_exception(self):
        job, request, result = self.ready_result()
        mutations = (
            ("execution", []),
            ("requirements", {}),
            ("suggestions", None),
            ("reconciliation", "records"),
            ("category_coverage", {"category": "requirements"}),
        )
        for field, value in mutations:
            with self.subTest(field=field):
                malformed = copy.deepcopy(result)
                malformed[field] = value
                self.assert_invalid(
                    lambda r=malformed: validate_job_understanding_result(job, request, r)
                )


class ProviderAndPrivacyTests(Ticket6TestCase):
    def test_no_source_returns_unavailable_without_provider_execution(self):
        job = snapshot()
        job.pop("raw_text")
        job.pop("description")
        provider = DeterministicFakeProvider(ready_candidate())
        result = extract_job_understanding(job, provider, "extract-unavailable")
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertIsNone(result["source"])
        self.assertIsNone(result["execution"])
        self.assertEqual(provider.calls, [])

    def test_fake_provider_receives_minimized_job_only_payload(self):
        provider = DeterministicFakeProvider(empty_candidate())
        extract_job_understanding(snapshot(), provider, "extract-minimized")
        payload = provider.calls[0]
        self.assertEqual(
            set(payload),
            {
                "schema_version",
                "request_id",
                "source",
                "requested_categories",
                "candidate_schema_version",
                "policy",
            },
        )
        serialized = json.dumps(payload)
        for forbidden in (
            "profile_snapshot",
            "active_extensions",
            "evaluation_policy",
            "job_fit",
            "source_url",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_provider_cannot_spoof_adapter_owned_execution_metadata(self):
        candidate = one_item()
        provider = DeterministicFakeProvider(candidate)
        result = extract_job_understanding(snapshot(), provider, "extract-metadata")
        self.assertEqual(result["execution"]["provider_id"], provider.provider_id)
        self.assertEqual(result["execution"]["model_id"], provider.model_id)
        self.assertEqual(result["policy"]["schema_version"], POLICY_VERSION)

    def test_provider_runtime_error_is_normalized_without_message_leak(self):
        class BrokenProvider:
            provider_id = "broken"
            model_id = "broken-model"
            model_version = "v0"

            def extract(self, request):
                raise RuntimeError("secret-provider-detail")

        with self.assertRaises(JobUnderstandingProviderError) as context:
            extract_job_understanding(snapshot(), BrokenProvider(), "extract-error")
        self.assertNotIn("secret-provider-detail", str(context.exception))
        self.assertIn("RuntimeError", str(context.exception))

    def test_unit_extraction_performs_no_network_calls(self):
        def deny_network(*args, **kwargs):
            raise AssertionError("network access is forbidden")

        with patch.object(socket, "create_connection", side_effect=deny_network), patch.object(
            socket.socket, "connect", side_effect=deny_network
        ):
            result = extract_job_understanding(
                snapshot(), DeterministicFakeProvider(one_item()), "extract-offline"
            )
        self.assertEqual(result["status"], "READY")

    def test_extraction_does_not_read_candidate_profile_files(self):
        original_read_text = Path.read_text

        def guarded_read_text(path, *args, **kwargs):
            path_text = str(path).replace("\\", "/")
            if path_text.endswith("CLAUDE.md") or "01-candidate-profile.md" in path_text or path_text.endswith("cv/main_example.tex"):
                raise AssertionError("candidate profile access is forbidden")
            return original_read_text(path, *args, **kwargs)

        with patch.object(Path, "read_text", guarded_read_text):
            result = extract_job_understanding(
                snapshot(), DeterministicFakeProvider(one_item()), "extract-private-boundary"
            )
        self.assertEqual(result["status"], "READY")


if __name__ == "__main__":
    unittest.main()

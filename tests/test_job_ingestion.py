"""Tests for deterministic Job Posting Ingestion v0."""

import copy
import io
import json
import math
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from product.job_fit import JOB_POSTING_SNAPSHOT_VERSION, validate_job_posting_snapshot
from product.job_ingestion import (
    EMPTY_EVIDENCE_SEMANTICS,
    EVIDENCE_COLLECTIONS,
    FREEHIRE_ADAPTER_VERSION,
    JOB_SOURCE_RECORD_VERSION,
    SOURCE_RECORD_SCHEMA,
    JobIngestionValidationError,
    job_evidence_id,
    main,
    normalize_freehire_detail,
    normalize_job_source_record,
    validate_freehire_detail,
    validate_job_source_record,
)


FIXTURE_PATH = (
    Path(__file__).parent / "fixtures" / "job_ingestion" / "freehire-detail.json"
)


def minimal_record() -> dict:
    return {
        "schema_version": JOB_SOURCE_RECORD_VERSION,
        "source": "explicit-test",
        "captured_at": "2026-08-16T14:30:00Z",
        "company": "Example Corp",
        "title": "Data Engineer",
    }


def rich_record() -> dict:
    record = minimal_record()
    record.update(
        {
            "source_record_id": "source-job-42",
            "source_url": "https://jobs.example.test/42",
            "location": "London, United Kingdom",
            "employment_type": "Full time",
            "description": "  Exact description.\nSecond line.  ",
            "raw_text": "\nRAW posting text\r\nwith original spacing  ",
            "compensation": {"currency": "GBP", "minimum": 70000},
            "metadata": {"portal": "synthetic", "source_code": 42},
            "requirements": [
                {
                    "text": "Production Python experience",
                    "kind": "required",
                    "source_section": "Requirements",
                    "metadata": {"native_label": "Must have"},
                }
            ],
            "responsibilities": [
                {"text": "Build reliable pipelines", "kind": "required"}
            ],
            "language_requirements": [
                {"text": "Professional English", "kind": "required"}
            ],
            "eligibility_requirements": [
                {"text": "Existing right to work", "kind": "preferred"}
            ],
            "logistics_requirements": [
                {"text": "Two office days per week", "kind": "informational"}
            ],
        }
    )
    return record


def freehire_detail() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


class JobIngestionTests(unittest.TestCase):
    def assert_invalid(self, callback, fragment=None):
        with self.assertRaises(JobIngestionValidationError) as context:
            callback()
        if fragment:
            self.assertIn(fragment, str(context.exception))

    def test_source_record_version_is_owned_by_schema(self):
        self.assertEqual(
            JOB_SOURCE_RECORD_VERSION,
            SOURCE_RECORD_SCHEMA["$defs"]["jobSourceRecordVersion"]["const"],
        )

    def test_minimal_generic_record_normalizes(self):
        snapshot = normalize_job_source_record(minimal_record())

        self.assertEqual(snapshot["schema_version"], JOB_POSTING_SNAPSHOT_VERSION)
        self.assertEqual(snapshot["company"], "Example Corp")
        self.assertEqual(snapshot["title"], "Data Engineer")
        validate_job_posting_snapshot(snapshot)

    def test_rich_generic_record_preserves_explicit_facts(self):
        record = rich_record()

        snapshot = normalize_job_source_record(record)

        self.assertEqual(snapshot["source_url"], record["source_url"])
        self.assertEqual(snapshot["location"], record["location"])
        self.assertEqual(snapshot["employment_type"], record["employment_type"])
        self.assertEqual(snapshot["compensation"], record["compensation"])
        self.assertEqual(
            snapshot["metadata"]["source_metadata"], record["metadata"]
        )
        self.assertEqual(snapshot["requirements"][0]["source_section"], "Requirements")
        self.assertEqual(
            snapshot["requirements"][0]["metadata"], {"native_label": "Must have"}
        )
        validate_job_posting_snapshot(snapshot)

    def test_output_is_accepted_by_job_posting_snapshot_validator(self):
        validate_job_posting_snapshot(normalize_job_source_record(rich_record()))

    def test_evidence_ids_are_deterministic(self):
        first = normalize_job_source_record(rich_record())
        second = normalize_job_source_record(copy.deepcopy(rich_record()))

        self.assertEqual(
            first["requirements"][0]["id"], second["requirements"][0]["id"]
        )

    def test_unrelated_metadata_does_not_change_evidence_id(self):
        original = rich_record()
        changed = copy.deepcopy(original)
        changed["metadata"]["unrelated"] = "different"
        changed["requirements"][0]["metadata"]["annotation"] = "different"

        self.assertEqual(
            normalize_job_source_record(original)["requirements"][0]["id"],
            normalize_job_source_record(changed)["requirements"][0]["id"],
        )

    def test_evidence_text_change_changes_id(self):
        original = rich_record()
        changed = copy.deepcopy(original)
        changed["requirements"][0]["text"] = "Different exact requirement"

        self.assertNotEqual(
            normalize_job_source_record(original)["requirements"][0]["id"],
            normalize_job_source_record(changed)["requirements"][0]["id"],
        )

    def test_evidence_kind_change_changes_id(self):
        original = rich_record()
        changed = copy.deepcopy(original)
        changed["requirements"][0]["kind"] = "preferred"

        self.assertNotEqual(
            normalize_job_source_record(original)["requirements"][0]["id"],
            normalize_job_source_record(changed)["requirements"][0]["id"],
        )

    def test_same_text_in_different_collections_has_distinct_ids(self):
        record = minimal_record()
        evidence = {"text": "Use Python", "kind": "required"}
        record["requirements"] = [copy.deepcopy(evidence)]
        record["responsibilities"] = [copy.deepcopy(evidence)]

        snapshot = normalize_job_source_record(record)

        self.assertNotEqual(
            snapshot["requirements"][0]["id"],
            snapshot["responsibilities"][0]["id"],
        )

    def test_duplicate_identical_evidence_is_rejected(self):
        record = minimal_record()
        evidence = {"text": "Use Python", "kind": "required"}
        record["requirements"] = [copy.deepcopy(evidence), copy.deepcopy(evidence)]

        self.assert_invalid(
            lambda: normalize_job_source_record(record),
            "duplicate evidence has content-derived id",
        )

    def test_raw_text_is_preserved_exactly(self):
        record = rich_record()

        snapshot = normalize_job_source_record(record)

        self.assertEqual(snapshot["raw_text"], record["raw_text"])
        self.assertEqual(snapshot["raw_text"].encode(), record["raw_text"].encode())

    def test_description_is_preserved_exactly(self):
        record = rich_record()

        self.assertEqual(
            normalize_job_source_record(record)["description"], record["description"]
        )

    def test_absent_optional_values_remain_absent(self):
        snapshot = normalize_job_source_record(minimal_record())

        for field in (
            "source_url",
            "location",
            "employment_type",
            "description",
            "raw_text",
            "compensation",
        ):
            self.assertNotIn(field, snapshot)

    def test_empty_evidence_means_unstructured_not_negative_information(self):
        snapshot = normalize_job_source_record(minimal_record())

        for collection in EVIDENCE_COLLECTIONS:
            self.assertEqual(snapshot[collection], [])
        self.assertEqual(
            snapshot["metadata"]["ingestion"]["empty_evidence_semantics"],
            EMPTY_EVIDENCE_SEMANTICS,
        )
        self.assertNotIn("gaps", snapshot)
        self.assertNotIn("unsupported_claims", snapshot)

    def test_evidence_id_public_helper_documents_expected_identity_material(self):
        base = job_evidence_id("requirements", "Exact text", "required")

        self.assertEqual(
            base, job_evidence_id("requirements", "Exact text", "required")
        )
        self.assertNotEqual(
            base, job_evidence_id("requirements", "Exact text changed", "required")
        )
        self.assertNotEqual(
            base, job_evidence_id("requirements", "Exact text", "preferred")
        )

    def test_malformed_root_types_raise_ingestion_error(self):
        for malformed in (None, [], "record", 7):
            with self.subTest(malformed=malformed):
                self.assert_invalid(lambda: validate_job_source_record(malformed))

    def test_unsupported_version_is_rejected(self):
        record = minimal_record()
        record["schema_version"] = "job-source-record.v1"

        self.assert_invalid(
            lambda: validate_job_source_record(record), "unsupported job source record version"
        )

    def test_malformed_metadata_and_compensation_raise_ingestion_error(self):
        for field in ("metadata", "compensation"):
            for malformed in (None, [], "object", 7):
                with self.subTest(field=field, malformed=malformed):
                    record = minimal_record()
                    record[field] = malformed
                    self.assert_invalid(lambda: validate_job_source_record(record))

    def test_nonfinite_nested_metadata_number_is_rejected(self):
        record = minimal_record()
        record["metadata"] = {"score": math.nan}

        self.assert_invalid(lambda: validate_job_source_record(record), "must be finite")

    def test_malformed_evidence_collection_raises_ingestion_error(self):
        for malformed in (None, {}, "requirements", 7):
            with self.subTest(malformed=malformed):
                record = minimal_record()
                record["requirements"] = malformed
                self.assert_invalid(lambda: validate_job_source_record(record))

    def test_malformed_evidence_items_raise_ingestion_error(self):
        for malformed in (None, [], "item", 7):
            with self.subTest(malformed=malformed):
                record = minimal_record()
                record["requirements"] = [malformed]
                self.assert_invalid(lambda: validate_job_source_record(record))

    def test_malformed_evidence_text_raises_ingestion_error(self):
        for malformed in (None, [], {}, 7, "   "):
            with self.subTest(malformed=malformed):
                record = minimal_record()
                record["requirements"] = [
                    {"text": malformed, "kind": "required"}
                ]
                self.assert_invalid(lambda: validate_job_source_record(record))

    def test_malformed_evidence_kind_raises_ingestion_error(self):
        for malformed in (None, [], {}, 7, "mandatory"):
            with self.subTest(malformed=malformed):
                record = minimal_record()
                record["requirements"] = [
                    {"text": "Use Python", "kind": malformed}
                ]
                self.assert_invalid(lambda: validate_job_source_record(record))

    def test_malformed_evidence_metadata_raises_ingestion_error(self):
        record = minimal_record()
        record["requirements"] = [
            {"text": "Use Python", "kind": "required", "metadata": []}
        ]

        self.assert_invalid(lambda: validate_job_source_record(record))

    def test_freehire_fixture_normalizes(self):
        snapshot = normalize_freehire_detail(
            freehire_detail(), "2026-08-16T15:00:00Z"
        )

        self.assertEqual(snapshot["source"], "freehire-search")
        self.assertEqual(snapshot["company"], "Example Systems")
        self.assertEqual(snapshot["employment_type"], "full-time")
        self.assertEqual(snapshot["compensation"], {"text": "EUR 70000–85000"})
        validate_job_posting_snapshot(snapshot)

    def test_freehire_facets_remain_metadata_not_requirements(self):
        detail = freehire_detail()

        snapshot = normalize_freehire_detail(detail, "2026-08-16T15:00:00Z")

        self.assertEqual(snapshot["requirements"], [])
        self.assertEqual(snapshot["responsibilities"], [])
        freehire = snapshot["metadata"]["source_metadata"]["freehire"]
        self.assertEqual(freehire["skills"], detail["skills"])
        self.assertEqual(freehire["category"], detail["category"])
        self.assertEqual(freehire["seniority"], detail["seniority"])

    def test_freehire_description_is_preserved_with_cleaned_text_provenance(self):
        detail = freehire_detail()

        snapshot = normalize_freehire_detail(detail, "2026-08-16T15:00:00Z")

        self.assertEqual(snapshot["description"], detail["description"])
        self.assertIn(
            "not asserted to be original ATS HTML",
            snapshot["metadata"]["source_metadata"]["description_provenance"],
        )

    def test_freehire_cleaned_description_is_not_labelled_raw_text(self):
        snapshot = normalize_freehire_detail(
            freehire_detail(), "2026-08-16T15:00:00Z"
        )

        self.assertNotIn("raw_text", snapshot)

    def test_freehire_posting_date_and_identifier_are_preserved_as_provenance(self):
        detail = freehire_detail()

        snapshot = normalize_freehire_detail(detail, "2026-08-16T15:00:00Z")

        self.assertEqual(
            snapshot["metadata"]["ingestion"]["source_record_id"], detail["id"]
        )
        self.assertEqual(
            snapshot["metadata"]["source_metadata"]["freehire"]["date"],
            detail["date"],
        )

    def test_freehire_requires_explicit_capture_timestamp(self):
        for malformed in (None, [], {}, 7, "   "):
            with self.subTest(malformed=malformed):
                self.assert_invalid(
                    lambda: normalize_freehire_detail(freehire_detail(), malformed),
                    "captured_at",
                )

    def test_malformed_freehire_root_raises_ingestion_error(self):
        for malformed in (None, [], "detail", 7):
            with self.subTest(malformed=malformed):
                self.assert_invalid(lambda: validate_freehire_detail(malformed))

    def test_malformed_freehire_nested_arrays_raise_ingestion_error(self):
        for field in ("regions", "countries", "skills", "cities"):
            for malformed in (None, {}, "array", 7):
                with self.subTest(field=field, malformed=malformed):
                    detail = freehire_detail()
                    detail[field] = malformed
                    self.assert_invalid(lambda: validate_freehire_detail(detail))

    def test_malformed_freehire_nested_array_items_raise_ingestion_error(self):
        for malformed in (None, [], {}, 7):
            with self.subTest(malformed=malformed):
                detail = freehire_detail()
                detail["skills"] = [malformed]
                self.assert_invalid(lambda: validate_freehire_detail(detail))

    def test_malformed_freehire_optional_strings_raise_ingestion_error(self):
        for field in (
            "location",
            "date",
            "description",
            "employment_type",
            "salary",
        ):
            for malformed in ([], {}, 7):
                with self.subTest(field=field, malformed=malformed):
                    detail = freehire_detail()
                    detail[field] = malformed
                    self.assert_invalid(lambda: validate_freehire_detail(detail))

    def test_freehire_normalization_has_no_network_dependency(self):
        with patch("socket.socket", side_effect=AssertionError("network attempted")):
            snapshot = normalize_freehire_detail(
                freehire_detail(), "2026-08-16T15:00:00Z"
            )

        self.assertEqual(snapshot["source"], "freehire-search")

    def test_cli_normalize_valid_path(self):
        with tempfile.TemporaryDirectory() as tempdir:
            source_path = Path(tempdir) / "source.json"
            source_path.write_text(json.dumps(rich_record()), encoding="utf-8")
            output = io.StringIO()

            with redirect_stdout(output):
                exit_code = main(["normalize", str(source_path)])

        self.assertEqual(exit_code, 0)
        snapshot = json.loads(output.getvalue())
        validate_job_posting_snapshot(snapshot)

    def test_cli_normalize_invalid_path_returns_json_and_nonzero(self):
        with tempfile.TemporaryDirectory() as tempdir:
            source_path = Path(tempdir) / "source.json"
            source_path.write_text(json.dumps({"schema_version": "wrong"}), encoding="utf-8")
            error = io.StringIO()

            with redirect_stderr(error):
                exit_code = main(["normalize", str(source_path)])

        self.assertEqual(exit_code, 1)
        payload = json.loads(error.getvalue())
        self.assertFalse(payload["valid"])
        self.assertTrue(payload["errors"])

    def test_cli_normalize_freehire_valid_path(self):
        output = io.StringIO()

        with redirect_stdout(output):
            exit_code = main(
                [
                    "normalize-freehire",
                    str(FIXTURE_PATH),
                    "--captured-at",
                    "2026-08-16T15:00:00Z",
                ]
            )

        self.assertEqual(exit_code, 0)
        snapshot = json.loads(output.getvalue())
        validate_job_posting_snapshot(snapshot)


if __name__ == "__main__":
    unittest.main()

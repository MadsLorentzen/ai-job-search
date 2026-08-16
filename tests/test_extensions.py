"""Tests for the passive Extension Package Schema v0 product contract."""

import copy
import io
import json
import re
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import product.extensions as extension_contract
from product.extensions import (
    SCHEMA_PATH,
    SCHEMA_VERSION,
    ExtensionValidationError,
    extension_content_id,
    load_extension,
    load_extensions,
    main,
    normalized_extension,
    normalized_extension_json,
    validate_extension,
)


FIXTURES = Path(__file__).parent / "fixtures" / "extensions"


def minimal_extension() -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "id": "data-engineering",
        "name": "Data Engineering",
        "version": "0.1.0",
        "status": "draft",
        "description": "Reusable professional knowledge about data engineering.",
        "publisher": {
            "name": "Synthetic Knowledge Cooperative",
            "type": "organization",
        },
        "trust": {
            "level": "unreviewed",
            "notes": "Synthetic test data.",
        },
        "metadata": {
            "created_date": "2026-08-16",
            "reviewed_date": None,
        },
        "scope": {},
    }


def rich_extension() -> dict:
    extension = minimal_extension()
    extension.update(
        {
            "status": "reviewed",
            "authors": [{"name": "Fixture Author", "organization": "Example Lab"}],
            "trust": {"level": "community-reviewed"},
            "scope": {
                "industries": ["Technology"],
                "professions": ["Data engineering"],
                "role_families": ["Data"],
                "role_titles": ["Data Engineer"],
                "role_aliases": ["Data Platform Engineer"],
                "seniority_levels": ["mid", "senior"],
                "jurisdictions": ["Jurisdiction-neutral"],
            },
            "sources": [
                {
                    "id": "example-guide",
                    "title": "Synthetic Data Engineering Guide",
                    "publisher": "Example Lab",
                    "source_type": "industry-guidance",
                }
            ],
            "terminology": [
                {
                    "id": "data-pipeline-term",
                    "canonical_term": "data pipeline",
                    "aliases": ["data flow"],
                    "definition": "A sequence of data processing stages.",
                    "category": "architecture",
                    "source_ids": ["example-guide"],
                }
            ],
            "competencies": [
                {
                    "id": "pipeline-design",
                    "name": "Pipeline design",
                    "description": "Design reliable data processing flows.",
                    "category": "architecture",
                    "skills": ["schema design"],
                    "tools": ["workflow orchestrators"],
                    "methods": ["data quality checks"],
                    "responsibilities": ["document failure modes"],
                    "expectations": [
                        {
                            "seniority": "senior",
                            "description": "Can evaluate operational trade-offs.",
                        }
                    ],
                    "source_ids": ["example-guide"],
                },
                {
                    "id": "reliability-analysis",
                    "name": "Reliability analysis",
                    "description": "Reason about system reliability.",
                    "category": "operations",
                    "source_ids": ["example-guide"],
                },
            ],
            "roles": [
                {
                    "id": "data-engineer-role",
                    "name": "Data Engineer",
                    "expected_competency_ids": ["pipeline-design"],
                    "typical_expectations": ["Build reliable pipelines"],
                    "source_ids": ["example-guide"],
                }
            ],
            "certifications": [
                {
                    "id": "example-platform-certificate",
                    "name": "Example Platform Certificate",
                    "issuer": "Example Lab",
                    "requirement_type": "preferred",
                    "source_ids": ["example-guide"],
                }
            ],
            "transferable_mappings": [
                {
                    "id": "reliability-to-pipelines",
                    "source": {"competency_id": "reliability-analysis"},
                    "target": {"competency_id": "pipeline-design"},
                    "rationale": "Reliability reasoning can support resilient pipeline design.",
                    "transfer_strength": "moderate",
                    "conditions": ["Reliability work is evidenced"],
                    "limitations": ["Does not establish tool-specific experience"],
                    "evidence_requirements": ["A concrete reliability example"],
                    "source_ids": ["example-guide"],
                }
            ],
            "disallowed_mappings": [
                {
                    "id": "knowledge-does-not-imply-employment",
                    "source_concept": "knowledge of data pipelines",
                    "prohibited_inference": "employment-history",
                    "rationale": "Professional knowledge is not evidence of employment.",
                    "source_ids": ["example-guide"],
                }
            ],
            "interview_knowledge": [
                {
                    "id": "pipeline-failure-modes",
                    "topic": "Pipeline failure modes",
                    "why_it_matters": "Reliable systems require failure-aware design.",
                    "question_themes": ["How should retries be bounded?"],
                    "concepts": ["idempotency", "backpressure"],
                    "source_ids": ["example-guide"],
                }
            ],
        }
    )
    return extension


class ExtensionPackageTests(unittest.TestCase):
    def assert_invalid(self, extension, message_fragment=None):
        with self.assertRaises(ExtensionValidationError) as context:
            validate_extension(extension)
        if message_fragment:
            self.assertIn(message_fragment, str(context.exception))

    def test_valid_minimal_extension(self):
        validate_extension(minimal_extension())

    def test_valid_richer_extension(self):
        validate_extension(rich_extension())

    def test_machine_readable_schema_is_valid_json_and_versioned(self):
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

        self.assertEqual(schema["properties"]["schema_version"]["const"], SCHEMA_VERSION)
        self.assertFalse(schema["additionalProperties"])

    def test_schema_is_canonical_for_shared_patterns_and_enums(self):
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        definitions = schema["$defs"]

        self.assertEqual(SCHEMA_VERSION, "extension-package.v0")
        self.assertEqual(extension_contract.ID_RE.pattern, definitions["id"]["pattern"])
        self.assertEqual(
            extension_contract.SEMVER_RE.pattern,
            definitions["semver"]["pattern"],
        )
        parity = [
            (
                extension_contract.STATUSES,
                schema["properties"]["status"]["enum"],
            ),
            (
                extension_contract.TRUST_LEVELS,
                definitions["trust"]["properties"]["level"]["enum"],
            ),
            (
                extension_contract.PUBLISHER_TYPES,
                definitions["publisher"]["properties"]["type"]["enum"],
            ),
            (extension_contract.SENIORITY_LEVELS, definitions["seniority"]["enum"]),
            (
                extension_contract.SOURCE_TYPES,
                definitions["source"]["properties"]["source_type"]["enum"],
            ),
            (
                extension_contract.REQUIREMENT_TYPES,
                definitions["certification"]["properties"]["requirement_type"]["enum"],
            ),
            (
                extension_contract.TRANSFER_STRENGTHS,
                definitions["transferableMapping"]["properties"]
                ["transfer_strength"]["enum"],
            ),
            (
                extension_contract.PROHIBITED_INFERENCES,
                definitions["disallowedMapping"]["properties"]
                ["prohibited_inference"]["enum"],
            ),
        ]
        for python_values, schema_values in parity:
            self.assertEqual(python_values, set(schema_values))

    def test_schema_and_python_reject_whitespace_only_strings(self):
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        pattern = schema["$defs"]["nonempty"]["pattern"]
        extension = minimal_extension()
        extension["description"] = "   "

        self.assertIsNone(re.search(pattern, "   "))
        self.assert_invalid(extension, "must be a non-empty string")

    def test_geophysics_fixture_validates(self):
        extension = load_extension(FIXTURES / "geophysics")

        self.assertEqual(extension["id"], "geophysics")
        self.assertTrue(extension["transferable_mappings"])

    def test_plumbing_fixture_validates(self):
        extension = load_extension(FIXTURES / "plumbing" / "extension.json")

        self.assertEqual(extension["id"], "plumbing")
        self.assertEqual(extension["terminology"][0]["aliases"], ["rørføring"])

    def test_unsupported_schema_version_is_rejected(self):
        extension = minimal_extension()
        extension["schema_version"] = "extension-package.v1"

        self.assert_invalid(extension, "unsupported schema version")

    def test_malformed_extension_id_is_rejected(self):
        extension = minimal_extension()
        extension["id"] = "Data Engineering"

        self.assert_invalid(extension, "lowercase kebab-case")

    def test_malformed_extension_version_is_rejected(self):
        extension = minimal_extension()
        extension["version"] = "version one"

        self.assert_invalid(extension, "semantic version")

    def test_invalid_status_is_rejected(self):
        extension = minimal_extension()
        extension["status"] = "published"

        self.assert_invalid(extension, "$.status")

    def test_non_string_enum_values_are_validation_errors(self):
        cases = [
            ("status", lambda item: item.__setitem__("status", [])),
            (
                "publisher.type",
                lambda item: item["publisher"].__setitem__("type", {}),
            ),
            (
                "trust.level",
                lambda item: item["trust"].__setitem__("level", []),
            ),
            (
                "source_type",
                lambda item: item["sources"][0].__setitem__("source_type", {}),
            ),
            (
                "seniority",
                lambda item: item["scope"].__setitem__("seniority_levels", [[]]),
            ),
            (
                "requirement_type",
                lambda item: item["certifications"][0].__setitem__(
                    "requirement_type", {}
                ),
            ),
            (
                "transfer_strength",
                lambda item: item["transferable_mappings"][0].__setitem__(
                    "transfer_strength", []
                ),
            ),
            (
                "prohibited_inference",
                lambda item: item["disallowed_mappings"][0].__setitem__(
                    "prohibited_inference", {}
                ),
            ),
        ]
        for label, mutate in cases:
            with self.subTest(field=label):
                extension = rich_extension()
                mutate(extension)
                self.assert_invalid(extension, "must be one of")

    def test_malformed_structural_types_never_escape_validation(self):
        cases = [
            ("root", []),
            ("publisher", {**minimal_extension(), "publisher": []}),
            ("trust", {**minimal_extension(), "trust": []}),
            ("metadata", {**minimal_extension(), "metadata": []}),
            ("scope", {**minimal_extension(), "scope": []}),
        ]
        for field in (
            "sources", "terminology", "competencies", "roles", "certifications",
            "transferable_mappings", "disallowed_mappings", "interview_knowledge",
        ):
            extension = minimal_extension()
            extension[field] = [None]
            cases.append((field, extension))

        for label, malformed in cases:
            with self.subTest(field=label):
                self.assert_invalid(malformed)

    def test_optional_fields_reject_explicit_null(self):
        cases = [
            ("publisher.url", lambda item: item["publisher"].__setitem__("url", None)),
            (
                "author.organization",
                lambda item: item["authors"][0].__setitem__("organization", None),
            ),
            ("author.url", lambda item: item["authors"][0].__setitem__("url", None)),
            ("trust.notes", lambda item: item["trust"].__setitem__("notes", None)),
            ("source.url", lambda item: item["sources"][0].__setitem__("url", None)),
            (
                "source.jurisdiction",
                lambda item: item["sources"][0].__setitem__("jurisdiction", None),
            ),
            (
                "source.publication_date",
                lambda item: item["sources"][0].__setitem__("publication_date", None),
            ),
            (
                "source.reviewed_date",
                lambda item: item["sources"][0].__setitem__("reviewed_date", None),
            ),
            ("source.notes", lambda item: item["sources"][0].__setitem__("notes", None)),
            ("role_family", lambda item: item["roles"][0].__setitem__("role_family", None)),
            (
                "certification.jurisdiction",
                lambda item: item["certifications"][0].__setitem__("jurisdiction", None),
            ),
            (
                "certification.notes",
                lambda item: item["certifications"][0].__setitem__("notes", None),
            ),
        ]
        for label, mutate in cases:
            with self.subTest(field=label):
                extension = rich_extension()
                mutate(extension)
                self.assert_invalid(extension)

    def test_metadata_reviewed_date_is_intentionally_nullable(self):
        extension = minimal_extension()
        extension["metadata"]["reviewed_date"] = None

        validate_extension(extension)
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        reviewed = schema["$defs"]["metadata"]["properties"]["reviewed_date"]
        self.assertIn({"type": "null"}, reviewed["oneOf"])

    def test_duplicate_competency_id_is_rejected(self):
        extension = rich_extension()
        duplicate = copy.deepcopy(extension["competencies"][0])
        extension["competencies"].append(duplicate)

        self.assert_invalid(extension, "duplicate competency id")

    def test_duplicate_source_id_is_rejected(self):
        extension = rich_extension()
        extension["sources"].append(copy.deepcopy(extension["sources"][0]))

        self.assert_invalid(extension, "duplicate source id")

    def test_duplicate_role_id_is_rejected(self):
        extension = rich_extension()
        extension["roles"].append(copy.deepcopy(extension["roles"][0]))

        self.assert_invalid(extension, "duplicate role id")

    def test_unknown_provenance_reference_is_rejected(self):
        extension = rich_extension()
        extension["terminology"][0]["source_ids"] = ["missing-source"]

        self.assert_invalid(extension, "unknown source id")

    def test_invalid_transfer_strength_is_rejected(self):
        extension = rich_extension()
        extension["transferable_mappings"][0]["transfer_strength"] = "certain"

        self.assert_invalid(extension, "transfer_strength")

    def test_transfer_mapping_unknown_competency_is_rejected(self):
        extension = rich_extension()
        extension["transferable_mappings"][0]["target"] = {
            "competency_id": "unknown-competency"
        }

        self.assert_invalid(extension, "unknown competency id")

    def test_duplicate_transfer_mapping_is_rejected(self):
        extension = rich_extension()
        duplicate = copy.deepcopy(extension["transferable_mappings"][0])
        duplicate["id"] = "second-mapping-id"
        extension["transferable_mappings"].append(duplicate)

        self.assert_invalid(extension, "duplicate transferable mapping")

    def test_invalid_certification_requirement_type_is_rejected(self):
        extension = rich_extension()
        extension["certifications"][0]["requirement_type"] = "guaranteed"

        self.assert_invalid(extension, "requirement_type")

    def test_legally_required_certification_needs_provenance(self):
        extension = rich_extension()
        extension["certifications"][0]["requirement_type"] = "legally-required"
        extension["certifications"][0]["source_ids"] = []

        self.assert_invalid(extension, "legally-required qualifications need provenance")

    def test_disallowed_mapping_validates(self):
        extension = minimal_extension()
        extension["disallowed_mappings"] = [
            {
                "id": "similarity-does-not-imply-licence",
                "source_concept": "similar domain terminology",
                "prohibited_inference": "regulated-licence",
                "rationale": "Terminology overlap is not evidence of licensing.",
            }
        ]

        validate_extension(extension)

    def test_candidate_private_fields_are_rejected_at_any_depth(self):
        prohibited = {
            "candidate_name": "Example Candidate",
            "personal_email": "candidate@example.test",
            "personal_phone": "+00 0000",
            "candidate_address": "Example Street",
            "personal_linkedin": "https://example.test/profile",
            "personal_github": "https://example.test/code",
            "candidate_employment_history": [],
            "candidate_application_history": [],
        }
        for field, value in prohibited.items():
            with self.subTest(field=field):
                extension = minimal_extension()
                extension["trust"][field] = value
                self.assert_invalid(extension, "candidate-private fields are prohibited")

    def test_executable_behavior_fields_are_rejected_at_any_depth(self):
        for field in (
            "script", "command", "shell", "executable", "hook", "lifecycle",
            "python", "javascript",
        ):
            with self.subTest(field=field):
                extension = minimal_extension()
                extension["scope"][field] = "run something"
                self.assert_invalid(extension, "executable behavior fields are prohibited")

    def test_extension_file_is_not_modified_while_loading(self):
        source = FIXTURES / "geophysics" / "extension.json"
        with tempfile.TemporaryDirectory() as tempdir:
            target = Path(tempdir) / "extension.json"
            target.write_bytes(source.read_bytes())
            before = target.read_bytes()

            load_extension(target)

            self.assertEqual(target.read_bytes(), before)

    def test_unicode_professional_terminology_survives_round_trip(self):
        extension = minimal_extension()
        extension["terminology"] = [
            {
                "id": "rorforing",
                "canonical_term": "rørføring",
                "aliases": ["trykbølge", "strömning"],
                "definition": "Føring af rør i et teknisk system.",
                "category": "VVS",
            }
        ]

        normalized = normalized_extension(extension)

        self.assertEqual(normalized["terminology"][0]["canonical_term"], "rørføring")
        self.assertIn("strömning", normalized_extension_json(extension))

    def test_normalized_output_and_content_id_are_deterministic(self):
        extension = rich_extension()
        reordered = {key: copy.deepcopy(extension[key]) for key in reversed(extension)}

        self.assertEqual(
            normalized_extension_json(extension),
            normalized_extension_json(reordered),
        )
        self.assertEqual(extension_content_id(extension), extension_content_id(reordered))
        self.assertRegex(extension_content_id(extension), r"^extpkg_[0-9a-f]{20}$")

    def test_load_extensions_rejects_duplicate_package_identity(self):
        path = FIXTURES / "geophysics"

        with self.assertRaises(ExtensionValidationError):
            load_extensions([path, path])

    def test_cli_validate_success_and_show(self):
        output = io.StringIO()
        with redirect_stdout(output):
            exit_code = main(["validate", str(FIXTURES / "geophysics")])

        self.assertEqual(exit_code, 0)
        self.assertTrue(json.loads(output.getvalue())["valid"])

        output = io.StringIO()
        with redirect_stdout(output):
            exit_code = main(["show", str(FIXTURES / "plumbing")])

        self.assertEqual(exit_code, 0)
        self.assertEqual(json.loads(output.getvalue())["id"], "plumbing")

    def test_cli_failure_is_nonzero_and_machine_readable(self):
        with tempfile.TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "extension.json"
            invalid = minimal_extension()
            invalid["schema_version"] = "unsupported"
            path.write_text(json.dumps(invalid), encoding="utf-8")
            error = io.StringIO()

            with redirect_stderr(error):
                exit_code = main(["validate", str(path)])

        self.assertEqual(exit_code, 1)
        payload = json.loads(error.getvalue())
        self.assertFalse(payload["valid"])
        self.assertTrue(payload["errors"])

    def test_cli_malformed_enum_is_nonzero_json_not_exception(self):
        with tempfile.TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "extension.json"
            invalid = minimal_extension()
            invalid["status"] = []
            path.write_text(json.dumps(invalid), encoding="utf-8")
            error = io.StringIO()

            with redirect_stderr(error):
                exit_code = main(["validate", str(path)])

        self.assertEqual(exit_code, 1)
        payload = json.loads(error.getvalue())
        self.assertFalse(payload["valid"])
        self.assertIn("$.status", payload["errors"][0])


if __name__ == "__main__":
    unittest.main()

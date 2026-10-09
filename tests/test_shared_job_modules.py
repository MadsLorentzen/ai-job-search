"""Static contract tests for the shared TypeScript job modules."""

import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCHEMA = REPO / ".agents" / "shared" / "job-schema.ts"
NORMALIZATION = REPO / ".agents" / "shared" / "job-normalization.ts"
DEDUPE = REPO / ".agents" / "shared" / "job-dedupe.ts"


class SharedJobModuleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = SCHEMA.read_text(encoding="utf-8")
        cls.normalization = NORMALIZATION.read_text(encoding="utf-8")
        cls.dedupe = DEDUPE.read_text(encoding="utf-8")

    def test_standard_schema_carries_provenance_and_raw_values(self):
        for field in ("portal", "source", "access_mode", "raw_id", "salary", "location", "fetched_at"):
            self.assertIn(f"{field}:", self.schema)
        self.assertIn("validateStandardJob", self.schema)

    def test_chinese_normalization_exports_all_required_parsers(self):
        for name in (
            "parseChineseSalary",
            "parseChineseDate",
            "normalizeExperience",
            "normalizeEducation",
            "normalizeLocation",
        ):
            self.assertIn(f"export function {name}", self.normalization)
        self.assertIn('unit: "unknown"', self.normalization)
        self.assertIn("面议", self.normalization)

    def test_dedupe_separates_source_key_from_cross_portal_key(self):
        self.assertIn("sourceJobKey", self.dedupe)
        self.assertIn("crossPortalJobKey", self.dedupe)
        self.assertIn("excludes salary/date", self.dedupe)
        self.assertIn("canonicalJobKey", self.dedupe)
        self.assertIn('"portal:" + job.portal.trim().toLowerCase()', self.dedupe)


if __name__ == "__main__":
    unittest.main()

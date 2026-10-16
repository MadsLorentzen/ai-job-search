"""The documented pre-flight must reject metadata that breaks table lookups."""
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

TOOL = Path(__file__).resolve().parent.parent / "salary_lookup.py"


class SalaryMetadataCLI(unittest.TestCase):
    def run_lookup(self, metadata, *args):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copyfile(TOOL, root / TOOL.name)
            (root / "salary_data.json").write_text(json.dumps({
                "metadata": metadata,
                "companies": [{"company": "Acme", "categories": {"all_employees": {"index": 165}}}],
            }), encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(root / TOOL.name), *args],
                capture_output=True, text=True, encoding="utf-8",
            )

    def test_preflight_rejects_a_text_baseline(self):
        result = self.run_lookup({"index_baseline": "150"}, "--validate")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("index_baseline", result.stdout + result.stderr)

    def test_lookup_rejects_a_text_baseline_without_a_traceback(self):
        result = self.run_lookup({"index_baseline": "150"}, "Acme")
        self.assertEqual(result.returncode, 1)
        self.assertIn("index_baseline", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_preflight_rejects_a_non_text_index_label(self):
        result = self.run_lookup({"index_label": ["Salary"]}, "--validate")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("index_label", result.stdout + result.stderr)

    def test_preflight_rejects_unusable_numeric_baselines(self):
        for baseline in [True, None, float("inf"), float("nan"), 10 ** 400]:
            with self.subTest(baseline=baseline):
                result = self.run_lookup({"index_baseline": baseline}, "--validate")
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn("index_baseline", result.stdout + result.stderr)
                self.assertNotIn("Traceback", result.stderr)

    def test_numeric_baseline_and_optional_metadata_controls(self):
        for metadata, percentage in [({"index_baseline": 150, "index_label": "Salary"}, "+10.0%"),
                                     ({"index_baseline": 0}, None), ({}, "+65.0%"), (None, "+65.0%")]:
            with self.subTest(metadata=metadata):
                result = self.run_lookup(metadata, "Acme")
                self.assertEqual(result.returncode, 0, result.stderr)
                if percentage:
                    self.assertIn(percentage, result.stdout)
                else:
                    self.assertNotIn("%", result.stdout)

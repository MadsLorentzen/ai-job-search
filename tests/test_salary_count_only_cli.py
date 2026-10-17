"""Count-only workbook categories do not imply a suppressed salary index."""
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

try:
    import openpyxl
except ImportError:
    openpyxl = None

REPO = Path(__file__).resolve().parent.parent


class CountOnlySalaryCLI(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        shutil.copyfile(REPO / "salary_lookup.py", self.root / "salary_lookup.py")

    def lookup(self):
        result = subprocess.run(
            [sys.executable, str(self.root / "salary_lookup.py"), "Acme Corp"],
            capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def convert(self, headers, row):
        workbook = self.root / "salary.xlsx"
        book = openpyxl.Workbook()
        try:
            book.active.append(headers)
            book.active.append(row)
            book.save(workbook)
        finally:
            book.close()
        result = subprocess.run(
            [sys.executable, str(REPO / "tools/convert_salary_excel.py"), str(workbook),
             "--output", str(self.root / "salary_data.json")],
            capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    @unittest.skipUnless(openpyxl, "requires optional openpyxl (installed in CI)")
    def test_count_only_workbook_does_not_claim_privacy_suppression(self):
        self.convert(["Company", "Count"], ["Acme Corp", 500])
        output = self.lookup()
        self.assertRegex(output, r"Count\s+500\s+-")
        self.assertNotIn("N/A", output)
        self.assertNotIn("privacy", output)

    @unittest.skipUnless(openpyxl, "requires optional openpyxl (installed in CI)")
    def test_paired_numeric_index_control(self):
        self.convert(["Company", "Count", "Index"], ["Acme Corp", 500, 108.5])
        output = self.lookup()
        self.assertIn("108.5", output)
        self.assertIn("+8.5%", output)
        self.assertNotIn("privacy", output)

    def test_explicit_null_index_keeps_the_existing_suppression_marker(self):
        (self.root / "salary_data.json").write_text(json.dumps({"companies": [{
            "company": "Acme Corp", "categories": {"small_team": {"count": 3, "index": None}},
        }]}), encoding="utf-8")
        output = self.lookup()
        self.assertIn("N/A*", output)
        self.assertIn("Too few employees to publish (privacy)", output)

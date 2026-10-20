"""Non-finite workbook cells cannot crash conversion or escape as JSON numbers."""
import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

try:
    import openpyxl
except ImportError:
    openpyxl = None

TOOL = Path(__file__).resolve().parent.parent / "tools" / "convert_salary_excel.py"


@unittest.skipUnless(openpyxl, "requires optional openpyxl (installed in CI)")
class NonFiniteWorkbookCLI(unittest.TestCase):
    def convert(self, headers, rows):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            workbook, output = root / "salary.xlsx", root / "salary.json"
            book = openpyxl.Workbook()
            try:
                book.active.append(headers)
                for row in rows:
                    book.active.append(row)
                book.save(workbook)
            finally:
                book.close()
            result = subprocess.run(
                [sys.executable, str(TOOL), str(workbook), "--output", str(output)],
                capture_output=True, text=True, encoding="utf-8",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            def reject_constant(value):
                self.fail(f"converter emitted non-JSON numeric constant {value}")
            return json.loads(output.read_text(encoding="utf-8"), parse_constant=reject_constant)["companies"]

    def test_infinite_paired_count_does_not_abort_the_workbook(self):
        companies = self.convert(["Company", "Count", "Index"], [
            ["Invalid Count", "Infinity", 108.5], ["Valid Control", 12, 102.5]
        ])
        self.assertEqual(companies[0]["categories"], {"all_employees": {"count": None, "index": 108.5}})
        self.assertEqual(companies[1]["categories"], {"all_employees": {"count": 12, "index": 102.5}})

    def test_nonfinite_paired_index_is_skipped_instead_of_emitted_as_nan(self):
        companies = self.convert(["Company", "Count", "Index"], [["Acme", 12, "NaN"]])
        self.assertEqual(companies[0]["categories"], {"all_employees": {"count": 12, "index": None}})

    def test_nonfinite_standalone_count_is_skipped(self):
        companies = self.convert(["Company", "Count"], [["Acme", "NaN"]])
        self.assertEqual(companies[0]["categories"], {})

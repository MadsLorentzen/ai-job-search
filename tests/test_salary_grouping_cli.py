"""Preserve space-grouped numbers through the real workbook converter CLI."""
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

try:
    import openpyxl
except ImportError:
    openpyxl = None


TOOL = Path(__file__).resolve().parent.parent / "tools" / "convert_salary_excel.py"


@unittest.skipUnless(openpyxl, "requires optional openpyxl (installed in CI)")
class GroupingCLI(unittest.TestCase):
    def convert(self, rows):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            workbook, output = root / "salary.xlsx", root / "salary_data.json"
            book = openpyxl.Workbook()
            try:
                book.active.append(["Company", "Count", "Salary"])
                for row in rows:
                    book.active.append(row)
                book.save(workbook)
            finally:
                book.close()
            result = subprocess.run(
                [sys.executable, str(TOOL), str(workbook), "--output", str(output)],
                cwd=root, capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return json.loads(output.read_text(encoding="utf-8"))["companies"]

    def test_unicode_space_grouping_preserves_count_and_salary(self):
        rows = [
            ["Narrow Space Corp", "1\u202f234", "42\u202f000,50"],
            ["Thin Space Corp", "2\u2009234", "52\u2009000.50"],
        ]
        companies = self.convert(rows)
        self.assertEqual([entry["categories"] for entry in companies], [
            {"all_employees": {"count": 1234, "index": 42000.5}},
            {"all_employees": {"count": 2234, "index": 52000.5}},
        ])

    def test_existing_space_groups_and_ambiguous_separators_are_unchanged(self):
        rows = [
            ["ASCII Corp", "1 234", "42 000,50"],
            ["NBSP Corp", "1\u00a0234", "42\u00a0000.50"],
            ["Numeric Corp", 1234, 42000.5],
            ["Ambiguous Corp", "1,234", "42.000"],
        ]
        companies = self.convert(rows)
        expected = {"all_employees": {"count": 1234, "index": 42000.5}}
        self.assertEqual([entry["categories"] for entry in companies[:3]], [expected] * 3)
        self.assertEqual(companies[3]["categories"], {})


if __name__ == "__main__":
    unittest.main()

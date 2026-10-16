"""Workbook blank rows must not make the generated salary data invalid."""
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


@unittest.skipUnless(openpyxl, "requires optional openpyxl (installed in CI)")
class EmptyCompanyWorkbookCLI(unittest.TestCase):
    def convert_and_validate(self, blank):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            workbook = root / "salary.xlsx"
            output = root / "salary_data.json"
            book = openpyxl.Workbook()
            try:
                book.active.append(["Company", "Count", "Index"])
                book.active.append(["Acme Corp", 12, 105])
                book.active.append([blank, 20, 110])
                book.save(workbook)
            finally:
                book.close()
            conversion = subprocess.run(
                [sys.executable, str(REPO / "tools/convert_salary_excel.py"), str(workbook), "--output", str(output)],
                capture_output=True, text=True, encoding="utf-8",
            )
            self.assertEqual(conversion.returncode, 0, conversion.stderr)
            shutil.copyfile(REPO / "salary_lookup.py", root / "salary_lookup.py")
            validation = subprocess.run(
                [sys.executable, str(root / "salary_lookup.py"), "--validate"],
                capture_output=True, text=True, encoding="utf-8",
            )
            self.assertEqual(validation.returncode, 0, validation.stdout + validation.stderr)
            data = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(data["companies"], [{"company": "Acme Corp", "city": "", "categories": {
                "all_employees": {"count": 12, "index": 105.0}}}])

    def test_space_only_company_rows_are_skipped(self):
        self.convert_and_validate(" \u00a0 ")

    def test_truly_empty_company_rows_are_still_skipped(self):
        self.convert_and_validate(None)

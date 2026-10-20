"""A salary category must not steal the workbook's company-name column."""
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
class CompanyHeaderCLI(unittest.TestCase):
    def convert(self, header):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            workbook, output = root / "salary.xlsx", root / "salary.json"
            book = openpyxl.Workbook()
            try:
                book.active.append(header)
                book.active.append(["Acme Corp", "Berlin", 25, 108.5])
                book.save(workbook)
            finally:
                book.close()
            result = subprocess.run(
                [sys.executable, str(TOOL), str(workbook), "--output", str(output)],
                capture_output=True, text=True, encoding="utf-8",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(output.read_text(encoding="utf-8"))["companies"]

    def test_company_prefixed_salary_columns_do_not_replace_the_company(self):
        self.assertEqual(self.convert(["Company", "City", "Company Count", "Company Index"]), [
            {"company": "Acme Corp", "city": "Berlin", "categories": {
                "company": {"count": 25, "index": 108.5}}}
        ])

    def test_existing_named_category_control(self):
        self.assertEqual(self.convert(["Company Name", "City", "Engineering Count", "Engineering Index"]), [
            {"company": "Acme Corp", "city": "Berlin", "categories": {
                "engineering": {"count": 25, "index": 108.5}}}
        ])

    def test_city_prefixed_salary_columns_do_not_replace_the_city(self):
        self.assertEqual(self.convert(["Company", "City", "City Count", "City Index"]), [
            {"company": "Acme Corp", "city": "Berlin", "categories": {
                "city": {"count": 25, "index": 108.5}}}
        ])

import unittest
from types import SimpleNamespace

from tools.convert_salary_excel import (
    INDEX_PATTERNS,
    detect_column_type,
    header_matches,
    parse_sheet,
)


class FakeWorksheet:
    title = "Sheet1"

    def __init__(self, rows):
        self.rows = rows

    def iter_rows(self, min_row=1, max_row=None, values_only=False):
        rows = self.rows[min_row - 1:max_row]
        for row in rows:
            if values_only:
                yield row
            else:
                yield [SimpleNamespace(value=value) for value in row]

    def __getitem__(self, row_number):
        return [SimpleNamespace(value=value) for value in self.rows[row_number - 1]]


class DetectColumnTypeTests(unittest.TestCase):
    def test_index_headers_are_not_misclassified_as_count(self):
        for header in ("Index", "Salary Index", "Engineering Index", "Median salary"):
            with self.subTest(header=header):
                self.assertEqual(detect_column_type(header), "index")

    def test_single_letter_n_only_matches_as_a_token(self):
        self.assertEqual(detect_column_type("Employee n"), "count")
        self.assertEqual(detect_column_type("Engineering"), None)

    def test_count_headers_still_match_common_labels(self):
        for header in ("Count", "Engineering Count", "Antal medarbejdere"):
            with self.subTest(header=header):
                self.assertEqual(detect_column_type(header), "count")

    def test_count_inside_word_does_not_make_count_header(self):
        self.assertIsNone(detect_column_type("Accounting Total"))
        self.assertEqual(detect_column_type("Accounting Index"), "index")

    def test_danish_compound_headers_still_match(self):
        self.assertEqual(detect_column_type("Lønindeks"), "index")

    def test_compound_patterns_match_as_substring_but_others_do_not(self):
        # A compound token (Danish "løn") matches inside a glued header word.
        self.assertTrue(header_matches("lønindeks", INDEX_PATTERNS))
        # A pattern that is not a compound token ("salary") only matches as a
        # whole token, so it must not match inside an unrelated glued word.
        self.assertFalse(header_matches("salaryindex", INDEX_PATTERNS))
        self.assertTrue(header_matches("salary index", INDEX_PATTERNS))

    def test_parse_sheet_preserves_category_name_with_letter_n(self):
        ws = FakeWorksheet([
            ("Company", "Engineering Count", "Engineering Index"),
            ("Example Corp", 12, 105.5),
        ])

        companies = parse_sheet(ws)

        self.assertEqual(companies[0]["categories"]["engineering"], {"count": 12, "index": 105.5})

    def test_parse_sheet_groups_accounting_count_index_pair(self):
        ws = FakeWorksheet([
            ("Company", "Accounting Count", "Accounting Index"),
            ("Example Corp", 12, 105.5),
        ])

        companies = parse_sheet(ws)

        self.assertEqual(companies[0]["categories"]["accounting"], {"count": 12, "index": 105.5})

    def test_parse_sheet_normalizes_paired_category_name_with_underscores(self):
        ws = FakeWorksheet([
            ("Company", "Software Engineering Count", "Software Engineering Index"),
            ("Example Corp", 8, 110.0),
        ])

        companies = parse_sheet(ws)

        self.assertEqual(companies[0]["categories"]["software_engineering"], {"count": 8, "index": 110.0})

    def test_parse_sheet_detects_company_column_with_token_header(self):
        # Real-world salary sheets rarely use the bare token "Company";
        # headers like "Company Name" / "Employer Name" must still be
        # detected as the company column (previously silently skipped -> []).
        for header in ("Company", "Company Name", "Employer Name"):
            with self.subTest(header=header):
                ws = FakeWorksheet([
                    (header, "Salary"),
                    ("Example Corp", 105.5),
                ])
                companies = parse_sheet(ws)
                self.assertEqual(len(companies), 1)
                self.assertEqual(companies[0]["company"], "Example Corp")
                self.assertEqual(
                    companies[0]["categories"]["salary"], {"index": 105.5}
                )

    def test_parse_sheet_detects_city_column_with_token_header(self):
        # City headers are matched with the same token-based header_matches()
        # used for the company column, not exact string equality. Real-world
        # sheets rarely use the bare token "City" or "Kommune" alone; headers
        # like "City Name" / "City/Kommune" must still be detected as the city
        # column (previously silently left as city_col=None -> empty city).
        for header in ("City", "City Name", "Kommune", "City/Kommune"):
            with self.subTest(header=header):
                ws = FakeWorksheet([
                    ("Company", header, "Salary"),
                    ("Example Corp", "Aarhus", 105.5),
                ])
                companies = parse_sheet(ws)
                self.assertEqual(len(companies), 1)
                self.assertEqual(companies[0]["city"], "Aarhus")

    def test_skips_free_text_column(self):
        # A free-text "Notes" column must not become a bogus salary category.
        ws = FakeWorksheet([
            ("Company", "Salary Index", "Notes"),
            ("Example Corp", 105.5, "good"),
        ])

        companies = parse_sheet(ws)

        self.assertIn("salary_index", companies[0]["categories"])
        self.assertNotIn("notes", companies[0]["categories"])

    def test_skips_numeric_identifier_column(self):
        # A numeric "Id" column (employee id) must not be treated as a salary index.
        ws = FakeWorksheet([
            ("Company", "Salary Index", "Id"),
            ("Example Corp", 105.5, 7),
        ])

        companies = parse_sheet(ws)

        self.assertIn("salary_index", companies[0]["categories"])
        self.assertNotIn("id", companies[0]["categories"])

    def test_keeps_numeric_salary_column(self):
        # A genuine numeric salary column still produces a salary category.
        ws = FakeWorksheet([
            ("Company", "Salary Index"),
            ("Example Corp", 105.5),
        ])

        companies = parse_sheet(ws)

        self.assertIn("salary_index", companies[0]["categories"])
        self.assertEqual(companies[0]["categories"]["salary_index"], {"index": 105.5})


if __name__ == "__main__":
    unittest.main()

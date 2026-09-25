import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.verify_pdf import (
    VerificationError,
    build_parser,
    extract_text_layer,
    find_non_ascii_date_ranges,
    normalize_text,
    parse_page_count,
    run_tool,
    verify_pdf,
)


class ParsePageCountTests(unittest.TestCase):
    def test_parses_pdfinfo_page_count(self):
        self.assertEqual(parse_page_count("Title: Example\nPages:          2\n"), 2)

    def test_rejects_output_without_page_count(self):
        with self.assertRaisesRegex(VerificationError, "did not contain a page count"):
            parse_page_count("Title: Example\n")


class NormalizeTextTests(unittest.TestCase):
    """`--contains` must see through what LaTeX does to plain source text.

    Measured on the stock CV compiled with the documented `lualatex` command
    (#385): the apostrophe in `Master's` reaches the text layer as U+2019 and
    the `--` in `2016--2024` as U+2013, so a whitespace-only fold reports both
    keywords missing from a CV that plainly contains them. Under pdflatex
    without T1 font encoding, accents arrive decomposed (`e` + U+0300) instead
    of precomposed (#384).
    """

    def test_folds_curly_apostrophe_to_ascii(self):
        self.assertEqual(normalize_text("Master\u2019s degree"), "Master's degree")
        self.assertEqual(normalize_text("\u2018quoted\u2019"), "'quoted'")

    def test_folds_curly_double_quotes_to_ascii(self):
        self.assertEqual(normalize_text("\u201cSix Sigma\u201d"), '"Six Sigma"')

    def test_folds_en_and_em_dashes_to_hyphen(self):
        self.assertEqual(normalize_text("2016\u20132024"), "2016-2024")
        self.assertEqual(normalize_text("role\u2014title"), "role-title")

    def test_folds_no_break_space_to_space(self):
        self.assertEqual(normalize_text("EUR\u00a0600k"), "EUR 600k")

    def test_folds_decomposed_accents_to_nfc(self):
        decomposed = "Gene\u0300ve Universite\u0301"
        precomposed = "Gen\u00e8ve Universit\u00e9"
        self.assertEqual(normalize_text(decomposed), precomposed)

    def test_still_collapses_whitespace(self):
        self.assertEqual(normalize_text("Professional\n   Experience "), "Professional Experience")

    def test_fold_is_symmetric(self):
        # A user who pastes the curly form from a posting must match an ASCII layer too.
        self.assertEqual(normalize_text("Master\u2019s"), normalize_text("Master's"))


class FindNonAsciiDateRangesTests(unittest.TestCase):
    """The date-range rule reads the raw layer; `--contains` folds and cannot.

    `05-cv-templates.md` documents a Workday import that dropped a role's end
    date because `2016--2024` reaches the text layer as `2016<U+2013>2024`, and
    asks Step 5d to confirm every entry's years are joined by an ASCII hyphen.
    The fold that makes `--contains "2016-2024"` pass on that layer (#458) is
    what makes `--contains` unable to detect it - so this check never folds.
    """

    def test_en_dash_between_years_is_reported_with_its_code_point(self):
        hits = find_non_ascii_date_ranges("Six Sigma Green Belt, 2016\u20132024.\n")
        self.assertEqual(hits, [("Six Sigma Green Belt, 2016\u20132024.", "\u2013")])

    def test_ascii_hyphen_range_is_clean(self):
        self.assertEqual(find_non_ascii_date_ranges("2016-2024\nMar 2016 - Jul 2016\n"), [])

    def test_a_year_on_either_side_of_the_dash_is_enough(self):
        # Month-qualified and open-ended ranges: the year is only on one side.
        for text in ("Mar 2016 \u2013 Jul 2016", "2016 \u2013 Present", "\u2013 2024"):
            with self.subTest(text=text):
                self.assertEqual(len(find_non_ascii_date_ranges(text)), 1)

    def test_other_unicode_dashes_and_the_minus_sign_are_caught(self):
        for dash in ("\u2010", "\u2011", "\u2012", "\u2014", "\u2015", "\u2212"):
            with self.subTest(dash=dash):
                self.assertEqual(find_non_ascii_date_ranges(f"2016{dash}2024")[0][1], dash)

    def test_numeric_range_without_a_year_is_not_a_date(self):
        # 05-cv-templates.md keeps `--` in prose ranges like EUR 600k--1M.
        self.assertEqual(find_non_ascii_date_ranges("EUR 600k\u20131M, 12\u201315 people"), [])

    def test_hits_are_reported_in_document_order_one_per_range(self):
        text = "2016\u20132024 role\nmore text\nJan 2010 \u2013 Dec 2012 degree\n"
        self.assertEqual(
            [line for line, _ in find_non_ascii_date_ranges(text)],
            ["2016\u20132024 role", "Jan 2010 \u2013 Dec 2012 degree"],
        )


class VerifyPdfTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.pdf = Path(self.temp_dir.name) / "example.pdf"
        self.pdf.touch()

    def tearDown(self):
        self.temp_dir.cleanup()

    @patch("tools.verify_pdf._extract_pypdf", return_value=None)
    @patch("tools.verify_pdf.run_tool")
    def test_accepts_expected_pages_and_text(self, mock_run_tool, _pypdf):
        mock_run_tool.side_effect = [
            "Professional\nExperience   [your.email@example.com]\n",
            "Pages:          2\n",
        ]

        verify_pdf(
            self.pdf,
            expected_pages=2,
            min_chars=20,
            required_text=("Professional Experience", "[your.email@example.com]"),
        )

    @patch("tools.verify_pdf._extract_pypdf", return_value=None)
    @patch("tools.verify_pdf.run_tool")
    def test_rejects_wrong_page_count(self, mock_run_tool, _pypdf):
        mock_run_tool.side_effect = ["ok", "Pages:          3\n"]

        with self.assertRaisesRegex(VerificationError, "expected 2 page.*found 3"):
            verify_pdf(self.pdf, expected_pages=2)

    @patch("tools.verify_pdf._extract_pypdf", return_value=None)
    @patch("tools.verify_pdf.run_tool")
    def test_rejects_too_little_extractable_text(self, mock_run_tool, _pypdf):
        mock_run_tool.side_effect = ["short", "Pages:          1\n"]

        with self.assertRaisesRegex(VerificationError, "expected at least 20"):
            verify_pdf(self.pdf, min_chars=20)

    @patch("tools.verify_pdf._extract_pypdf", return_value=None)
    @patch("tools.verify_pdf.run_tool")
    def test_rejects_missing_required_text(self, mock_run_tool, _pypdf):
        mock_run_tool.side_effect = [
            "Readable text, but not the expected section.",
            "Pages:          1\n",
        ]

        with self.assertRaisesRegex(VerificationError, "Professional Experience"):
            verify_pdf(self.pdf, required_text=("Professional Experience",))

    @patch("tools.verify_pdf._extract_pypdf", return_value=None)
    @patch("tools.verify_pdf.run_tool")
    def test_required_text_matches_latex_typographic_substitutions(self, mock_run_tool, _pypdf):
        # What the stock template's lualatex text layer actually contains for the
        # source `Master's degree ... 2016--2024` (code points measured, see class
        # docstring of NormalizeTextTests).
        mock_run_tool.side_effect = [
            "Master\u2019s degree in Statistics. Six Sigma Green Belt, 2016\u20132024.\n",
            "Pages:          1\n",
        ]

        verify_pdf(self.pdf, required_text=("Master's degree", "2016-2024"))

    @patch("tools.verify_pdf._extract_pypdf", return_value=None)
    @patch("tools.verify_pdf.run_tool")
    def test_required_text_matches_decomposed_pdflatex_accents(self, mock_run_tool, _pypdf):
        mock_run_tool.side_effect = [
            "Universite\u0301 de Gene\u0300ve\n",  # pdflatex without T1 fontenc
            "Pages:          1\n",
        ]

        verify_pdf(self.pdf, required_text=("Universit\u00e9 de Gen\u00e8ve",))

    @patch("tools.verify_pdf._extract_pypdf", return_value=None)
    @patch("tools.verify_pdf.run_tool")
    def test_dump_text_keeps_the_raw_layer_unfolded(self, mock_run_tool, _pypdf):
        # The fold is comparison-time only: the ATS parser sees the raw layer, and
        # the date-range rule in 05-cv-templates.md needs the en-dash visible here.
        mock_run_tool.side_effect = ["2016\u20132024\n", "Pages:          1\n"]
        dump = Path(self.temp_dir.name) / "dump.txt"

        verify_pdf(self.pdf, required_text=("2016-2024",), dump_text=dump)

        self.assertEqual(dump.read_text(encoding="utf-8"), "2016\u20132024\n")

    @patch("tools.verify_pdf._extract_pypdf", return_value=None)
    @patch("tools.verify_pdf.run_tool")
    def test_ascii_dates_rejects_the_en_dash_range_that_contains_accepts(self, mock_run_tool, _pypdf):
        # The same layer, two verdicts: --contains folds U+2013 to "-" and passes;
        # --ascii-dates reads the raw layer and fails, naming the code point.
        layer = "Role Title 2016\u20132024\n"
        mock_run_tool.side_effect = [layer, "Pages:          1\n", layer, "Pages:          1\n"]

        verify_pdf(self.pdf, required_text=("2016-2024",))

        with self.assertRaisesRegex(VerificationError, r"U\+2013.*2016\u20132024"):
            verify_pdf(self.pdf, required_text=("2016-2024",), ascii_dates=True)

    @patch("tools.verify_pdf._extract_pypdf", return_value=None)
    @patch("tools.verify_pdf.run_tool")
    def test_ascii_dates_accepts_hyphen_ranges(self, mock_run_tool, _pypdf):
        mock_run_tool.side_effect = ["Role Title 2016-2024\nMar 2016 - Jul 2016\n", "Pages:          1\n"]

        verify_pdf(self.pdf, ascii_dates=True)

    @patch("tools.verify_pdf._extract_pypdf", return_value=None)
    @patch("tools.verify_pdf.run_tool")
    def test_ascii_dates_still_writes_the_dump_before_failing(self, mock_run_tool, _pypdf):
        mock_run_tool.side_effect = ["2016\u20132024\n", "Pages:          1\n"]
        dump = Path(self.temp_dir.name) / "dump.txt"

        with self.assertRaises(VerificationError):
            verify_pdf(self.pdf, dump_text=dump, ascii_dates=True)

        self.assertEqual(dump.read_text(encoding="utf-8"), "2016\u20132024\n")

    def test_ascii_dates_flag_is_off_by_default_and_parses(self):
        self.assertFalse(build_parser().parse_args(["x.pdf"]).ascii_dates)
        self.assertTrue(build_parser().parse_args(["x.pdf", "--ascii-dates"]).ascii_dates)

    def test_rejects_missing_pdf(self):
        with self.assertRaisesRegex(VerificationError, "PDF does not exist"):
            verify_pdf(Path(self.temp_dir.name) / "missing.pdf")

    @patch("tools.verify_pdf._extract_pypdf", return_value=("Hello ATS body", 1))
    def test_pypdf_is_preferred_over_poppler(self, _pypdf):
        text, pages, extractor = extract_text_layer(self.pdf)
        self.assertEqual(extractor, "pypdf")
        self.assertEqual(text, "Hello ATS body")
        self.assertEqual(pages, 1)

    @patch("tools.verify_pdf._extract_pypdf", return_value=None)
    @patch("tools.verify_pdf.run_tool")
    def test_falls_back_to_pdftotext(self, mock_run_tool, _pypdf):
        mock_run_tool.side_effect = ["poppler text", "Pages:          2\n"]
        text, pages, extractor = extract_text_layer(self.pdf)
        self.assertEqual(extractor, "pdftotext")
        self.assertEqual(text, "poppler text")
        self.assertEqual(pages, 2)
        self.assertEqual(mock_run_tool.call_args_list[0][0][0][:3], ["pdftotext", "-layout", "-enc"])


class RunToolTests(unittest.TestCase):
    @patch("tools.verify_pdf.subprocess.run", side_effect=FileNotFoundError)
    def test_reports_missing_poppler_command(self, _mock_run):
        with self.assertRaisesRegex(VerificationError, "pip install pypdf"):
            run_tool(["pdftotext", "example.pdf", "-"])

    @patch("tools.verify_pdf.subprocess.run")
    def test_reports_unreadable_pdf(self, mock_run):
        mock_run.side_effect = subprocess.CalledProcessError(
            1, ["pdfinfo", "example.pdf"], stderr="invalid PDF"
        )

        with self.assertRaisesRegex(VerificationError, "invalid PDF"):
            run_tool(["pdfinfo", "example.pdf"])


if __name__ == "__main__":
    unittest.main()

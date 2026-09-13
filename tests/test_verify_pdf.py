import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.verify_pdf import (
    VerificationError,
    extract_text_layer,
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

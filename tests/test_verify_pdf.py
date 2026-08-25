import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.extract_pdf_text import Extraction, ExtractionError
from tools.verify_pdf import VerificationError, parse_page_count, run_tool, verify_pdf


class ParsePageCountTests(unittest.TestCase):
    def test_parses_pdfinfo_page_count(self):
        self.assertEqual(parse_page_count("Title: Example\nPages:          2\n"), 2)

    def test_rejects_output_without_page_count(self):
        with self.assertRaisesRegex(VerificationError, "did not contain a page count"):
            parse_page_count("Title: Example\n")


class VerifyPdfTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.pdf = Path(self.temp_dir.name) / "example.pdf"
        self.pdf.touch()

    def tearDown(self):
        self.temp_dir.cleanup()

    @patch("tools.verify_pdf.extract_pdf_text")
    def test_accepts_expected_pages_and_text(self, mock_extract):
        mock_extract.return_value = Extraction(
            text="Professional\nExperience   [your.email@example.com]\n",
            pages=2,
            extractor="pymupdf",
        )

        result = verify_pdf(
            self.pdf,
            expected_pages=2,
            min_chars=20,
            required_text=("Professional Experience", "[your.email@example.com]"),
            use_cache=False,
        )
        self.assertEqual(result.extractor, "pymupdf")

    @patch("tools.verify_pdf.extract_pdf_text")
    def test_rejects_wrong_page_count(self, mock_extract):
        mock_extract.return_value = Extraction(text="ok", pages=3, extractor="pypdf")

        with self.assertRaisesRegex(VerificationError, "expected 2 page.*found 3"):
            verify_pdf(self.pdf, expected_pages=2, use_cache=False)

    @patch("tools.verify_pdf.extract_pdf_text")
    def test_rejects_too_little_extractable_text(self, mock_extract):
        mock_extract.return_value = Extraction(text="short", pages=1, extractor="pymupdf")

        with self.assertRaisesRegex(VerificationError, "expected at least 20"):
            verify_pdf(self.pdf, min_chars=20, use_cache=False)

    @patch("tools.verify_pdf.extract_pdf_text")
    def test_rejects_missing_required_text(self, mock_extract):
        mock_extract.return_value = Extraction(
            text="Readable text, but not the expected section.",
            pages=1,
            extractor="pymupdf",
        )

        with self.assertRaisesRegex(VerificationError, "Professional Experience"):
            verify_pdf(self.pdf, required_text=("Professional Experience",), use_cache=False)

    @patch("tools.verify_pdf.extract_pdf_text")
    def test_names_extractor_in_failure(self, mock_extract):
        mock_extract.return_value = Extraction(text="nope", pages=1, extractor="pypdf")

        with self.assertRaisesRegex(VerificationError, "extractor: pypdf"):
            verify_pdf(self.pdf, required_text=("must appear",), use_cache=False)

    @patch("tools.verify_pdf.extract_pdf_text", side_effect=ExtractionError("pip install pymupdf"))
    def test_surfaces_extraction_failure(self, _mock_extract):
        with self.assertRaisesRegex(VerificationError, "pip install pymupdf"):
            verify_pdf(self.pdf, use_cache=False)

    def test_rejects_missing_pdf(self):
        with self.assertRaisesRegex(VerificationError, "PDF does not exist"):
            verify_pdf(Path(self.temp_dir.name) / "missing.pdf")


class RunToolTests(unittest.TestCase):
    @patch("tools.verify_pdf.subprocess.run", side_effect=FileNotFoundError)
    def test_reports_missing_poppler_command(self, _mock_run):
        with self.assertRaisesRegex(VerificationError, "install poppler-utils"):
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

"""Fallback-chain, cache, and CLI tests for tools/extract_pdf_text.py."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.extract_pdf_text import (
    DEFAULT_CHAIN,
    POPPLER_FIRST_CHAIN,
    Extraction,
    ExtractionError,
    extract_pdf_text,
    main,
    resolve_chain,
)


def _tiny_pdf(directory: Path) -> Path:
    path = directory / "sample.pdf"
    path.write_bytes(b"%PDF-1.4\n%tiny\n")
    return path


class ResolveChainTests(unittest.TestCase):
    def test_auto_prefers_python_extractors(self):
        self.assertEqual(resolve_chain("auto"), DEFAULT_CHAIN)
        self.assertEqual(DEFAULT_CHAIN[0], "pymupdf")

    def test_poppler_alias_tries_pdftotext_first(self):
        self.assertEqual(resolve_chain("pdftotext"), POPPLER_FIRST_CHAIN)
        self.assertEqual(resolve_chain("poppler")[0], "pdftotext")

    @patch.dict("os.environ", {"ATS_EXTRACTOR": "pdftotext"})
    def test_env_var_selects_poppler_first(self):
        self.assertEqual(resolve_chain(), POPPLER_FIRST_CHAIN)


class ExtractPdfTextTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.pdf = _tiny_pdf(Path(self.temp_dir.name))

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_missing_pdf_errors(self):
        with self.assertRaisesRegex(ExtractionError, "does not exist"):
            extract_pdf_text(Path(self.temp_dir.name) / "missing.pdf")

    def test_uses_first_available_extractor(self):
        calls = []

        def pymupdf(_path):
            calls.append("pymupdf")
            return None

        def pypdf(_path):
            calls.append("pypdf")
            return Extraction(text="Hello ATS", pages=1, extractor="pypdf")

        def pdftotext(_path):
            calls.append("pdftotext")
            raise AssertionError("should not reach pdftotext")

        result = extract_pdf_text(
            self.pdf,
            use_cache=False,
            extractors={"pymupdf": pymupdf, "pypdf": pypdf, "pdftotext": pdftotext},
        )
        self.assertEqual(result.extractor, "pypdf")
        self.assertEqual(result.text, "Hello ATS")
        self.assertEqual(calls, ["pymupdf", "pypdf"])

    def test_poppler_first_when_requested(self):
        order = []

        def pdftotext(_path):
            order.append("pdftotext")
            return Extraction(text="from poppler", pages=2, extractor="pdftotext")

        def pymupdf(_path):
            order.append("pymupdf")
            raise AssertionError("python extractor should not run")

        result = extract_pdf_text(
            self.pdf,
            prefer="pdftotext",
            use_cache=False,
            extractors={"pdftotext": pdftotext, "pymupdf": pymupdf, "pypdf": lambda _: None},
        )
        self.assertEqual(result.extractor, "pdftotext")
        self.assertEqual(order, ["pdftotext"])

    def test_all_missing_explains_windows_install(self):
        with self.assertRaisesRegex(ExtractionError, "pip install pymupdf"):
            extract_pdf_text(
                self.pdf,
                use_cache=False,
                extractors={
                    "pymupdf": lambda _: None,
                    "pypdf": lambda _: None,
                    "pdftotext": lambda _: None,
                },
            )

    def test_cache_skips_extractor_on_second_call(self):
        calls = {"n": 0}

        def pymupdf(_path):
            calls["n"] += 1
            return Extraction(text="cached body", pages=1, extractor="pymupdf")

        first = extract_pdf_text(
            self.pdf,
            use_cache=True,
            extractors={"pymupdf": pymupdf, "pypdf": lambda _: None, "pdftotext": lambda _: None},
        )
        second = extract_pdf_text(
            self.pdf,
            use_cache=True,
            extractors={"pymupdf": pymupdf, "pypdf": lambda _: None, "pdftotext": lambda _: None},
        )
        self.assertEqual(calls["n"], 1)
        self.assertFalse(first.cached)
        self.assertTrue(second.cached)
        self.assertEqual(second.text, "cached body")
        self.assertEqual(second.extractor, "pymupdf")
        cache_files = list((self.pdf.parent / ".pdf_extract_cache").glob("*.json"))
        self.assertEqual(len(cache_files), 1)


class ExtractCliTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.pdf = _tiny_pdf(Path(self.temp_dir.name))

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_cli_writes_sidecar_and_prints_extractor(self):
        output = Path(self.temp_dir.name) / "out.txt"

        def pymupdf(_path):
            return Extraction(text="CLI text", pages=1, extractor="pymupdf")

        with patch("tools.extract_pdf_text.EXTRACTORS", {"pymupdf": pymupdf}):
            code = main([str(self.pdf), "-o", str(output), "--no-cache"])
        self.assertEqual(code, 0)
        self.assertEqual(output.read_text(encoding="utf-8"), "CLI text\n")

    def test_cli_json_includes_extractor_name(self):
        def pymupdf(_path):
            return Extraction(text="json body", pages=3, extractor="pymupdf")

        with patch("tools.extract_pdf_text.EXTRACTORS", {"pymupdf": pymupdf}):
            with patch("sys.stdout") as stdout:
                stdout.write = lambda chunk: setattr(self, "payload", chunk) or len(chunk)
                code = main([str(self.pdf), "--json", "--no-cache"])
        self.assertEqual(code, 0)
        parsed = json.loads(self.payload)
        self.assertEqual(parsed["extractor"], "pymupdf")
        self.assertEqual(parsed["pages"], 3)
        self.assertEqual(parsed["text"], "json body")


if __name__ == "__main__":
    unittest.main()

"""Guards for the shipped Typst templates."""

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CV = REPO / "templates" / "cv" / "typst-modern"
COVER = REPO / "templates" / "cover_letters" / "typst-modern"
ADD_TEMPLATE = REPO / ".claude" / "commands" / "add-template.md"

REQUIRED_PLACEHOLDERS = (
    "[YOUR_NAME]",
    "[YOUR_EMAIL]",
    "[YOUR_PHONE]",
    "[YOUR_LINKEDIN_URL]",
)


class ShippedTypstTemplates(unittest.TestCase):
    def test_cv_files_exist(self):
        self.assertTrue((CV / "template.typ").is_file())
        self.assertTrue((CV / "TEMPLATE.md").is_file())

    def test_cover_files_exist(self):
        self.assertTrue((COVER / "template.typ").is_file())
        self.assertTrue((COVER / "TEMPLATE.md").is_file())

    def test_placeholders_present(self):
        for path in (CV / "template.typ", COVER / "template.typ"):
            text = path.read_text(encoding="utf-8")
            for token in REQUIRED_PLACEHOLDERS:
                with self.subTest(path=path.name, token=token):
                    self.assertIn(token, text)

    def test_cv_dates_use_ascii_hyphen_in_role_helper(self):
        text = (CV / "template.typ").read_text(encoding="utf-8")
        self.assertIn("[START]-[END]", text)
        self.assertNotRegex(text, r"\[START\]--\[END\]")

    def test_single_column_ats_layout(self):
        for path in (CV / "template.typ", COVER / "template.typ"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("columns(", text)
            self.assertIn("Libertinus Serif", text)

    def test_manifests_declare_typst_compile(self):
        for path in (CV / "TEMPLATE.md", COVER / "TEMPLATE.md"):
            text = path.read_text(encoding="utf-8")
            self.assertIn("typst compile", text)
            self.assertIn(".typ", text)

    def test_add_template_documents_use_typst_shortcut(self):
        text = ADD_TEMPLATE.read_text(encoding="utf-8")
        self.assertIn("--use typst", text)
        self.assertIn("typst-modern", text)
        self.assertIn("Shipped Typst Mode", text)


@unittest.skipUnless(shutil.which("typst"), "typst binary not installed")
class TypstCompileSmoke(unittest.TestCase):
    def test_cv_template_compiles(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "cv.typ"
            src.write_text((CV / "template.typ").read_text(encoding="utf-8"), encoding="utf-8")
            pdf = Path(tmp) / "cv.pdf"
            result = subprocess.run(
                ["typst", "compile", str(src), str(pdf)],
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(pdf.is_file())
            self.assertGreater(pdf.stat().st_size, 1000)

    def test_cover_template_compiles(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "cover.typ"
            src.write_text((COVER / "template.typ").read_text(encoding="utf-8"), encoding="utf-8")
            pdf = Path(tmp) / "cover.pdf"
            result = subprocess.run(
                ["typst", "compile", str(src), str(pdf)],
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(pdf.is_file())

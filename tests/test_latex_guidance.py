"""Guards for the LaTeX authoring guidance and the example documents.

Three silent-failure modes live here, all found by the 2026-08-19 review
(F9, F31, F34). Each one produces a clean compile and a green CI run
while the rendered document or its ATS extraction is wrong, so the spec
files and the example sources are the only place a test can catch them:

- F9: a bullet written as `\\item [text]` is parsed as moderncv's
  optional label, rendered off the left page edge, and dropped from the
  PDF text layer. The example CV shipped that way for months.
- F31: an unescaped `%` in body text silently truncates the rest of the
  line (`&` at least fails loudly). The guidance must name the escapes.
- F34: `pdftotext` without `-enc UTF-8` emits Latin-1 on Xpdf builds,
  so a correct Danish CV fails the documented "no replacement
  characters" check and the agent is sent to "fix" a healthy document.
"""
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SKILL_DIR = REPO / ".claude" / "skills" / "job-application-assistant"
CV_TEMPLATES = SKILL_DIR / "05-cv-templates.md"
COVER_TEMPLATES = SKILL_DIR / "06-cover-letter-templates.md"
APPLY = REPO / ".claude" / "commands" / "apply.md"
EXAMPLE_CV = REPO / "cv" / "main_example.tex"
EXAMPLE_COVER = REPO / "cover_letters" / "cover_example.tex"

# \item whose body starts with [ - with or without whitespace between.
# LaTeX skips spaces while scanning for the optional argument, so
# `\item [text]` and `\item[text]` both swallow the text as a label.
# The safe spelling `\item {[text]}` does not match.
UNBRACED_BRACKET_ITEM = re.compile(r"\\item\s*\[")

# The escapes both guidance files must document. `%` is the load-bearing
# one: it truncates silently. The others fail loudly or corrupt spacing.
REQUIRED_ESCAPES = ["\\&", "\\%", "\\$", "\\#", "\\_"]


def section(text, heading):
    """Return the body of a markdown section up to the next heading."""
    pattern = re.compile(
        rf"^#+ {re.escape(heading)}[^\n]*\n(.*?)(?=^#+ |\Z)",
        re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(text)
    return match.group(1) if match else None


class TestBulletBracketTrap(unittest.TestCase):
    """F9: no document or template doc may teach `\\item [text]`."""

    def assert_no_unbraced_bracket_items(self, path):
        offending = [
            f"{path.name}:{lineno}: {line.strip()}"
            for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
            if UNBRACED_BRACKET_ITEM.search(line)
        ]
        self.assertEqual(
            offending,
            [],
            "\\item followed by [ is parsed as an optional label and the "
            "text is clipped off the page; write \\item {[...]} instead:\n"
            + "\n".join(offending),
        )

    def test_example_cv_has_no_bracket_labelled_bullets(self):
        self.assert_no_unbraced_bracket_items(EXAMPLE_CV)

    def test_example_cover_letter_has_no_bracket_labelled_bullets(self):
        self.assert_no_unbraced_bracket_items(EXAMPLE_COVER)

    def test_cover_letter_guide_does_not_teach_the_broken_pattern(self):
        self.assert_no_unbraced_bracket_items(COVER_TEMPLATES)

    def test_cv_guide_does_not_teach_the_broken_pattern(self):
        self.assert_no_unbraced_bracket_items(CV_TEMPLATES)


class TestSpecialCharacterGuidance(unittest.TestCase):
    """F31: both template guides must document the LaTeX escapes."""

    def assert_escapes_documented(self, path):
        body = section(path.read_text(encoding="utf-8"), "LaTeX Special Characters")
        self.assertIsNotNone(
            body, f"{path.name} has no 'LaTeX Special Characters' section"
        )
        missing = [esc for esc in REQUIRED_ESCAPES if esc not in body]
        self.assertEqual(
            missing,
            [],
            f"{path.name}'s special-characters section is missing: {missing}",
        )

    def test_cv_guide_documents_the_escapes(self):
        self.assert_escapes_documented(CV_TEMPLATES)

    def test_cover_letter_guide_documents_the_escapes(self):
        self.assert_escapes_documented(COVER_TEMPLATES)

    def test_cv_guide_warns_that_percent_truncates_silently(self):
        body = section(
            CV_TEMPLATES.read_text(encoding="utf-8"), "LaTeX Special Characters"
        )
        self.assertIsNotNone(body)
        self.assertRegex(
            body,
            re.compile(r"silent", re.IGNORECASE),
            "the % failure mode must be called out as silent - it is the "
            "reason this section exists (a clean compile with the rest of "
            "the bullet gone)",
        )


class TestAtsExtractionEncoding(unittest.TestCase):
    """F34: every documented extraction command must pin the encoding."""

    def assert_pdftotext_commands_pin_utf8(self, path):
        offending = [
            f"{path.name}:{lineno}: {line.strip()}"
            for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
            if "pdftotext" in line and "-layout" in line and "-enc UTF-8" not in line
        ]
        self.assertEqual(
            offending,
            [],
            "pdftotext without -enc UTF-8 emits Latin-1 on Xpdf builds, so "
            "the ATS check reports phantom replacement characters on any "
            "non-ASCII CV; add -enc UTF-8:\n" + "\n".join(offending),
        )

    def test_apply_extraction_command_pins_utf8(self):
        self.assert_pdftotext_commands_pin_utf8(APPLY)

    def test_cv_guide_extraction_command_pins_utf8(self):
        self.assert_pdftotext_commands_pin_utf8(CV_TEMPLATES)


if __name__ == "__main__":
    unittest.main()

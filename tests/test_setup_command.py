"""Guards for the /setup command spec.

The command is a markdown spec (the spec IS the implementation). These tests pin
one invariant that broke silently: Step 3 must personalise every contact block
that `/apply` later compiles into a document. `cv/main_example.tex` was covered;
the LaTeX blocks embedded in `05-cv-templates.md` and `06-cover-letter-templates.md`
were not, so a full Path B/C run left `[YOUR_NAME]`, `[YOUR_EMAIL]` and
`[YOUR_PHONE]` in both, and whether they reached a compiled cover letter depended
on the drafter noticing. A real user (#420) ran `/setup` and then hand-edited both
files to close the gap.
"""
import os
import unittest
from pathlib import Path

UPSTREAM = "MadsLorentzen/ai-job-search"

REPO = Path(__file__).resolve().parent.parent
COMMAND = REPO / ".claude" / "commands" / "setup.md"
SKILL_DIR = REPO / ".claude" / "skills" / "job-application-assistant"
CV_TEMPLATES = SKILL_DIR / "05-cv-templates.md"
COVER_TEMPLATES = SKILL_DIR / "06-cover-letter-templates.md"


def _sections(text: str) -> dict[str, str]:
    """Split a command spec into {heading: body} by '## ' headers."""
    parts = text.split("\n## ")
    result = {}
    for part in parts[1:]:
        heading, _, body = part.partition("\n")
        result[heading.strip()] = body
    return result


def _substeps(step_body: str) -> dict[str, str]:
    """Split a step body into {'### N. ...' heading: body}."""
    parts = step_body.split("\n### ")
    result = {}
    for part in parts[1:]:
        heading, _, body = part.partition("\n")
        result[heading.strip()] = body
    return result


class SetupStep3ContactBlocks(unittest.TestCase):
    def setUp(self):
        self.step3 = _sections(COMMAND.read_text(encoding="utf-8"))["Step 3: Generate Profile Files"]
        self.substeps = _substeps(self.step3)

    def _substep_for(self, filename: str) -> str:
        matches = [body for heading, body in self.substeps.items() if filename in heading]
        self.assertEqual(len(matches), 1, f"expected exactly one Step 3 substep for {filename}, got {len(matches)}")
        return matches[0]

    def test_cv_templates_substep_fills_the_contact_block(self):
        body = self._substep_for("05-cv-templates.md")
        self.assertIn("contact", body.lower())
        for token in ("[FIRST_NAME]", "[YOUR_EMAIL]", "[YOUR_PHONE]"):
            self.assertIn(token, body, f"the 05 substep must name {token} as something to replace")

    def test_cover_letter_templates_get_their_own_substep(self):
        body = self._substep_for("06-cover-letter-templates.md")
        self.assertIn("signature", body.lower())
        for token in ("[YOUR_NAME]", "[YOUR_EMAIL]", "[YOUR_PHONE]", "[YOUR_LINKEDIN_URL]"):
            self.assertIn(token, body, f"the 06 substep must name {token} as something to replace")

    def test_completion_summary_lists_the_cover_letter_templates(self):
        step4 = _sections(COMMAND.read_text(encoding="utf-8"))["Step 4: Confirm & Next Steps"]
        summary = step4.split("**Privacy note:**")[0]
        self.assertIn("06-cover-letter-templates.md", summary)


@unittest.skipIf(
    os.environ.get("GITHUB_REPOSITORY", UPSTREAM) != UPSTREAM,
    "template-placeholder guard targets the pristine upstream template; forks personalize 05-cv-templates.md and 06-cover-letter-templates.md via /setup",
)
class TemplatesStillCarryThePlaceholders(unittest.TestCase):
    """The instructions above target real tokens; if a template renames them,
    the instruction and this test must move together."""

    def test_cv_templates_contact_block_tokens(self):
        text = CV_TEMPLATES.read_text(encoding="utf-8")
        for token in ("[FIRST_NAME]", "[LAST_NAME]", "[YOUR_EMAIL]", "[YOUR_PHONE]"):
            self.assertIn(token, text)

    def test_cover_letter_templates_contact_and_signature_tokens(self):
        text = COVER_TEMPLATES.read_text(encoding="utf-8")
        for token in ("[YOUR_NAME]", "[YOUR_EMAIL]", "[YOUR_PHONE]", "[YOUR_LINKEDIN_URL]"):
            self.assertIn(token, text)
        self.assertIn("\\signature{[YOUR_NAME]}", text)


class SetupPathAProjectsIngestion(unittest.TestCase):
    """Guards for /setup Path A document ingestion of documents/projects/."""

    def setUp(self):
        self.text = COMMAND.read_text(encoding="utf-8")
        self.sections = _sections(self.text)

    def test_step0_scan_includes_projects(self):
        step0 = self.sections["Step 0: Welcome & Choose Path"]
        self.assertIn("projects/", step0)

    def test_step_a1_inventory_includes_projects(self):
        self.assertIn("**projects/**:", self.text)

    def test_step_a3_parsing_includes_projects_spec(self):
        self.assertIn("`projects/` documents:", self.text)
        self.assertIn("measurable outcomes", self.text)

    def test_step_a5_and_a6_map_to_independent_projects(self):
        self.assertIn("## Independent Projects", self.text)
        self.assertIn("New independent project:", self.text)


if __name__ == "__main__":
    unittest.main()

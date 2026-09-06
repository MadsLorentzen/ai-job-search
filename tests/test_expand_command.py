"""Tests for the /expand command specification."""

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXPAND_COMMAND_FILE = REPO_ROOT / ".claude" / "commands" / "expand.md"


class ExpandCommandTests(unittest.TestCase):
    def test_expand_command_file_exists(self):
        self.assertTrue(EXPAND_COMMAND_FILE.exists(), "expand.md must exist under .claude/commands/")

    def test_expand_command_file_starts_with_correct_header(self):
        text = EXPAND_COMMAND_FILE.read_text(encoding="utf-8")
        first_line = text.lstrip().splitlines()[0]
        self.assertTrue(
            first_line.startswith("# /expand"),
            f"Command file must start with '# /expand', got: {first_line!r}",
        )

    def test_expand_covers_all_discovery_sources(self):
        text = EXPAND_COMMAND_FILE.read_text(encoding="utf-8")
        sources = [
            "documents/cv/",
            "documents/linkedin/",
            "documents/diplomas/",
            "documents/references/",
            "GitHub Profile",
        ]
        for src in sources:
            self.assertIn(src, text, f"expand.md must include discovery source: {src}")

    def test_expand_maps_github_projects_to_independent_projects_section(self):
        text = EXPAND_COMMAND_FILE.read_text(encoding="utf-8")
        self.assertIn("## Independent Projects", text)
        self.assertIn("Independent Projects & Portfolio", text)
        self.assertIn("GitHub — repo-name", text)
        self.assertIn("Portfolio & projects grounded in code", text)
        self.assertNotIn("documents/projects/", text)

    def test_expand_enforces_additive_and_confirmation_principles(self):
        text = EXPAND_COMMAND_FILE.read_text(encoding="utf-8")
        self.assertIn("Additive only", text)
        self.assertIn("User confirms before writing", text)
        self.assertIn("`all`", text)
        self.assertIn("`review`", text)
        self.assertIn("`skip`", text)


if __name__ == "__main__":
    unittest.main()


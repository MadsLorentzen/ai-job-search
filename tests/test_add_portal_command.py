"""Guards for the /add-portal command spec."""
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
COMMAND = REPO / ".claude" / "commands" / "add-portal.md"


class TestAddPortalCommand(unittest.TestCase):
    def test_allowed_tools_specifies_agents_skills_path(self):
        content = COMMAND.read_text(encoding="utf-8")
        self.assertIn(
            "allowed-tools: Bash(bun run .agents/skills/<name>/cli/src/cli.ts *)",
            content,
        )
        self.assertNotIn(
            "allowed-tools: Bash(bun run skills/<name>/cli/src/cli.ts *)", content
        )


if __name__ == "__main__":
    unittest.main()

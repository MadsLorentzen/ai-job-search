"""Guards for /reset's documents scope.

/reset ends its documents pass by telling the user "The `documents/`
folder is now empty." That statement is only true if every personal-data
drop folder is actually covered by both the Step 1 preview and the
Step 3 delete block. `documents/postings/` was missing from both while
being documented in documents/README.md and protected as personal data
by tools/security_guards.py (review finding F26, 2026-08-19), so a reset
silently kept the user's hand-pasted job postings.

The folder list is derived from the repository tree, so adding a new
drop folder under documents/ fails this test until /reset covers it.
"""
import re
import subprocess
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
RESET = REPO / ".claude" / "commands" / "reset.md"


def tracked_document_subfolders():
    """Names of documents/ subfolders tracked in git (ignores local noise)."""
    out = subprocess.run(
        ["git", "ls-files", "documents/"],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    folders = set()
    for line in out.splitlines():
        parts = line.split("/")
        if len(parts) >= 3:  # documents/<subfolder>/<file...>
            folders.add(parts[1])
    return folders


class TestResetCoversEveryDocumentsSubfolder(unittest.TestCase):
    def setUp(self):
        self.text = RESET.read_text(encoding="utf-8")
        self.folders = tracked_document_subfolders()
        # The tree must actually contain the folders this test is about,
        # or the assertions below would pass vacuously.
        self.assertGreaterEqual(len(self.folders), 5, self.folders)

    def test_preview_lists_every_subfolder(self):
        missing = [
            f for f in sorted(self.folders) if f"documents/{f}/" not in self.text
        ]
        self.assertEqual(
            missing,
            [],
            "reset.md's preview never mentions these documents/ subfolders, "
            f"so the user confirms a deletion list that omits them: {missing}",
        )

    def test_delete_block_removes_every_subfolder(self):
        deleted = set(re.findall(r"rm -r?f documents/(\w+)/", self.text))
        missing = sorted(self.folders - deleted)
        self.assertEqual(
            missing,
            [],
            "reset.md's delete block has no rm line for these documents/ "
            'subfolders, yet the command then claims "The `documents/` '
            f'folder is now empty.": {missing}',
        )


if __name__ == "__main__":
    unittest.main()

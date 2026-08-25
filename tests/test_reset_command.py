"""Guards for /reset's two scopes: documents and profile.

Both scopes have the same failure mode - /reset promises a clean slate it
does not deliver, because something that writes personal data is missing
from the Step 1 preview the user confirms and from the Step 3 execution.

Documents scope: /reset ends its documents pass by telling the user "The
`documents/` folder is now empty." That statement is only true if every
personal-data drop folder is actually covered by both the Step 1 preview
and the Step 3 delete block. `documents/postings/` was missing from both
while being documented in documents/README.md and protected as personal
data by tools/security_guards.py (review finding F26, 2026-08-19), so a
reset silently kept the user's hand-pasted job postings.

Profile scope: the same class of gap, one scope over. /setup Step 3
populates six skill files, and /reset profile cleared four of them -
`04-job-evaluation.md` (the user's match areas, career goals, financial
situation and schedule constraints) was listed by name as containing
"framework rules, not candidate data", and `job-scraper/search-queries.md`
(their role titles, city and commute tiers) appeared nowhere in reset.md.
Both are tracked and unignored, and CI's placeholder-integrity job guards
04-job-evaluation.md under "personal data may have been committed", so a
"blank" profile left /rank scoring against the old skills and /scrape
running the old city.

Both file lists are derived - the documents folders from the repository
tree, the profile files from /setup Step 3's own headings - so a new drop
folder or a new /setup target fails this test until /reset covers it.
"""
import re
import subprocess
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
RESET = REPO / ".claude" / "commands" / "reset.md"
SETUP = REPO / ".claude" / "commands" / "setup.md"


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


def section(text: str, start: str, end: str) -> str:
    """The slice of text from the start marker up to the end marker."""
    begin = text.index(start)
    return text[begin : text.index(end, begin)]


def setup_step3_skill_files():
    """Skill files /setup Step 3 populates, derived from its own headings.

    Step 3's targets are written as '### <n>. <verb> `<target>`', where the
    target is either a bare filename resolved against .claude/skills/ or a
    repo-relative path. Non-skill targets (CLAUDE.md, cv/main_example.tex)
    are dropped: /reset profile's scope is skill files only.
    """
    step3 = section(SETUP.read_text(encoding="utf-8"), "## Step 3:", "## Step 4:")
    files = set()
    for target in re.findall(r"^###\s+\d+\.\s+\w+\s+`([^`]+)`", step3, re.MULTILINE):
        if (REPO / target).exists():
            if target.startswith(".claude/skills/"):
                files.add(Path(target).name)
            continue
        matches = list((REPO / ".claude" / "skills").glob(f"*/{target}"))
        if matches:
            files.add(Path(target).name)
    return files


class TestResetCoversEveryPersonalizedSkillFile(unittest.TestCase):
    def setUp(self):
        self.text = RESET.read_text(encoding="utf-8")
        self.files = setup_step3_skill_files()
        # /setup must actually still name these targets, or every assertion
        # below would pass vacuously against an empty set.
        self.assertGreaterEqual(len(self.files), 6, self.files)
        self.assertIn("04-job-evaluation.md", self.files)
        self.assertIn("search-queries.md", self.files)

    def test_preview_lists_every_personalized_skill_file(self):
        preview = section(
            self.text, "### If scope includes `profile`:", "### If scope includes `documents`:"
        )
        missing = sorted(f for f in self.files if f not in preview)
        self.assertEqual(
            missing,
            [],
            "reset.md's profile preview never mentions these files that /setup "
            "Step 3 writes candidate data into, so the user types RESET against "
            f"a list that omits them: {missing}",
        )

    def test_execution_clears_every_personalized_skill_file(self):
        execution = section(self.text, "### Profile reset", "### Documents reset")
        missing = sorted(f for f in self.files if f not in execution)
        self.assertEqual(
            missing,
            [],
            "reset.md's Step 3 profile pass has no instruction for these files, "
            'yet the command then reports the skill files are "now blank": '
            f"{missing}",
        )

    def test_preserved_list_claims_no_personalized_file_is_framework_only(self):
        """A file /setup personalizes must never be listed as framework-only.

        This is the specific regression: 04-job-evaluation.md was named in the
        "NOT touched (they contain framework rules, not candidate data)" list,
        so merely searching reset.md for the filename would have found it.
        """
        preserved = section(self.text, "The following files are NOT touched", "```")
        mislabeled = sorted(f for f in self.files if f in preserved)
        self.assertEqual(
            mislabeled,
            [],
            "reset.md tells the user these files contain 'framework rules, not "
            "candidate data', but /setup Step 3 writes candidate data into them: "
            f"{mislabeled}",
        )


if __name__ == "__main__":
    unittest.main()

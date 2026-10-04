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


SKILL_DIR = REPO / ".claude" / "skills" / "job-application-assistant"


def skeleton_block(reset_text, filename):
    """The fenced markdown /reset writes over `filename` in Step 3."""
    marker = f"**For `{filename}`**, replace the file content with:"
    start = reset_text.index(marker)
    fence_open = reset_text.index("```markdown", start) + len("```markdown")
    fence_close = reset_text.index("```", fence_open)
    return reset_text[fence_open:fence_close]


def h2_headings(text):
    return [line.strip() for line in text.splitlines() if line.startswith("## ")]


class TestResetTargetsTheHeadingsTheShippedFilesHave(unittest.TestCase):
    """Step 3's skeletons and anchors must name sections that exist.

    Two of them drifted from the files they rewrite. The behavioral-profile
    skeleton used "Strongest Behavioral Traits" / "How I Work Best" / "Growth
    Areas" where the shipped file has "Strongest Behaviors" / "How You Work
    Best" / "Growth Areas (frame positively in applications)", and dropped
    "Core Behavioral Drives" - the structured assessment table /setup collects
    and /interview reads - so one reset left the file's headings permanently
    different from every other fork's. The CV-guide step anchored on a line
    beginning "**Profile statement templates", which the guide has never
    contained (its heading is "**Create 2-3 profile statement templates for
    your main role types:**"), so the wipe found nothing and the user's
    role-tailored statements survived a reset that reported success. Both are
    derived here from the shipped files, so a renamed heading fails this test
    until /reset follows it.
    """

    def setUp(self):
        self.reset = RESET.read_text(encoding="utf-8")

    def test_full_file_skeletons_keep_the_shipped_headings(self):
        for filename in ("01-candidate-profile.md", "02-behavioral-profile.md"):
            with self.subTest(file=filename):
                shipped = (SKILL_DIR / filename).read_text(encoding="utf-8")
                self.assertEqual(
                    h2_headings(skeleton_block(self.reset, filename)),
                    h2_headings(shipped),
                    f"/reset's skeleton for {filename} must carry exactly the shipped "
                    "## headings, in order - a reset must not rename or drop sections",
                )

    def test_partial_anchors_exist_in_the_files_they_target(self):
        # (reset.md anchor phrase, file, heading the replacement must re-emit)
        cases = (
            (
                r"locate the section that begins with the line `([^`]+)`",
                "05-cv-templates.md",
            ),
            (
                r"The entire `([^`]+)` section",
                "07-interview-prep.md",
            ),
        )
        for pattern, filename in cases:
            with self.subTest(file=filename):
                match = re.search(pattern, self.reset)
                self.assertIsNotNone(match, f"reset.md no longer states its anchor for {filename}")
                anchor = match.group(1)
                shipped = (SKILL_DIR / filename).read_text(encoding="utf-8")
                self.assertIn(
                    anchor,
                    shipped,
                    f"/reset anchors {filename} on {anchor!r}, which the shipped file does not contain - "
                    "the wipe would silently find nothing",
                )
                # The replacement block re-emits the anchor line so the heading survives the wipe.
                step = self.reset[match.start():]
                block_start = step.index("```markdown") + len("```markdown")
                block = step[block_start: step.index("```", block_start)]
                self.assertIn(anchor, block, f"the replacement for {filename} must keep the heading {anchor!r}")

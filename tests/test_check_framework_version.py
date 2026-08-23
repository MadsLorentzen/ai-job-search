"""Guards for tools/check_framework_version.py - the CI gate itself.

This gate is what stops a PR from editing a profile-bearing framework
file without bumping `framework_version` (the fork-rebase safety marker).
It ran in CI with zero tests, so a one-line mutation
(`return meaningful_changes > 0` -> `return False`) disabled it while
the whole suite stayed green (review finding F22, 2026-08-19). A broken
guard is silent by construction: nothing fails, it just stops catching.

Each test builds an isolated git repo with the script copied inside it
(the script resolves ROOT from __file__), so the real repo is never read
or written.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "tools" / "check_framework_version.py"

FRONTMATTER = "---\nframework_version: 1.0.0\n---\n"
BODY = "# Test framework file\n\nOriginal guidance sentence.\n"


class CheckerRepoFixture(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

        tools = self.root / "tools"
        tools.mkdir()
        shutil.copy(SCRIPT, tools / "check_framework_version.py")

        self.skill_dir = self.root / ".claude" / "skills" / "job-application-assistant"
        self.skill_dir.mkdir(parents=True)
        self.framework_file = self.skill_dir / "01-test-profile.md"
        self.framework_file.write_text(FRONTMATTER + BODY, encoding="utf-8")

        self.git("init", "-q")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "base")

    def git(self, *args):
        subprocess.run(
            ["git", "-c", "user.name=test", "-c", "user.email=test@example.com", *args],
            cwd=self.root,
            check=True,
            capture_output=True,
            text=True,
        )

    def run_checker(self):
        # Strip GitHub Actions variables so get_base_commit() takes the
        # local path (uncommitted changes vs HEAD) regardless of where the
        # test suite itself runs.
        env = {k: v for k, v in os.environ.items() if not k.startswith("GITHUB_")}
        return subprocess.run(
            [sys.executable, str(self.root / "tools" / "check_framework_version.py")],
            capture_output=True,
            text=True,
            env=env,
        )


class FrameworkVersionGateTests(CheckerRepoFixture):
    def test_clean_tree_passes(self):
        result = self.run_checker()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Framework Version Check: OK", result.stdout)

    def test_unbumped_edit_fails(self):
        self.framework_file.write_text(
            FRONTMATTER + BODY + "\nA new sentence without a version bump.\n",
            encoding="utf-8",
        )

        result = self.run_checker()

        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("modified without bumping 'framework_version'", result.stdout)

    def test_bumped_edit_passes(self):
        bumped = FRONTMATTER.replace("1.0.0", "1.0.1")
        self.framework_file.write_text(
            bumped + BODY + "\nA new sentence with a version bump.\n",
            encoding="utf-8",
        )

        result = self.run_checker()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_file_without_version_marker_fails(self):
        (self.skill_dir / "02-unmarked.md").write_text(
            "# No frontmatter at all\n", encoding="utf-8"
        )

        result = self.run_checker()

        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("missing 'framework_version'", result.stdout)


if __name__ == "__main__":
    unittest.main()

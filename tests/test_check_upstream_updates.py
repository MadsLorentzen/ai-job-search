import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "tools" / "check_upstream_updates.py"

TEMPLATE_URL = "https://github.com/MadsLorentzen/ai-job-search.git"
FORK_URL = "https://github.com/octocat/ai-job-search.git"

FRAMEWORK_FILES = [
    ".claude/skills/job-application-assistant/01-candidate-profile.md",
    ".claude/skills/job-application-assistant/02-behavioral-profile.md",
    ".claude/skills/job-application-assistant/03-writing-style.md",
    ".claude/skills/job-application-assistant/04-job-evaluation.md",
    ".claude/skills/job-application-assistant/05-cv-templates.md",
    ".claude/skills/job-application-assistant/06-cover-letter-templates.md",
    ".claude/skills/job-application-assistant/07-interview-prep.md",
    ".claude/skills/job-application-assistant/08-application-forms.md",
    ".claude/skills/job-application-assistant/SKILL.md",
    "AGENTS.md",
]

FRONTMATTER = "---\nframework_version: 1.0.0\n---\n"


class UpstreamCheckerRepoFixture(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

        tools = self.root / "tools"
        tools.mkdir()
        shutil.copy(SCRIPT, tools / "check_upstream_updates.py")

        for rel in FRAMEWORK_FILES:
            path = self.root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(FRONTMATTER, encoding="utf-8")

        subprocess.run(["git", "init", "-b", "master"], cwd=self.root, check=True, capture_output=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=self.root, check=True, capture_output=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=self.root, check=True, capture_output=True)
        subprocess.run(["git", "add", "-A"], cwd=self.root, check=True, capture_output=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=self.root, check=True, capture_output=True)

    def add_remote(self, name: str, url: str) -> None:
        subprocess.run(["git", "remote", "add", name, url], cwd=self.root, check=True, capture_output=True)

    def materialize_remote_ref(self, name: str) -> None:
        subprocess.run(
            ["git", "update-ref", f"refs/remotes/{name}/master", "HEAD"],
            cwd=self.root,
            check=True,
            capture_output=True,
        )

    def run_checker(self, *args) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(self.root / "tools" / "check_upstream_updates.py"), "--no-fetch", *args],
            cwd=self.root,
            capture_output=True,
            text=True,
        )


class ForkWithoutUpstreamRemoteTests(UpstreamCheckerRepoFixture):
    def setUp(self):
        super().setUp()
        self.add_remote("origin", FORK_URL)
        self.materialize_remote_ref("origin")

    def test_fork_fallback_warns_that_check_is_against_own_fork(self):
        result = self.run_checker("--remote", "upstream")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Falling back to 'origin'", result.stdout)
        self.assertIn("does not point to the ai-job-search template repo", result.stdout)
        self.assertNotIn("up to date with upstream!", result.stdout)
        self.assertIn("up to date with origin/master", result.stdout)


class DirectCloneFallbackTests(UpstreamCheckerRepoFixture):
    def setUp(self):
        super().setUp()
        self.add_remote("origin", TEMPLATE_URL)
        self.materialize_remote_ref("origin")

    def test_clone_of_template_falls_back_without_fork_warning(self):
        result = self.run_checker("--remote", "upstream")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Falling back to 'origin'", result.stdout)
        self.assertNotIn("does not point to the ai-job-search template repo", result.stdout)
        self.assertIn("up to date with origin/master", result.stdout)

    def test_clone_with_lowercased_template_url_falls_back_without_fork_warning(self):
        # GitHub serves repo paths case-insensitively, so a clone from
        # https://github.com/madslorentzen/ai-job-search is still the template.
        subprocess.run(
            ["git", "remote", "set-url", "origin", TEMPLATE_URL.lower()],
            cwd=self.root,
            check=True,
            capture_output=True,
        )

        result = self.run_checker("--remote", "upstream")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Falling back to 'origin'", result.stdout)
        self.assertNotIn("does not point to the ai-job-search template repo", result.stdout)


class UpstreamRemotePresentTests(UpstreamCheckerRepoFixture):
    def setUp(self):
        super().setUp()
        self.add_remote("origin", FORK_URL)
        self.add_remote("upstream", TEMPLATE_URL)
        self.materialize_remote_ref("upstream")

    def test_explicit_upstream_remote_is_used_without_warning(self):
        result = self.run_checker()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("Falling back to 'origin'", result.stdout)
        self.assertNotIn("does not point to the ai-job-search template repo", result.stdout)
        self.assertIn("up to date with upstream/master", result.stdout)


if __name__ == "__main__":
    unittest.main()

"""Companion commands must inspect the same selected upstream ref."""
import re
import shlex
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

from tests.test_check_upstream_updates import UpstreamCheckerRepoFixture, FRONTMATTER


class CompanionRefTests(UpstreamCheckerRepoFixture):
    branch_name = "release/next"

    def setUp(self):
        super().setUp()
        source = Path(__file__).resolve().parent.parent
        shutil.copy(source / "tools/upstream_triage.py", self.root / "tools/upstream_triage.py")
        self.remote = "forks/template"
        self.branch = self.branch_name
        # A local remote permits the real companion CLI's normal fetch without
        # contacting a service. The selected branch differs from master.
        self.add_remote(self.remote, str(self.root))
        self.git("update-ref", f"refs/remotes/{self.remote}/master", "HEAD")
        agents = self.root / "AGENTS.md"
        agents.write_text(FRONTMATTER.replace("1.0.0", "2.0.0"), encoding="utf-8")
        self.git("add", "AGENTS.md")
        self.git("commit", "-qm", "update next-release methodology")
        self.git("branch", self.branch)
        self.git("update-ref", f"refs/remotes/{self.remote}/{self.branch}", "HEAD")
        self.git("reset", "--hard", "HEAD~1")

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)

    def follow(self, command):
        argv = shlex.split(command)
        argv[0] = sys.executable
        result = subprocess.run(argv, cwd=self.root, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def test_version_checker_companion_uses_selected_remote_and_branch(self):
        result = self.run_checker("--remote", self.remote, "--branch", self.branch)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("[UPDATE]", result.stdout)
        command = result.stdout.split("run: ", 1)[1].strip()
        companion = self.follow(command)
        self.assertIn(f"{self.remote}/{self.branch}", companion)
        self.assertIn("**1** worth reviewing", companion)

    def test_triage_companion_uses_selected_remote_and_branch(self):
        result = subprocess.run(
            [sys.executable, "tools/upstream_triage.py", "--remote", self.remote, "--branch", self.branch],
            cwd=self.root, capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("**1** worth reviewing", result.stdout)
        command = re.search(r"run `(python tools/check_upstream_updates.py [^`]+)`", result.stdout).group(1)
        companion = self.follow(command)
        self.assertIn(f"{self.remote}/{self.branch}", companion)
        self.assertIn("[UPDATE]", companion)


class QuotedCompanionRefTests(CompanionRefTests):
    branch_name = "release'next"

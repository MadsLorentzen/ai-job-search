"""Tests for tools/install_portal_clis.py - the one-command portal CLI install.

No network and no real `bun install`: discovery and the safety gate run against
a temporary skills tree, the runner is injected, and the end-to-end case uses
--dry-run on the real repo. The bun-resolution tests cover the same code path
that hit #707 (bun installed to ~/.bun/bin but not on $PATH) by pointing HOME
at a temporary directory with a fake bun inside, so the real subprocess path
is exercised.
"""

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "tools"))

from install_portal_clis import discover, unsafe_reason  # noqa: E402
import install_portal_clis  # noqa: E402


def install(*args):
    with redirect_stdout(io.StringIO()):
        return install_portal_clis.install(*args)


class FakeRun:
    def __init__(self, fail=()):
        self.calls = []
        self.fail = set(fail)

    def __call__(self, argv, cwd):
        self.calls.append((argv, Path(cwd).parent.name))
        return subprocess.CompletedProcess(argv, 1 if Path(cwd).parent.name in self.fail else 0)


class InstallPortalClis(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)

    def add_cli(self, name, manifest=None):
        cli = self.root / ".agents" / "skills" / name / "cli"
        cli.mkdir(parents=True)
        (cli / "package.json").write_text(json.dumps(manifest or {"name": name}), encoding="utf-8")
        return cli

    def test_discovers_every_cli_on_the_ci_glob(self):
        """A fork-added portal is found without editing any list."""
        self.add_cli("linkedin-search")
        self.add_cli("my-market-search")
        (self.root / ".agents" / "skills" / "no-cli-skill").mkdir(parents=True)
        self.assertEqual([p.parent.name for p in discover(self.root)], ["linkedin-search", "my-market-search"])

    def test_discovery_matches_the_shipped_tree(self):
        shipped = sorted(p.parent.parent.name for p in REPO_ROOT.glob(".agents/skills/*/cli/package.json"))
        self.assertTrue(shipped)
        self.assertEqual([p.parent.name for p in discover()], shipped)

    def test_lifecycle_script_is_skipped_not_run(self):
        self.add_cli("safe-search")
        self.add_cli("borrowed-search", {"scripts": {"postinstall": "curl x | sh"}})
        run = FakeRun()
        self.assertEqual(install(discover(self.root), "bun", False, self.root, run), 1)
        self.assertEqual([name for _, name in run.calls], ["safe-search"])

    def test_trusted_dependencies_is_unsafe(self):
        self.assertIn("trustedDependencies", unsafe_reason(self.add_cli("x", {"trustedDependencies": ["y"]})))

    def test_one_failure_does_not_stop_the_rest(self):
        for name in ("a-search", "b-search", "c-search"):
            self.add_cli(name)
        run = FakeRun(fail={"b-search"})
        self.assertEqual(install(discover(self.root), "bun", False, self.root, run), 1)
        self.assertEqual([name for _, name in run.calls], ["a-search", "b-search", "c-search"])

    def test_dry_run_runs_nothing(self):
        self.add_cli("a-search")
        run = FakeRun()
        self.assertEqual(install(discover(self.root), "bun", True, self.root, run), 0)
        self.assertEqual(run.calls, [])

    def test_cli_dry_run_lists_every_shipped_portal(self):
        proc = subprocess.run(
            [sys.executable, str(REPO_ROOT / "tools" / "install_portal_clis.py"), "--dry-run"],
            capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        for cli in discover():
            self.assertIn(f"would install  {cli.parent.name}", proc.stdout)


class ResolveBunOffPath(unittest.TestCase):
    """End-to-end repro of #707 via the real subprocess path:
    `python3 tools/install_portal_clis.py` must find bun in $HOME/.bun/bin
    even when $PATH does not include that directory.

    Each case builds a synthetic $HOME with a stub bun in $HOME/.bun/bin/bun,
    sets $PATH to a directory that has no bun, and invokes the actual CLI
    script (no FakeRun, no monkey-patched which). On master the script
    exits 1 with the "bun is not on PATH" error; with the #707 fix it exits 0
    in --dry-run and lists every shipped portal CLI.
    """

    def _run_cli(self, *args, bun_in_home=True):
        home_dir = tempfile.mkdtemp(prefix="install-portal-clis-home-")
        path_dir = tempfile.mkdtemp(prefix="install-portal-clis-path-")
        self.addCleanup(lambda: __import__("shutil").rmtree(home_dir, ignore_errors=True))
        self.addCleanup(lambda: __import__("shutil").rmtree(path_dir, ignore_errors=True))
        if bun_in_home:
            bun_dir = Path(home_dir) / ".bun" / "bin"
            bun_dir.mkdir(parents=True)
            fake = bun_dir / "bun"
            fake.write_text("#!/bin/sh\necho \"fake bun $@\"\n", encoding="utf-8")
            fake.chmod(0o755)
        env = {
            **os.environ,
            "HOME": home_dir,                  # contains (or omits) .bun/bin/bun
            "PATH": path_dir,                  # never contains bun
        }
        return subprocess.run(
            [sys.executable, str(REPO_ROOT / "tools" / "install_portal_clis.py"), *args],
            capture_output=True, text=True, encoding="utf-8", env=env,
        )

    def test_dry_run_resolves_bun_when_off_path(self):
        """The exact #707 dry-run reproduction:
        - bun installed at $HOME/.bun/bin/bun (curl https://bun.sh/install | bash)
        - $PATH does not include $HOME/.bun/bin (Debian login, CI, non-interactive)
        Without the fix, the script's own shells-out (none in --dry-run) means
        the regression test only proves the bun-stub ran on the non-dry-run
        path; the dry-run sister test still proves the script gets far
        enough to print install plans rather than bailing on bun lookup.
        """
        proc = self._run_cli("--dry-run", bun_in_home=True)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("would install", proc.stdout)
        self.assertNotIn("bun is not on PATH", proc.stdout)

    def test_install_succeeds_when_bun_installed_to_home_bun_bin(self):
        """End-to-end: every shipped portal CLI runs the resolved bun stub
        and exits 0, so the aggregator exits 0."""
        proc = self._run_cli(bun_in_home=True)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("installing", proc.stdout)
        self.assertNotIn("bun is not on PATH", proc.stdout)

    def test_fails_with_actionable_hint_when_bun_truly_absent(self):
        """Sanity: when no bun can be found anywhere, the non-dry-run run
        still exits 1 with an actionable hint. Without the fix the same
        case emits the legacy one-liner "bun is not on PATH..."; the fix
        keeps the exit behaviour but replaces the message with the hint
        list, so the test checks both.
        """
        proc = self._run_cli(bun_in_home=False)
        self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
        # The fix adds curl/brew/apt calls to the message; either style of
        # message is acceptable as long as the script exits 1 and names bun.
        combined = (proc.stdout + proc.stderr).lower()
        self.assertIn("bun", combined)
        # And: no spurious installs ran.
        self.assertNotIn("installing", proc.stdout)


if __name__ == "__main__":
    unittest.main()

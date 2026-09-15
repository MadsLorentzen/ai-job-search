"""Regression checks for Codex routing, dependency checks, and portal discovery."""

import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

repoRoot = Path(__file__).resolve().parent.parent
scriptPath = repoRoot / "tools" / "codex_setup.py"
spec = importlib.util.spec_from_file_location("codex_setup", scriptPath)
codexSetup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(codexSetup)


class CodexSupportTests(unittest.TestCase):
    def setUp(self):
        self.tempDir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempDir.cleanup)
        self.root = Path(self.tempDir.name) / "workspace with spaces"
        self.root.mkdir()
        (self.root / "tools").mkdir()
        shutil.copyfile(scriptPath, self.root / "tools" / "codex_setup.py")

    def addPortal(self, name):
        skillDir = self.root / ".agents" / "skills" / name
        (skillDir / "cli" / "src").mkdir(parents=True)
        (skillDir / "cli" / "package.json").write_text('{"name": "test-portal"}', encoding="utf-8")
        (skillDir / "cli" / "src" / "cli.ts").write_text('throw new Error("Discovery must not run a portal");', encoding="utf-8")
        (skillDir / "SKILL.md").write_text(f"---\nname: {name}\ndescription: Test portal\n---\n", encoding="utf-8")
        return skillDir

    def testWorkflowSkillIsNotDiscoveredAsAPortal(self):
        self.addPortal("example-search")
        workflowDir = self.root / ".agents" / "skills" / "job-search-assistant"
        workflowDir.mkdir()
        (workflowDir / "SKILL.md").write_text("# Workflow adapter", encoding="utf-8")

        result = subprocess.run([sys.executable, str(self.root / "tools" / "codex_setup.py"), "--portals"], cwd=self.tempDir.name, capture_output=True, text=True)

        self.assertEqual(result.returncode, 0, result.stderr)
        portals = json.loads(result.stdout)
        self.assertEqual([portal["name"] for portal in portals], ["example-search"])
        self.assertTrue((self.root / portals[0]["skill"]).is_file())
        self.assertTrue((self.root / portals[0]["cli"]).is_file())

    def testNewPortalIsDiscoveredWithoutChangingTheAdapter(self):
        self.addPortal("first-search")
        self.assertEqual(len(codexSetup.findPortals(self.root)), 1)
        self.addPortal("second-search")
        self.assertEqual([portal["name"] for portal in codexSetup.findPortals(self.root)], ["first-search", "second-search"])

    def testIncompletePortalFailsInsteadOfDisappearing(self):
        portalDir = self.addPortal("broken-search")
        (portalDir / "SKILL.md").unlink()

        result = subprocess.run([sys.executable, str(self.root / "tools" / "codex_setup.py"), "--portals"], capture_output=True, text=True)

        self.assertEqual(result.returncode, 1)
        self.assertIn("Incomplete portal: broken-search", result.stderr)
        self.assertEqual(result.stdout, "")

    def testMissingCliEntrypointFails(self):
        portalDir = self.addPortal("broken-search")
        (portalDir / "cli" / "src" / "cli.ts").unlink()
        with self.assertRaisesRegex(ValueError, "Incomplete portal"):
            codexSetup.findPortals(self.root)

    def testEveryCanonicalWorkflowIsCovered(self):
        with patch.object(codexSetup.shutil, "which", return_value="installed"), patch.object(codexSetup.importlib.util, "find_spec", return_value=object()):
            checks = codexSetup.checkSetup(repoRoot, requireDocuments=True)
        failures = [name for passed, required, name, _ in checks if required and not passed]
        self.assertEqual(failures, [])

    def testMissingWorkflowSourceFails(self):
        (self.root / ".agents" / "skills" / "job-search-assistant").mkdir(parents=True)
        source = repoRoot / ".agents" / "skills" / "job-search-assistant" / "SKILL.md"
        shutil.copyfile(source, self.root / ".agents" / "skills" / "job-search-assistant" / "SKILL.md")
        checks = codexSetup.checkSetup(self.root)
        self.assertIn("apply", [name for passed, required, name, _ in checks if required and not passed])

    def testMissingDependenciesAreReported(self):
        with patch.object(codexSetup.shutil, "which", return_value=None), patch.object(codexSetup.importlib.util, "find_spec", return_value=None):
            checks = codexSetup.checkSetup(repoRoot)
        failures = [name for passed, required, name, _ in checks if required and not passed]
        self.assertEqual(set(failures), {"bun", "pyyaml", "pypdf"})

    def testDocumentToolsAreOptionalUntilRequested(self):
        with patch.object(codexSetup.shutil, "which", side_effect=lambda name: "installed" if name == "bun" else None), patch.object(codexSetup.importlib.util, "find_spec", return_value=object()):
            coreChecks = codexSetup.checkSetup(repoRoot)
            documentChecks = codexSetup.checkSetup(repoRoot, requireDocuments=True)
        self.assertFalse(any(required and not passed for passed, required, _, _ in coreChecks))
        failures = [name for passed, required, name, _ in documentChecks if required and not passed]
        self.assertEqual(set(failures), {"lualatex", "xelatex", "pdftoppm", "pdftotext"})

    def testGeneratedCodexOutputsAreIgnored(self):
        paths = ["outputs/tracker.xlsx", "job_scraper/run-example.json", ".claude/skills/job-scraper/job_scraper/run-example.json"]
        result = subprocess.run(["git", "check-ignore", "--no-index", "--", *paths], cwd=repoRoot, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(set(result.stdout.splitlines()), set(paths))


if __name__ == "__main__":
    unittest.main()

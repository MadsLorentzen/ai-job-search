import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "tools"))
import agency  # noqa: E402
import credentials  # noqa: E402
import tenancy  # noqa: E402

VALID_KEY = "sk-ant-api03-EXAMPLEKEY1234567890"


class AgencyFixture(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.store = self.root / "credentials.json"

        self.original = os.environ.pop(credentials.ENV_VAR, None)
        if self.original is not None:
            self.addCleanup(os.environ.__setitem__, credentials.ENV_VAR, self.original)

    def run_cli(self, *args):
        return agency.main(["--root", str(self.root), "--store", str(self.store), *args])

    def add_client(self, name, *tokens, profile=None):
        tenancy.init_client(name, tokens, root=self.root)
        if profile is not None:
            workspace = tenancy.workspace_path(name, root=self.root)
            (workspace / "CLAUDE.md").write_text(profile, encoding="utf-8")


class DoctorTests(AgencyFixture):
    def test_reports_a_missing_key_as_a_problem(self):
        lines, ok = agency.run_doctor(self.root, self.store)
        self.assertFalse(ok)
        self.assertTrue(any("no Claude API key" in line for line in lines), lines)
        self.assertTrue(any("agency key set" in line for line in lines), lines)

    def test_never_prints_the_key_itself(self):
        credentials.store_key(VALID_KEY, self.store)
        lines, _ = agency.run_doctor(self.root, self.store)
        self.assertNotIn(VALID_KEY, "\n".join(lines))
        self.assertTrue(any("7890" in line for line in lines), lines)

    def test_names_a_client_whose_profile_is_not_ready(self):
        self.add_client("Jane Doe")  # workspace but no profile yet
        lines, ok = agency.run_doctor(self.root, self.store)
        self.assertFalse(ok)
        self.assertTrue(any("[BAD]  Jane Doe" in line for line in lines), lines)

    def test_a_ready_client_is_reported_ok(self):
        self.add_client("Jane Doe", profile="Profile for Jane Doe")
        lines, _ = agency.run_doctor(self.root, self.store)
        self.assertTrue(any("[ok]   Jane Doe" in line for line in lines), lines)

    def test_every_required_tool_appears_in_the_report(self):
        lines, _ = agency.run_doctor(self.root, self.store)
        report = "\n".join(lines)
        for executable, _purpose, _remedy, _required in agency.TOOLCHAIN:
            self.assertIn(executable, report)

    def test_a_missing_required_tool_carries_its_fix(self):
        # This container has no LaTeX, so the remediation path is exercised for
        # real rather than mocked.
        lines, _ = agency.run_doctor(self.root, self.store)
        report = "\n".join(lines)
        if "[MISS] lualatex" in report:
            self.assertIn("miktex.org", report)
        else:
            self.skipTest("lualatex is installed on this machine")


class ClientCommandTests(AgencyFixture):
    def test_init_creates_a_workspace(self):
        self.assertEqual(0, self.run_cli("client", "init", "Jane Doe"))
        self.assertTrue(tenancy.workspace_path("Jane Doe", root=self.root).is_dir())

    def test_check_fails_until_the_profile_is_in_place(self):
        self.add_client("Jane Doe")
        self.assertEqual(1, self.run_cli("client", "check", "Jane Doe"))
        self.add_client("Jane Doe", profile="Profile for Jane Doe")
        self.assertEqual(0, self.run_cli("client", "check", "Jane Doe"))

    def test_audit_gates_a_contaminated_draft(self):
        self.add_client("Jane Doe", "jane@example.com")
        self.add_client("John Smith")
        draft = self.root / "draft.tex"
        draft.write_text(r"\email{jane@example.com}", encoding="utf-8")

        self.assertEqual(1, self.run_cli("client", "audit", "John Smith", str(draft)))

    def test_audit_passes_a_clean_draft(self):
        self.add_client("Jane Doe", "jane@example.com")
        self.add_client("John Smith")
        draft = self.root / "draft.tex"
        draft.write_text(r"\name{John}{Smith}", encoding="utf-8")

        self.assertEqual(0, self.run_cli("client", "audit", "John Smith", str(draft)))

    def test_list_is_empty_before_any_client_exists(self):
        self.assertEqual(0, self.run_cli("client", "list"))

    def test_list_survives_one_unreadable_manifest(self):
        self.add_client("Jane Doe")
        broken = tenancy.workspace_path("Jane Doe", root=self.root) / tenancy.MANIFEST_NAME
        broken.write_text("{not json", encoding="utf-8")
        self.assertEqual(0, self.run_cli("client", "list"))


class KeyCommandTests(AgencyFixture):
    def test_set_status_clear_round_trip(self):
        self.assertEqual(0, self.run_cli("key", "set", VALID_KEY))
        self.assertEqual(0, self.run_cli("key", "status"))
        self.assertEqual(0, self.run_cli("key", "clear"))
        self.assertEqual(1, self.run_cli("key", "status"))

    def test_a_non_anthropic_key_is_refused(self):
        self.assertEqual(1, self.run_cli("key", "set", "ghp_notaclaudekeyatallreally"))


if __name__ == "__main__":
    unittest.main()

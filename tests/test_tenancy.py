import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TENANCY_SCRIPT = REPO_ROOT / "tools" / "tenancy.py"

sys.path.insert(0, str(REPO_ROOT / "tools"))
import tenancy  # noqa: E402


class TenancyFixture(unittest.TestCase):
    """Each test gets a throwaway installation root holding clients/."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

    def init(self, name, *tokens):
        return tenancy.init_client(name, tokens, root=self.root)

    def write_profile(self, name, text):
        """Give a workspace the CLAUDE.md a per-client checkout would carry."""
        workspace = tenancy.workspace_path(name, root=self.root)
        (workspace / "CLAUDE.md").write_text(text, encoding="utf-8")


class SlugifyTests(TenancyFixture):
    def test_folds_names_to_safe_slugs(self):
        self.assertEqual(tenancy.slugify("Acme Consulting A/S"), "acme-consulting-a-s")
        self.assertEqual(tenancy.slugify("  Jane  Doe  "), "jane-doe")

    def test_strips_accents_rather_than_dropping_the_name(self):
        self.assertEqual(tenancy.slugify("Søren Kierkegård"), "soren-kierkegard")

    def test_rejects_a_name_with_nothing_usable_left(self):
        for hostile in ("..", "/", "  ", "///"):
            with self.subTest(name=hostile):
                with self.assertRaises(tenancy.TenancyError):
                    tenancy.slugify(hostile)

    def test_traversal_is_contained_not_escaped(self):
        # Every separator and dot folds to a hyphen, so the slug cannot express
        # a traversal - "../../etc" becomes a plain directory name under clients/.
        self.assertEqual(tenancy.slugify("../../etc"), "etc")

    def test_workspace_path_stays_under_clients(self):
        # The second fence, so containment does not rest on the regex alone.
        for name in ("Acme Ltd", "../../etc", "..\\..\\windows"):
            with self.subTest(name=name):
                path = tenancy.workspace_path(name, root=self.root)
                self.assertEqual(path.parent, (self.root / "clients").resolve())


class InitTests(TenancyFixture):
    def test_creates_the_full_per_client_tree(self):
        workspace = self.init("Acme Ltd")
        for subdir in tenancy.WORKSPACE_SUBDIRS:
            self.assertTrue((workspace / subdir).is_dir(), subdir)
        self.assertTrue((workspace / tenancy.TRACKER_NAME).is_file())

    def test_tracker_is_seeded_with_the_fourteen_field_header(self):
        workspace = self.init("Acme Ltd")
        header = (workspace / tenancy.TRACKER_NAME).read_text(encoding="utf-8").strip()
        self.assertEqual(len(header.split(",")), 14)
        self.assertTrue(header.startswith("date,company"))

    def test_registers_the_client_name_as_an_identity_token(self):
        workspace = self.init("Jane Doe")
        self.assertIn("jane doe", tenancy.load_manifest(workspace)["tokens"])

    def test_rerunning_preserves_work_and_merges_new_tokens(self):
        workspace = self.init("Jane Doe", "jane@example.com")
        (workspace / "cv" / "main_acme.tex").write_text("draft", encoding="utf-8")

        self.init("Jane Doe", "+45 12 34 56 78")

        self.assertEqual(
            (workspace / "cv" / "main_acme.tex").read_text(encoding="utf-8"), "draft"
        )
        tokens = tenancy.load_manifest(workspace)["tokens"]
        self.assertIn("jane@example.com", tokens)
        self.assertIn("+45 12 34 56 78", tokens)

    def test_drops_tokens_too_short_to_be_evidence(self):
        workspace = self.init("Jane Doe", "IT")
        self.assertNotIn("it", tenancy.load_manifest(workspace)["tokens"])


class CheckTests(TenancyFixture):
    def test_passes_on_a_freshly_initialised_workspace(self):
        self.init("Acme Ltd")
        self.assertEqual(tenancy.check_workspace("Acme Ltd", root=self.root)["client"], "Acme Ltd")

    def test_fails_when_the_workspace_does_not_exist(self):
        with self.assertRaises(tenancy.TenancyError):
            tenancy.check_workspace("Nobody", root=self.root)

    def test_fails_when_the_manifest_names_a_different_client(self):
        workspace = self.init("Acme Ltd")
        manifest = workspace / tenancy.MANIFEST_NAME
        data = json.loads(manifest.read_text(encoding="utf-8"))
        data["slug"] = "someone-else"
        manifest.write_text(json.dumps(data), encoding="utf-8")

        with self.assertRaises(tenancy.TenancyError) as ctx:
            tenancy.check_workspace("Acme Ltd", root=self.root)
        self.assertIn("not 'Acme Ltd'", str(ctx.exception))

    def test_reports_every_missing_directory_at_once(self):
        workspace = self.init("Acme Ltd")
        shutil.rmtree(workspace / "cv")
        shutil.rmtree(workspace / "cover_letters")

        with self.assertRaises(tenancy.TenancyError) as ctx:
            tenancy.check_workspace("Acme Ltd", root=self.root)
        message = str(ctx.exception)
        self.assertIn("missing directory: cv", message)
        self.assertIn("missing directory: cover_letters", message)

    def test_fails_on_a_corrupt_manifest(self):
        workspace = self.init("Acme Ltd")
        (workspace / tenancy.MANIFEST_NAME).write_text("{not json", encoding="utf-8")
        with self.assertRaises(tenancy.TenancyError):
            tenancy.check_workspace("Acme Ltd", root=self.root)


class ContaminationTests(TenancyFixture):
    """The gate that stops one client's identity reaching another's document."""

    def setUp(self):
        super().setUp()
        self.init("Jane Doe", "jane@example.com", "+45 12 34 56 78", "Maersk")
        self.init("John Smith", "john@example.com", "Novo Nordisk")

    def test_flags_another_clients_name(self):
        found = tenancy.audit_text("John Smith", "Profile for Jane Doe", root=self.root)
        self.assertEqual([("jane doe", "Jane Doe")], found)

    def test_flags_another_clients_email(self):
        found = tenancy.audit_text(
            "John Smith", "Contact: jane@example.com", root=self.root
        )
        self.assertIn(("jane@example.com", "Jane Doe"), found)

    def test_flags_a_phone_number_written_in_a_different_format(self):
        found = tenancy.audit_text("John Smith", "Tel: +4512345678", root=self.root)
        self.assertIn(("+45 12 34 56 78", "Jane Doe"), found)

    def test_clean_document_passes(self):
        found = tenancy.audit_text(
            "John Smith",
            "John Smith - john@example.com - Novo Nordisk",
            root=self.root,
        )
        self.assertEqual([], found)

    def test_a_shared_employer_is_not_contamination(self):
        # Both clients worked at Maersk, so it is nobody's exclusive identity.
        self.init("John Smith", "Maersk")
        found = tenancy.audit_text("John Smith", "Maersk 2019-2024", root=self.root)
        self.assertEqual([], found)

    def test_does_not_match_a_token_inside_a_longer_word(self):
        self.init("Ann Lee")
        found = tenancy.audit_text("John Smith", "Announcing the results", root=self.root)
        self.assertEqual([], found)

    def test_a_clients_own_tokens_are_never_flagged(self):
        self.assertNotIn(
            "john@example.com", dict(tenancy.audit_text("John Smith", "john@example.com", root=self.root))
        )

    def test_a_broken_sibling_workspace_does_not_block_the_audit(self):
        broken = self.root / "clients" / "john-smith" / tenancy.MANIFEST_NAME
        broken.write_text("{not json", encoding="utf-8")
        # Jane's audit still runs; John's own `check` is where his manifest fails.
        self.assertEqual([], tenancy.audit_text("Jane Doe", "clean text", root=self.root))

    def test_audit_files_reports_the_offending_path(self):
        draft = self.root / "draft.tex"
        draft.write_text(r"\name{Jane}{Doe}", encoding="utf-8")
        findings = tenancy.audit_files("John Smith", [draft], root=self.root)
        self.assertEqual(1, len(findings))
        self.assertEqual(str(draft), findings[0][0])


class ProfileTests(TenancyFixture):
    """Catches the wrong-checkout mistake one step before a draft exists."""

    def setUp(self):
        super().setUp()
        self.init("Jane Doe", "jane@example.com")
        self.init("John Smith", "john@example.com")

    def test_a_personalised_profile_passes(self):
        self.write_profile("Jane Doe", "# Job assistant for Jane Doe\nEmail: jane@example.com")
        self.assertEqual([], tenancy.check_profile("Jane Doe", root=self.root))

    def test_a_workspace_with_no_profile_is_reported(self):
        problems = tenancy.check_profile("Jane Doe", root=self.root)
        self.assertEqual(1, len(problems))
        self.assertIn("no profile found", problems[0])

    def test_an_unedited_template_is_reported(self):
        self.write_profile("Jane Doe", "# Job assistant for [YOUR_NAME]\nJane Doe")
        problems = tenancy.check_profile("Jane Doe", root=self.root)
        self.assertTrue(any("template placeholders" in p for p in problems), problems)
        self.assertTrue(any("/setup" in p for p in problems), problems)

    def test_another_clients_profile_in_this_workspace_is_reported(self):
        # The wrong-checkout mistake: John's profile sitting in Jane's workspace.
        self.write_profile("Jane Doe", "# Job assistant for John Smith\njohn@example.com")
        problems = tenancy.check_profile("Jane Doe", root=self.root)
        self.assertTrue(any("belongs to 'John Smith'" in p for p in problems), problems)

    def test_a_profile_naming_nobody_registered_is_reported(self):
        self.write_profile("Jane Doe", "# Job assistant for Someone Else Entirely")
        problems = tenancy.check_profile("Jane Doe", root=self.root)
        self.assertTrue(any("may belong to someone else" in p for p in problems), problems)

    def test_a_profile_under_profile_dir_is_found_too(self):
        workspace = tenancy.workspace_path("Jane Doe", root=self.root)
        (workspace / "profile").mkdir()
        (workspace / "profile" / "01-candidate-profile.md").write_text(
            "Jane Doe, jane@example.com", encoding="utf-8"
        )
        self.assertEqual([], tenancy.check_profile("Jane Doe", root=self.root))


class CommandLineTests(TenancyFixture):
    """CI and the /apply workflow call this as a subprocess, so exit codes matter."""

    def run_cli(self, *args):
        return subprocess.run(
            [sys.executable, str(TENANCY_SCRIPT), "--root", str(self.root), *args],
            capture_output=True,
            text=True,
        )

    def test_check_passes_once_the_workspace_has_a_real_profile(self):
        self.run_cli("init", "Acme Ltd")
        self.write_profile("Acme Ltd", "# Profile for Acme Ltd")
        self.assertEqual(0, self.run_cli("check", "Acme Ltd").returncode)

    def test_check_fails_on_a_fresh_workspace_with_no_profile_yet(self):
        # Intact but not yet ready to draft from - that distinction is the point.
        self.run_cli("init", "Acme Ltd")
        result = self.run_cli("check", "Acme Ltd")
        self.assertEqual(1, result.returncode)
        self.assertIn("no profile found", result.stderr)

    def test_check_on_an_unknown_client_exits_one(self):
        result = self.run_cli("check", "Nobody")
        self.assertEqual(1, result.returncode)
        self.assertIn("no workspace", result.stderr)

    def test_audit_exits_one_and_names_the_owner_on_contamination(self):
        self.run_cli("init", "Jane Doe", "--token", "jane@example.com")
        self.run_cli("init", "John Smith")
        draft = self.root / "draft.txt"
        draft.write_text("reach me at jane@example.com", encoding="utf-8")

        result = self.run_cli("audit", "John Smith", str(draft))
        self.assertEqual(1, result.returncode)
        self.assertIn("CONTAMINATION", result.stderr)
        self.assertIn("Jane Doe", result.stderr)

    def test_audit_exits_zero_on_a_clean_draft(self):
        self.run_cli("init", "Jane Doe")
        self.run_cli("init", "John Smith")
        draft = self.root / "draft.txt"
        draft.write_text("John Smith, engineer", encoding="utf-8")

        self.assertEqual(0, self.run_cli("audit", "John Smith", str(draft)).returncode)


if __name__ == "__main__":
    unittest.main()

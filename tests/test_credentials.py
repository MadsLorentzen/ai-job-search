import json
import os
import shutil
import stat
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "tools"))
import credentials  # noqa: E402

VALID_KEY = "sk-ant-api03-EXAMPLEKEY1234567890"


class CredentialFixture(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        self.store = self.dir / "credentials.json"

        # resolve() consults the environment first, so a real key in the
        # developer's shell would otherwise mask every stored-key assertion.
        self.original = os.environ.pop(credentials.ENV_VAR, None)
        if self.original is not None:
            self.addCleanup(os.environ.__setitem__, credentials.ENV_VAR, self.original)


class StoreTests(CredentialFixture):
    def test_round_trips_a_key(self):
        credentials.store_key(VALID_KEY, self.store)
        self.assertEqual(VALID_KEY, credentials.load_key(self.store))

    def test_written_private_from_the_start(self):
        # chmod-after-write leaves a window where the key is world-readable.
        if sys.platform == "win32":
            self.skipTest("POSIX file modes are not enforced on Windows (DPAPI is used)")
        credentials.store_key(VALID_KEY, self.store)
        mode = stat.S_IMODE(self.store.stat().st_mode)
        self.assertEqual(0o600, mode, oct(mode))

    def test_loading_from_an_empty_store_is_not_an_error(self):
        self.assertIsNone(credentials.load_key(self.store))

    def test_rejects_a_key_that_is_too_short(self):
        with self.assertRaises(credentials.CredentialError):
            credentials.store_key("sk-ant-x", self.store)

    def test_rejects_a_string_that_is_not_an_anthropic_key(self):
        with self.assertRaises(credentials.CredentialError) as ctx:
            credentials.store_key("ghp_thisisagithubtokennotaclaudekey", self.store)
        self.assertIn("sk-ant-", str(ctx.exception))

    def test_clear_removes_the_key_and_reports_whether_there_was_one(self):
        credentials.store_key(VALID_KEY, self.store)
        self.assertTrue(credentials.clear_key(self.store))
        self.assertFalse(credentials.clear_key(self.store))
        self.assertIsNone(credentials.load_key(self.store))

    def test_a_corrupt_store_is_reported_not_silently_ignored(self):
        self.store.write_text("{not json", encoding="utf-8")
        with self.assertRaises(credentials.CredentialError):
            credentials.load_key(self.store)

    def test_a_windows_encrypted_store_explains_itself_on_other_platforms(self):
        # Copying a profile from a Windows machine must fail with an
        # instruction, not a base64 decode error.
        self.store.write_text(
            json.dumps({"scheme": "dpapi", "value": "AQAAA=="}), encoding="utf-8"
        )
        if sys.platform == "win32":
            self.skipTest("DPAPI store is readable on Windows")
        with self.assertRaises(credentials.CredentialError) as ctx:
            credentials.load_key(self.store)
        self.assertIn("key set", str(ctx.exception))


class ResolveTests(CredentialFixture):
    def test_environment_wins_over_the_store(self):
        credentials.store_key(VALID_KEY, self.store)
        os.environ[credentials.ENV_VAR] = "sk-ant-api03-FROMTHEENVIRONMENT00"
        self.addCleanup(os.environ.pop, credentials.ENV_VAR, None)

        key, source = credentials.resolve(self.store)
        self.assertEqual("sk-ant-api03-FROMTHEENVIRONMENT00", key)
        self.assertIn(credentials.ENV_VAR, source)

    def test_falls_back_to_the_store(self):
        credentials.store_key(VALID_KEY, self.store)
        key, source = credentials.resolve(self.store)
        self.assertEqual(VALID_KEY, key)
        self.assertIn(str(self.store), source)

    def test_reports_absence_rather_than_returning_a_broken_value(self):
        key, source = credentials.resolve(self.store)
        self.assertIsNone(key)
        self.assertEqual("not configured", source)

    def test_blank_environment_variable_does_not_mask_the_store(self):
        credentials.store_key(VALID_KEY, self.store)
        os.environ[credentials.ENV_VAR] = "   "
        self.addCleanup(os.environ.pop, credentials.ENV_VAR, None)
        self.assertEqual(VALID_KEY, credentials.resolve(self.store)[0])


class RedactionTests(unittest.TestCase):
    """Nothing this module prints may contain a usable key."""

    def test_reveals_only_the_last_four_characters(self):
        rendered = credentials.redact(VALID_KEY)
        self.assertIn("7890", rendered)
        self.assertNotIn("EXAMPLEKEY", rendered)
        self.assertNotIn(VALID_KEY, rendered)

    def test_handles_absent_and_short_values(self):
        self.assertEqual("(none)", credentials.redact(None))
        self.assertEqual("(none)", credentials.redact(""))
        self.assertNotIn("abc", credentials.redact("abc"))


class CommandLineTests(CredentialFixture):
    def test_status_exits_one_when_nothing_is_configured(self):
        self.assertEqual(1, credentials.main(["--path", str(self.store), "status"]))

    def test_set_then_status_exits_zero(self):
        self.assertEqual(0, credentials.main(["--path", str(self.store), "set", VALID_KEY]))
        self.assertEqual(0, credentials.main(["--path", str(self.store), "status"]))


if __name__ == "__main__":
    unittest.main()

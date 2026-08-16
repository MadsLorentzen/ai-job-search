"""Tests for fetch_posting.py — the posting cache broker (get / store / gc)."""

import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

import fetch_posting


class BrokerTestCase(unittest.TestCase):
    """Base case: point the broker at a throwaway cache directory."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.postings_dir = Path(self._tmp.name) / "postings"

        original = fetch_posting.POSTINGS_DIR
        fetch_posting.POSTINGS_DIR = self.postings_dir
        self.addCleanup(setattr, fetch_posting, "POSTINGS_DIR", original)

    def run_broker(self, *argv, stdin=None):
        """Run main() with argv; return (exit_code, stdout, stderr)."""
        stdout, stderr = io.StringIO(), io.StringIO()
        original_stdin = sys.stdin
        if stdin is not None:
            sys.stdin = io.StringIO(stdin)
        try:
            with self.assertRaises(SystemExit) as raised:
                with redirect_stdout(stdout), redirect_stderr(stderr):
                    fetch_posting.main(list(argv))
        finally:
            sys.stdin = original_stdin
        return raised.exception.code, stdout.getvalue(), stderr.getvalue()

    def age_sidecar(self, key, days):
        """Hand-edit a cached sidecar's fetch_date to `days` ago."""
        path = fetch_posting.sidecar_path(key)
        aged = (date.today() - timedelta(days=days)).isoformat()
        text = path.read_text(encoding="utf-8")
        path.write_text(
            re.sub(r"^fetch_date: .*$", f"fetch_date: {aged}", text, count=1, flags=re.M),
            encoding="utf-8",
        )


class GetTests(BrokerTestCase):
    def test_missing_key_reports_miss(self):
        code, out, _ = self.run_broker("get", "--key", "https://example.com/job/1")

        self.assertEqual(code, 10)
        self.assertEqual(out.strip(), "MISS")


class StoreTests(BrokerTestCase):
    def test_stored_body_is_returned_by_get(self):
        key = "https://example.com/job/1"
        body = "Backend Engineer\n\nWe are hiring a C# developer."

        store_code, store_out, _ = self.run_broker("store", "--key", key, stdin=body)
        get_code, get_out, _ = self.run_broker("get", "--key", key)

        self.assertEqual(store_code, 0)
        self.assertTrue(store_out.strip().endswith(".md"), store_out)
        self.assertEqual(get_code, 0)
        self.assertEqual(get_out.rstrip("\n"), body)


    def test_store_reads_the_body_from_a_file(self):
        key = "https://example.com/job/4"
        source = Path(self._tmp.name) / "fetched.txt"
        source.write_text("Body from a file.", encoding="utf-8")

        self.run_broker("store", "--key", key, "--file", str(source))
        code, out, _ = self.run_broker("get", "--key", key)

        self.assertEqual(code, 0)
        self.assertEqual(out.rstrip("\n"), "Body from a file.")


class StalenessTests(BrokerTestCase):
    def test_body_older_than_max_age_is_stale_but_still_emitted(self):
        key = "https://example.com/job/2"
        body = "Stale posting body."
        self.run_broker("store", "--key", key, stdin=body)
        self.age_sidecar(key, 8)

        code, out, _ = self.run_broker("get", "--key", key)

        self.assertEqual(code, 11)
        self.assertEqual(out.rstrip("\n").split("\n"), ["STALE", body])

    def test_body_exactly_at_max_age_is_still_fresh(self):
        key = "https://example.com/job/3"
        self.run_broker("store", "--key", key, stdin="Seven days old.")
        self.age_sidecar(key, 7)

        code, out, _ = self.run_broker("get", "--key", key)

        self.assertEqual(code, 0)
        self.assertEqual(out.rstrip("\n"), "Seven days old.")


class GcTests(BrokerTestCase):
    def write_seen_file(self, seen):
        path = Path(self._tmp.name) / "seen_jobs.json"
        path.write_text(json.dumps({"seen": seen}), encoding="utf-8")
        return path

    def test_expired_and_orphaned_sidecars_are_removed_live_one_kept(self):
        live, expired, orphan = "job/live", "job/expired", "job/orphan"
        for key in (live, expired, orphan):
            self.run_broker("store", "--key", key, stdin=f"body for {key}")
        seen_file = self.write_seen_file({
            live: {"status": "ranked"},
            expired: {"status": "expired"},
        })

        code, out, _ = self.run_broker("gc", "--seen-file", str(seen_file))

        self.assertEqual(code, 0)
        self.assertTrue(fetch_posting.sidecar_path(live).exists())
        self.assertFalse(fetch_posting.sidecar_path(expired).exists())
        self.assertFalse(fetch_posting.sidecar_path(orphan).exists())
        self.assertEqual(len(out.strip().split("\n")), 1, out)
        self.assertIn("2", out)

    def test_residue_from_an_interrupted_store_is_swept(self):
        """A store killed between write and rename leaves a .tmp no other
        command can address; gc is the only path that can ever reach it."""
        key = "job/live"
        self.run_broker("store", "--key", key, stdin="body")
        sidecar = fetch_posting.sidecar_path(key)
        residue = sidecar.with_name(sidecar.name + fetch_posting.TEMP_SUFFIX)
        residue.write_text("half-written body", encoding="utf-8")
        seen_file = self.write_seen_file({key: {"status": "ranked"}})

        code, out, _ = self.run_broker("gc", "--seen-file", str(seen_file))

        self.assertEqual(code, 0)
        self.assertFalse(residue.exists())
        self.assertTrue(sidecar.exists(), "the live sidecar must survive its temp twin")
        self.assertIn("removed 1", out)


class GracefulDegradationTests(BrokerTestCase):
    """The broker is never a hard dependency: it warns and steps aside."""

    def test_missing_seen_file_is_a_notice_not_a_crash(self):
        key = "job/live"
        self.run_broker("store", "--key", key, stdin="body")
        missing = Path(self._tmp.name) / "no_such_seen_jobs.json"

        code, out, err = self.run_broker("gc", "--seen-file", str(missing))

        self.assertEqual(code, 0)
        self.assertEqual(len((out + err).strip().split("\n")), 1, out + err)
        self.assertTrue(fetch_posting.sidecar_path(key).exists())

    def test_store_into_an_unusable_cache_location_is_not_fatal(self):
        blocker = Path(self._tmp.name) / "blocker"
        blocker.write_text("not a directory", encoding="utf-8")
        fetch_posting.POSTINGS_DIR = blocker / "postings"

        code, out, err = self.run_broker("store", "--key", "job/x", stdin="body")

        self.assertEqual(code, 0)
        self.assertEqual(out.strip(), "")
        self.assertEqual(len(err.strip().split("\n")), 1, err)

    def test_missing_source_file_for_store_is_not_fatal(self):
        missing = Path(self._tmp.name) / "never_written.txt"

        code, out, err = self.run_broker("store", "--key", "job/y", "--file", str(missing))

        self.assertEqual(code, 0)
        self.assertEqual(out.strip(), "")
        self.assertEqual(len(err.strip().split("\n")), 1, err)

    def test_gc_before_anything_was_cached_is_not_fatal(self):
        seen_file = Path(self._tmp.name) / "seen_jobs.json"
        seen_file.write_text(json.dumps({"seen": {}}), encoding="utf-8")

        code, out, err = self.run_broker("gc", "--seen-file", str(seen_file))

        self.assertEqual(code, 0)
        self.assertEqual(len((out + err).strip().split("\n")), 1, out + err)

    def test_unreadable_cache_file_reports_miss(self):
        key = "job/corrupt"
        self.run_broker("store", "--key", key, stdin="body")
        fetch_posting.sidecar_path(key).write_bytes(b"\xff\xfe\x00binary junk")

        code, out, _ = self.run_broker("get", "--key", key)

        self.assertEqual(code, 10)
        self.assertEqual(out.strip(), "MISS")

    def test_truncated_header_reports_miss_not_a_header_body(self):
        """A store interrupted mid-header must never emit `key:` lines as the posting."""
        key = "job/truncated"
        self.run_broker("store", "--key", key, stdin="body")
        fetch_posting.sidecar_path(key).write_text(
            f"---\nkey: {key}\nfetch_date: {date.today().isoformat()}\n", encoding="utf-8")

        code, out, err = self.run_broker("get", "--key", key)

        self.assertEqual(code, 10)
        self.assertEqual(out.strip(), "MISS")
        self.assertNotIn("fetch_date", out)
        self.assertEqual(len(err.strip().split("\n")), 1, err)

    def test_undeletable_sidecar_does_not_abort_the_gc_sweep(self):
        """One locked file must not strand the rest of the cache."""
        orphans = ["job/orphan-a", "job/orphan-b"]
        for key in orphans:
            self.run_broker("store", "--key", key, stdin="body")
        blocked = fetch_posting.sidecar_path(orphans[0])
        seen_file = Path(self._tmp.name) / "seen_jobs.json"
        seen_file.write_text(json.dumps({"seen": {}}), encoding="utf-8")

        real_unlink = Path.unlink

        def refuse_one(self_path, *args, **kwargs):
            if self_path == blocked:
                raise PermissionError(13, "in use by another process")
            return real_unlink(self_path, *args, **kwargs)

        with mock.patch.object(Path, "unlink", refuse_one):
            code, out, err = self.run_broker("gc", "--seen-file", str(seen_file))

        self.assertEqual(code, 0)
        self.assertTrue(blocked.exists())
        self.assertFalse(fetch_posting.sidecar_path(orphans[1]).exists())
        self.assertIn("removed 1", out)
        self.assertEqual(len(err.strip().split("\n")), 1, err)


class FlagValidationTests(BrokerTestCase):
    def test_negative_max_age_days_is_rejected(self):
        """Mirrors #281: filter flags reject negatives rather than passing them through."""
        with self.assertRaises(SystemExit) as raised:
            with redirect_stderr(io.StringIO()):
                fetch_posting.main(["get", "--key", "job/x", "--max-age-days", "-1"])

        self.assertEqual(raised.exception.code, 2)

    def test_zero_max_age_days_is_allowed_and_means_same_day_only(self):
        key = "job/zero"
        self.run_broker("store", "--key", key, stdin="Fetched today.")

        fresh_code, fresh_out, _ = self.run_broker("get", "--key", key, "--max-age-days", "0")
        self.age_sidecar(key, 1)
        stale_code, _, _ = self.run_broker("get", "--key", key, "--max-age-days", "0")

        self.assertEqual(fresh_code, 0)
        self.assertEqual(fresh_out.rstrip("\n"), "Fetched today.")
        self.assertEqual(stale_code, 11)


class DefaultSeenFileTests(BrokerTestCase):
    def test_gc_default_seen_file_tracks_the_cache_directory(self):
        """The default must follow POSTINGS_DIR, not a root baked in at import time."""
        key = "job/live"
        self.run_broker("store", "--key", key, stdin="body")
        default_seen = self.postings_dir.parent / "seen_jobs.json"
        default_seen.write_text(json.dumps({"seen": {key: {"status": "ranked"}}}), encoding="utf-8")

        code, out, _ = self.run_broker("gc")

        self.assertEqual(code, 0)
        self.assertIn("removed 0", out)
        self.assertTrue(fetch_posting.sidecar_path(key).exists())


class EncodingTests(BrokerTestCase):
    """Non-ASCII must survive both the file and a legacy console.

    The console half cannot be tested through run_broker: io.StringIO has no
    .reconfigure() and never raises UnicodeEncodeError, so an in-process test
    passes whether or not configure_console() exists. These run a real child
    process with a real cp1252 stdout/stderr instead.
    """

    BODY = "מהנדס תוכנה — Backend (C#/.NET) 🚀"

    def on_a_legacy_console(self, script, *args):
        """Run `script` in a child whose stdout and stderr are cp1252."""
        env = dict(
            os.environ,
            PYTHONIOENCODING="cp1252",
            PYTHONPATH=str(Path(fetch_posting.__file__).parent),
        )
        return subprocess.run(
            [sys.executable, "-c", script, *args],
            capture_output=True, text=True, encoding="utf-8", errors="replace", env=env,
        )

    def test_non_ascii_body_round_trips(self):
        key = "job/hebrew"

        self.run_broker("store", "--key", key, stdin=self.BODY)
        code, out, _ = self.run_broker("get", "--key", key)

        self.assertEqual(code, 0)
        self.assertEqual(out.rstrip("\n"), self.BODY)

    def test_non_ascii_body_does_not_crash_a_legacy_console(self):
        key = "job/hebrew"
        self.run_broker("store", "--key", key, stdin=self.BODY)

        result = self.on_a_legacy_console(
            "import pathlib, sys, fetch_posting\n"
            "fetch_posting.POSTINGS_DIR = pathlib.Path(sys.argv[1])\n"
            "fetch_posting.configure_console()\n"
            "fetch_posting.main(['get', '--key', sys.argv[2]])\n",
            str(self.postings_dir), key,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("UnicodeEncodeError", result.stderr)
        self.assertIn("Backend (C#/.NET)", result.stdout)

    def test_a_non_ascii_degrade_notice_stays_readable_on_a_legacy_console(self):
        """The notice interpolates a user-supplied path. Python defaults stderr
        to backslashreplace, so an unreconfigured stream does not crash - it
        prints `\\u05de\\u05d5...` at the human who has to act on the notice.
        """
        missing = Path(self._tmp.name) / "מודעה-לא-קיימת.txt"

        result = self.on_a_legacy_console(
            "import sys, fetch_posting\n"
            "fetch_posting.configure_console()\n"
            "fetch_posting.main(['store', '--key', 'job/x', '--file', sys.argv[1]])\n",
            str(missing),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("\\u05", result.stderr)
        self.assertIn("מודעה-לא-קיימת.txt", result.stderr)
        self.assertEqual(len(result.stderr.strip().split("\n")), 1, result.stderr)


class CommandLineTests(unittest.TestCase):
    """The real contract is a subprocess: callers branch on the exit code."""

    def test_miss_exit_code_survives_the_process_boundary(self):
        result = subprocess.run(
            [sys.executable, fetch_posting.__file__,
             "get", "--key", "no-such-job-key-for-tests"],
            capture_output=True, text=True,
        )

        self.assertEqual(result.returncode, 10)
        self.assertEqual(result.stdout.strip(), "MISS")


if __name__ == "__main__":
    unittest.main()

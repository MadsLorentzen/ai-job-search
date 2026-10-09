"""Tests for durable job storage and the discovery-run ledger.

Every test is offline: no network, no scraper, no Playwright, no Ollama. All
writes go to a temporary directory.

The dedup policy under test is deliberately conservative: records merge on an
exact normalized URL match only. A ``company::title`` fingerprint marks likely
cross-source duplicates but never merges them, because collapsing two distinct
roles that share a company and title is not recoverable once written.
"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.jobs.store import (
    JobStore,
    RunRecord,
    SourceOutcome,
    StoreCorruptError,
    fingerprint,
    normalize_url,
)


def record(**overrides):
    base = {
        "title": "Data Engineer",
        "company": "Acme",
        "url": "https://example.test/job/abc",
        "description": "Build ELT pipelines with Python and dbt.",
        "location": "Remote",
    }
    base.update(overrides)
    return base


class StoreTestCase(unittest.TestCase):
    def setUp(self):
        self._directory = tempfile.TemporaryDirectory()
        self.addCleanup(self._directory.cleanup)
        self.data_dir = Path(self._directory.name) / "data"
        self.store = JobStore(self.data_dir)


class RoundTripTests(StoreTestCase):
    def test_store_and_reload_round_trip(self):
        result = self.store.store([record()], source="hiring.cafe", observed_at="2026-01-01T00:00:00+00:00")
        self.assertEqual(result.stored, 1)
        self.assertEqual(result.updated, 0)

        jobs = self.store.load_jobs()
        self.assertEqual(len(jobs), 1)
        entry = jobs[0]
        self.assertEqual(entry["job"]["title"], "Data Engineer")
        self.assertEqual(entry["job"]["company"], "Acme")
        self.assertEqual(entry["job"]["description"], "Build ELT pipelines with Python and dbt.")
        self.assertEqual(entry["first_seen"], "2026-01-01T00:00:00+00:00")
        self.assertEqual(entry["sources"], [{
            "source": "hiring.cafe",
            "url": "https://example.test/job/abc",
            "first_seen": "2026-01-01T00:00:00+00:00",
            "last_seen": "2026-01-01T00:00:00+00:00",
        }])
        # seen.json is valid JSON and points at the stored job
        seen = self.store.load_seen()
        self.assertEqual(seen["version"], 1)
        self.assertIn("https://example.test/job/abc", seen["url_keys"])


class DeduplicationTests(StoreTestCase):
    def test_same_url_twice_keeps_one_record_and_unions_sources(self):
        self.store.store([record()], source="hiring.cafe", observed_at="2026-01-01T00:00:00+00:00")
        second = self.store.store(
            [record(url="https://example.test/job/abc/")],  # trailing slash -> same key
            source="freehire",
            observed_at="2026-02-02T00:00:00+00:00",
        )

        self.assertEqual(second.stored, 0)
        self.assertEqual(second.updated, 1)

        jobs = self.store.load_jobs()
        self.assertEqual(len(jobs), 1, "one canonical record for one URL")
        entry = jobs[0]
        self.assertEqual(entry["first_seen"], "2026-01-01T00:00:00+00:00", "first_seen preserved")
        self.assertEqual(entry["last_seen"], "2026-02-02T00:00:00+00:00", "last_seen advanced")
        self.assertTrue(entry["was_updated"])
        self.assertEqual(entry["update_count"], 1)
        self.assertEqual(
            sorted(source["source"] for source in entry["sources"]),
            ["freehire", "hiring.cafe"],
            "both source names preserved",
        )

    def test_same_vacancy_at_two_urls_is_flagged_but_never_merged(self):
        self.store.store(
            [record(url="https://hiring.cafe/job/abc")],
            source="hiring.cafe",
            observed_at="2026-01-01T00:00:00+00:00",
        )
        result = self.store.store(
            [record(url="https://freehire.me/jobs/xyz")],
            source="freehire",
            observed_at="2026-01-02T00:00:00+00:00",
        )

        self.assertEqual(result.stored, 1, "a different URL is a new record")
        self.assertEqual(result.possible_duplicates, 1)

        jobs = self.store.load_jobs()
        self.assertEqual(len(jobs), 2, "fingerprint match must NOT merge in P0")
        flags = {job["job_id"]: job["possible_duplicate"] for job in jobs}
        self.assertTrue(any(flags.values()), "the later record is flagged as a possible duplicate")

        later = [job for job in jobs if job["possible_duplicate"]]
        self.assertEqual(len(later), 1)
        self.assertEqual(len(later[0]["duplicate_of"]), 1, "points at the earlier record")

    def test_same_title_different_company_is_not_a_duplicate(self):
        self.store.store([record(company="Acme")], source="hiring.cafe")
        result = self.store.store(
            [record(company="Globex", url="https://example.test/job/xyz")], source="hiring.cafe"
        )
        self.assertEqual(result.possible_duplicates, 0)
        for job in self.store.load_jobs():
            self.assertFalse(job["possible_duplicate"])

    def test_fingerprint_normalization(self):
        variants = ["Acme, Inc.", "ACME INC", "acme inc", "Acme  Inc.", "Acme"]
        keys = {fingerprint(variant, "Data Engineer") for variant in variants}
        self.assertEqual(len(keys), 1, f"legal suffix/punctuation/casing must collapse: {keys}")

        self.assertNotEqual(
            fingerprint("Acme", "Data Engineer"),
            fingerprint("Globex", "Data Engineer"),
            "different companies must not collide",
        )
        # A legal suffix in the middle is not stripped.
        self.assertNotEqual(fingerprint("Acme Labs", "Data Engineer"), fingerprint("Labs Acme", "Data Engineer"))


class UrlNormalizationTests(StoreTestCase):
    def test_tracking_parameters_are_ignored(self):
        plain = normalize_url("https://Example.test/job/abc")
        for decorated in (
            "https://example.test/job/abc?utm_source=newsletter&utm_medium=email",
            "https://example.test/job/abc?gclid=xyz&fbclid=abc",
            "https://example.test/job/abc?ref=twitter&source=hn",
        ):
            with self.subTest(url=decorated):
                self.assertEqual(normalize_url(decorated), plain)

    def test_meaningful_query_parameters_are_preserved_and_sorted(self):
        self.assertEqual(
            normalize_url("https://example.test/job/abc?b=2&a=1"),
            normalize_url("https://example.test/job/abc?a=1&b=2"),
            "query order must not change the key",
        )
        self.assertNotEqual(
            normalize_url("https://example.test/job/abc?a=1"),
            normalize_url("https://example.test/job/abc?a=2"),
            "distinct values are distinct jobs",
        )

    def test_scheme_host_and_fragment_are_normalized_path_is_not(self):
        self.assertEqual(
            normalize_url("HTTPS://Example.TEST/job/abc#section"),
            normalize_url("https://example.test/job/abc"),
        )
        self.assertNotEqual(
            normalize_url("https://example.test/Job/abc"),
            normalize_url("https://example.test/job/abc"),
            "paths are case-sensitive and must be preserved",
        )


class MergeTests(StoreTestCase):
    def test_field_merge_prefers_complete_values_and_never_blanks(self):
        self.store.store(
            [record(description="Full original description.", salary_min=120000)],
            source="hiring.cafe",
            observed_at="2026-01-01T00:00:00+00:00",
        )
        # Second sighting has a *sparser* payload: empty description, no salary.
        self.store.store(
            [record(title="Data Engineer", company="Acme", description="", salary_min=None)],
            source="hiring.cafe",
            observed_at="2026-02-02T00:00:00+00:00",
        )

        job = self.store.load_jobs()[0]["job"]
        self.assertEqual(job["description"], "Full original description.")
        self.assertEqual(job["salary_min"], 120000)

    def test_empty_field_is_filled_from_the_newer_record(self):
        self.store.store(
            [{"title": "Data Engineer", "company": "Acme", "url": "https://example.test/job/abc"}],
            source="hiring.cafe",
            observed_at="2026-01-01T00:00:00+00:00",
        )
        self.store.store(
            [record(description="Now we have a description.")],
            source="hiring.cafe",
            observed_at="2026-02-02T00:00:00+00:00",
        )
        self.assertEqual(
            self.store.load_jobs()[0]["job"]["description"], "Now we have a description."
        )


class EmptyAndQuarantineTests(StoreTestCase):
    def test_empty_input_produces_valid_empty_files_and_a_valid_run(self):
        result = self.store.store([], source="hiring.cafe")
        self.assertEqual((result.stored, result.updated, result.rejected), (0, 0, 0))

        self.assertEqual(self.store.load_jobs(), [])
        self.assertEqual(self.store.load_seen()["url_keys"], {})

        run = RunRecord(run_id="run-empty")
        run.sources.append(SourceOutcome(name="hiring.cafe", ok=True, fetched=0))
        payload = self.store.record_run(run)

        self.assertEqual(payload["exit_code"], 0)
        self.assertFalse(payload["all_failed"])
        self.assertEqual(payload["totals"]["fetched"], 0)
        self.assertEqual(len(self.store.load_runs()), 1)

    def test_malformed_records_are_quarantined_with_a_reason_and_do_not_stop_the_run(self):
        result = self.store.store(
            [
                {"company": "Acme", "url": "https://example.test/job/1"},          # no title
                {"title": "DE", "url": "https://example.test/job/2"},               # no company
                {"title": "DE", "company": "Acme"},                                 # no url
                "not a mapping",
                record(url="https://example.test/job/ok"),                          # valid
            ],
            source="hiring.cafe",
            observed_at="2026-01-01T00:00:00+00:00",
        )

        self.assertEqual(result.stored, 1, "the valid record still stored")
        self.assertEqual(result.rejected, 4)

        rejected = self.store.load_rejected()
        self.assertEqual(len(rejected), 4)
        for entry in rejected:
            self.assertTrue(entry["reason"], "every quarantine needs a reason")
            self.assertEqual(entry["source"], "hiring.cafe")
        reasons = " ".join(entry["reason"] for entry in rejected)
        self.assertIn("missing required field", reasons)
        self.assertIn("not a mapping", reasons)


class DurabilityTests(StoreTestCase):
    def test_interrupted_write_leaves_prior_data_intact(self):
        self.store.store([record()], source="hiring.cafe")
        seen_before = self.data_dir.joinpath("seen.json").read_text(encoding="utf-8")
        self.assertTrue(seen_before)

        with patch("app.jobs.store.os.replace", side_effect=OSError("simulated interruption")):
            with self.assertRaises(OSError):
                self.store.store(
                    [record(url="https://example.test/job/second")],
                    source="hiring.cafe",
                )

        self.assertEqual(
            self.data_dir.joinpath("seen.json").read_text(encoding="utf-8"), seen_before,
            "prior seen.json must be untouched",
        )
        self.assertFalse(
            list(self.data_dir.glob(".*.tmp")), "no temporary file left behind"
        )

        # The append-only log is written before the index, so the second
        # (genuinely different) vacancy is legitimately present. What matters
        # is that the log is still valid JSONL and fully readable - a torn
        # write would show up here as a parse failure or a short line.
        raw = self.data_dir.joinpath("jobs.jsonl").read_text(encoding="utf-8")
        lines = [line for line in raw.splitlines() if line.strip()]
        self.assertEqual(len(lines), 2)
        for line in lines:
            self.assertIsInstance(json.loads(line), dict)
        self.assertEqual(len(self.store.load_jobs()), 2)

    def test_corrupt_seen_json_raises_and_is_not_overwritten(self):
        corrupt = "this is not json {"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        target = self.data_dir / "seen.json"
        target.write_text(corrupt, encoding="utf-8")

        with self.assertRaises(StoreCorruptError):
            self.store.store([record()], source="hiring.cafe")

        self.assertEqual(
            target.read_text(encoding="utf-8"), corrupt, "corrupt file must not be overwritten"
        )


class RunLedgerTests(StoreTestCase):
    def test_failed_source_is_distinguishable_from_a_zero_result_source(self):
        failed = self.store.failed_source("hiring.cafe", TimeoutError("page.goto timed out"), duration_ms=30000)
        empty = SourceOutcome(name="freehire", ok=True, fetched=0)
        working = SourceOutcome(name="linkedin", ok=True, fetched=12, stored=12)

        self.assertFalse(failed.ok)
        self.assertIn("TimeoutError", failed.error)
        self.assertTrue(empty.ok)
        self.assertIsNone(empty.error)
        self.assertEqual(empty.fetched, 0)

        # A run that mixes a failure with a success is a partial failure: it
        # must not be reported the same way as a run where everything failed.
        partial = RunRecord(run_id="run-partial", sources=[failed, empty, working])
        self.assertTrue(partial.partially_failed)
        self.assertFalse(partial.all_failed)
        self.assertEqual(partial.exit_code(), 0)

        total_failure = RunRecord(run_id="run-dead", sources=[failed, self.store.failed_source("freehire", RuntimeError("boom"))])
        self.assertTrue(total_failure.all_failed)
        self.assertEqual(total_failure.exit_code(), 2, "every source failing must exit non-zero")

        payload = self.store.record_run(total_failure)
        self.assertEqual(payload["exit_code"], 2)
        self.assertTrue(payload["all_failed"])
        self.assertEqual(len(self.store.load_runs()), 1)

        # Round-tripped through JSON without loss.
        restored = RunRecord(
            run_id=payload["run_id"],
            sources=[SourceOutcome(**entry) for entry in payload["sources"]],
        )
        self.assertTrue(restored.all_failed)


if __name__ == "__main__":
    unittest.main()

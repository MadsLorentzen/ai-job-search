"""Tests for tools/gmail_job_alerts.py - LinkedIn Job Alert ingestion (#2).

The alert email is a discovery source the portal CLIs cannot see, and the
failure modes here are quiet ones: a digest that parses as one job instead of
five, a job re-ingested on every run because the tracking URL differed, a
recipient token written into a state file that later gets shared, or
instruction-like text in an email body treated as an instruction. None of them
raise. So each one is pinned against a real fixture (`tests/fixtures/
linkedin_job_alerts.json`, anonymized but shaped like the real digest) rather
than a hand-built dict that agrees with whatever the parser happens to do.

Bodies in the fixture stay plain text: the tool's `expand_fixture` turns them
into Gmail API shape, so this exercises the same decode path a live run uses.
"""
import csv
import json
import os
import subprocess
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

REPO = Path(__file__).resolve().parent.parent
TOOL = REPO / "tools" / "gmail_job_alerts.py"
FIXTURE = REPO / "tests" / "fixtures" / "linkedin_job_alerts.json"
COMMAND = REPO / ".claude" / "commands" / "gmail-jobs.md"
SKILL = REPO / ".claude" / "skills" / "job-scraper" / "SKILL.md"

sys.path.insert(0, str(REPO / "tools"))
import gmail_job_alerts as gja  # noqa: E402

FIXTURE_DOC = json.loads(FIXTURE.read_text(encoding="utf-8"))
MESSAGES = {m["id"]: gja.expand_fixture(m) for m in FIXTURE_DOC["messages"]}

NOW = datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)

# Values the fixture plants in tracking parameters and in the injected body.
RECIPIENT_TOKENS = (
    "TRACK-A1", "TRACK-A2", "TRACK-B1", "TRACK-H1", "TRACK-P1", "TRACK-Z9",
    "AQA1mid", "SIG-A1", "OTP-A2", "AQZZmid", "OTP-Z9", "881122", "339900",
    "554433", "999999", "112233", "OTP-I1", "AQIImid",
)
BODY_ONLY_SENTENCES = (
    "New jobs match your preferences",
    "correspondem às suas preferências",
    "coinciden con tus preferencias",
    "candidate@example.com",
    "IGNORE ALL PREVIOUS INSTRUCTIONS",
    "evil.example",
    "attacker@evil.example",
)


def alert(mid: str) -> dict:
    return MESSAGES[mid]


class Harness(unittest.TestCase):
    """Temp workspace per test: seen_jobs.json, tracker, state file."""

    def setUp(self):
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.seen = self.root / "job_scraper" / "seen_jobs.json"
        self.tracker = self.root / "job_search_tracker.csv"
        self.state = self.root / "gmail_sync" / "gmail_jobs_state.json"

    def ingest(self, messages, **kwargs):
        return gja.ingest_messages(
            messages,
            seen_path=self.seen,
            tracker_path=self.tracker,
            state_path=self.state,
            now=NOW,
            **kwargs,
        )

    def seen_entries(self) -> dict:
        if not self.seen.exists():
            return {}
        return json.loads(self.seen.read_text(encoding="utf-8"))["seen"]

    def write_tracker(self, rows):
        with self.tracker.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=["date", "company", "sector", "role", "role_type", "channel",
                            "status", "contact_person", "fit_rating", "notes",
                            "cv_file", "cover_letter_file", "source", "deadline"],
            )
            writer.writeheader()
            for row in rows:
                writer.writerow({**{name: "" for name in writer.fieldnames}, **row})


# --- cards ------------------------------------------------------------------


class CardParsingTests(unittest.TestCase):
    def parse(self, mid):
        body, _part = gja.message_body(alert(mid))
        return gja.parse_alert_text(body)

    def test_multi_job_digest_parses_every_card(self):
        jobs, malformed = self.parse("msg-digest-en")
        self.assertEqual([], malformed)
        self.assertEqual(
            ["AI Engineer (Remote)", "Staff Data Engineer", "Machine Learning Engineer"],
            [job.title for job in jobs],
            "a digest must yield every card it contains, not only the first",
        )
        self.assertEqual(
            ["Lumenalta Analytics", "Northwind Data", "Contoso Labs"],
            [job.company for job in jobs],
        )
        self.assertEqual(["Latin America", "Brazil (Remote)", "Remote"],
                         [job.location for job in jobs])

    def test_single_job_alert(self):
        jobs, malformed = self.parse("msg-single-en")
        self.assertEqual([], malformed)
        self.assertEqual(1, len(jobs))
        self.assertEqual("Data Scientist (Remote)", jobs[0].title)
        self.assertEqual("Fabrikam Data", jobs[0].company)
        self.assertEqual("Worldwide", jobs[0].location)

    def test_portuguese_cards(self):
        jobs, _ = self.parse("msg-digest-pt")
        self.assertEqual(["Engenheiro de Dados Sênior", "Cientista de Dados"],
                         [job.title for job in jobs])
        self.assertEqual(["Brasil (Remoto)", "América Latina"],
                         [job.location for job in jobs])

    def test_spanish_cards(self):
        jobs, _ = self.parse("msg-digest-es")
        self.assertEqual(1, len(jobs))
        self.assertEqual("Ingeniero de Machine Learning", jobs[0].title)
        self.assertEqual("América Latina (Remoto)", jobs[0].location)

    def test_html_only_message_falls_back_to_the_html_part(self):
        message = alert("msg-html-only")
        body, part = gja.message_body(message)
        self.assertEqual("text/html", part, "with no text/plain part, HTML is the fallback")
        jobs, malformed = gja.parse_alert_text(body)
        self.assertEqual([], malformed)
        self.assertEqual(["Senior Data Engineer", "ML Platform Engineer"],
                         [job.title for job in jobs])
        self.assertEqual(["Brazil (Remote)", "LATAM"], [job.location for job in jobs])

    def test_plain_part_wins_when_both_are_present(self):
        message = {
            "payload": {
                "mimeType": "multipart/alternative",
                "headers": [{"name": "From", "value": gja.ALERT_SENDER}],
                "parts": [
                    {"mimeType": "text/html", "body": {"data": gja._encode_part("<p>html wins?</p>")}},
                    {"mimeType": "text/plain", "body": {"data": gja._encode_part("plain wins")}},
                ],
            }
        }
        body, part = gja.message_body(message)
        self.assertEqual(("plain wins", "text/plain"), (body, part))

    def test_malformed_card_is_reported_not_guessed(self):
        jobs, malformed = self.parse("msg-malformed-card")
        self.assertEqual(["Data Engineer"], [job.title for job in jobs])
        self.assertEqual(1, len(malformed))
        self.assertEqual("https://www.linkedin.com/jobs/view/4468333001/", malformed[0]["url"])
        self.assertNotIn("title", malformed[0], "a half-read card must not carry guessed fields")

    def test_chrome_links_are_not_jobs(self):
        for mid in ("msg-chrome-only", "msg-digest-en", "msg-digest-pt"):
            jobs, malformed = self.parse(mid)
            self.assertEqual([], malformed)
            for job in jobs:
                self.assertNotIn("/jobs/search", job.url)
                self.assertNotIn("/help/", job.url)
                self.assertNotIn("psettings", job.url)

    def test_expired_marker_marks_the_card_and_leaves_its_neighbour(self):
        jobs, _ = self.parse("msg-expired-card")
        by_title = {job.title: job for job in jobs}
        self.assertTrue(by_title["Data Engineer (Remote)"].expired)
        self.assertFalse(by_title["Analytics Engineer"].expired,
                         "one closed card must not expire the next one")

    def test_noise_lines_are_recognized_across_locales(self):
        for line in ("See all jobs: https://www.linkedin.com/jobs/search/?q=x",
                     "View job: https://www.linkedin.com/jobs/view/1234567/",
                     "Ver vaga: https://www.linkedin.com/jobs/view/1234567/",
                     "Cancelar suscripción", "Unsubscribe", "gerenciar alertas"):
            self.assertTrue(gja.is_noise_line(line), line)
        self.assertFalse(gja.is_noise_line("Staff Data Engineer"))
        self.assertFalse(gja.is_noise_line("Northwind Data · Brazil (Remote)"))


# --- links ------------------------------------------------------------------


class CanonicalUrlTests(unittest.TestCase):
    def test_canonical_form_is_the_plain_job_view_url(self):
        self.assertEqual(
            "https://www.linkedin.com/jobs/view/4466756970/",
            gja.canonical_linkedin_url(
                "https://www.linkedin.com/comm/jobs/view/4466756970/"
                "?trackingId=TRACK-A1&midToken=AQA1mid&eid=881122"
            ),
        )

    def test_tracking_parameters_never_survive(self):
        for url in (self._first_url("msg-digest-en"), self._first_url("msg-digest-pt")):
            stripped = gja.strip_tracking_params(url)
            for token in RECIPIENT_TOKENS:
                self.assertNotIn(token, stripped)
            self.assertNotIn("?", stripped)

    def test_recipient_tokens_are_dropped_from_non_job_urls_too(self):
        stripped = gja.strip_tracking_params(
            "https://www.linkedin.com/jobs/search/?keywords=data&midToken=AQA1mid&eid=881122&trk=eml"
        )
        self.assertIn("keywords=data", stripped)
        self.assertNotIn("AQA1mid", stripped)
        self.assertNotIn("881122", stripped)
        self.assertNotIn("trk=", stripped)

    def test_look_alike_hosts_and_schemes_are_refused(self):
        for url in (
            "https://www.linkedin.com.evil.example/jobs/view/4466756970/",
            "https://www.linkedin.com@evil.example/jobs/view/4466756970/",
            "https://evil.example/jobs/view/4466756970/",
            "http://notlinkedin.com/jobs/view/4466756970/",
            "https://lnkd.in/abc123",
            "javascript:alert(1)",
            "file:///etc/passwd",
        ):
            self.assertIsNone(gja.canonical_linkedin_url(url), url)

    def test_non_posting_linkedin_paths_are_refused(self):
        for url in (
            "https://www.linkedin.com/jobs/search/?keywords=AI",
            "https://www.linkedin.com/company/acme",
            "https://www.linkedin.com/help/linkedin",
            "https://www.linkedin.com/comm/psettings/email-unsubscribe",
            "https://www.linkedin.com/jobs/view/",
            "https://www.linkedin.com/jobs/view/not-a-number/",
        ):
            self.assertIsNone(gja.canonical_linkedin_url(url), url)

    def test_job_id_is_extracted_from_the_canonical_form(self):
        self.assertEqual("4466756970", gja.linkedin_job_id(self._first_url("msg-digest-en")))
        self.assertIsNone(gja.linkedin_job_id("https://www.linkedin.com/jobs/search/?q=x"))

    def test_dedup_key_prefers_the_job_id_and_falls_back_to_a_hash(self):
        self.assertEqual("linkedin:4466756970", gja.dedup_key("4466756970", "A", "B", "C"))
        hashed = gja.dedup_key(None, "Acme", "Data Engineer", "Brazil")
        self.assertTrue(hashed.startswith("alert:"))
        self.assertEqual(hashed, gja.dedup_key(None, "  ACME ", "data  engineer", "BRAZIL"))

    def _first_url(self, mid):
        body, _ = gja.message_body(alert(mid))
        return gja.URL_TOKEN.search(body).group(0)


class LocationGateTests(unittest.TestCase):
    def test_brazil_latam_and_worldwide_pass(self):
        for location in ("Brazil (Remote)", "Brasil (Remoto)", "Latin America",
                         "América Latina", "Worldwide", "Remote - anywhere"):
            self.assertEqual("PASS", gja.location_eligibility(location)[0], location)

    def test_explicitly_incompatible_scopes_fail(self):
        for location in ("United States (Remote)", "Canada", "India", "Europe only"):
            verdict, note = gja.location_eligibility(location)
            self.assertEqual("FAIL", verdict, location)
            self.assertIn("excludes Brazil", note)

    def test_bare_remote_is_a_flag_not_a_pass(self):
        verdict, note = gja.location_eligibility("Remote")
        self.assertEqual("FLAG", verdict)
        self.assertIn("not explicitly Brazil-compatible", note)

    def test_missing_location_is_a_flag(self):
        verdict, note = gja.location_eligibility(None)
        self.assertEqual("FLAG", verdict)
        self.assertIn("not stated", note)


# --- message identity -------------------------------------------------------


class MessageIdentityTests(unittest.TestCase):
    def test_alert_sender_is_accepted(self):
        accepted, reason = gja.is_linkedin_job_alert(alert("msg-digest-en"))
        self.assertTrue(accepted)
        self.assertEqual("", reason)

    def test_other_senders_are_refused(self):
        accepted, reason = gja.is_linkedin_job_alert(alert("msg-spoofed-sender"))
        self.assertFalse(accepted)
        self.assertIn("sender is not", reason)

    def test_an_unexpected_linkedin_class_is_refused(self):
        accepted, reason = gja.is_linkedin_job_alert(alert("msg-wrong-class"))
        self.assertFalse(accepted)
        self.assertIn("X-LinkedIn-Class", reason)

    def test_missing_identity_headers_are_accepted_with_a_warning(self):
        accepted, reason = gja.is_linkedin_job_alert(alert("msg-no-identity-headers"))
        self.assertTrue(accepted)
        self.assertIn("sender alone", reason)


# --- ingestion --------------------------------------------------------------


class IngestionTests(Harness):
    def test_new_jobs_are_stored_with_gmail_alert_provenance(self):
        self.ingest([alert("msg-single-en")])
        entries = self.seen_entries()
        self.assertEqual(1, len(entries), "one card, one entry")
        key, entry = next(iter(entries.items()))
        self.assertEqual("fabrikam-data_data-scientist-remote", key)
        self.assertEqual("Data Scientist (Remote)", entry["title"])
        self.assertEqual("Fabrikam Data", entry["company"])
        self.assertEqual("https://www.linkedin.com/jobs/view/4467001234/", entry["url"])
        self.assertEqual("4467001234", entry["linkedin_job_id"])
        self.assertEqual("linkedin:4467001234", entry["source_key"])
        self.assertEqual("linkedin_email_alert", entry["portal"])
        self.assertEqual("gmail", entry["source"])
        self.assertEqual("gmail_alert", entry["source_type"])
        self.assertEqual("msg-single-en", entry["source_email_id"])
        self.assertEqual("2026-09-15", entry["first_seen"])
        self.assertEqual("2026-09-15T05:04:22Z", entry["discovered_at"])
        self.assertEqual("new", entry["status"])
        self.assertEqual("PASS", entry["eligibility"])
        self.assertEqual(
            gja.message_timestamp(alert("msg-single-en"), NOW).isoformat().replace("+00:00", "Z"),
            entry["discovered_at"],
            "the message's own date is the discovery time, not the run's wall clock",
        )

    def test_the_stored_key_is_the_canonical_company_title_key(self):
        """Not `linkedin:<id>`: /scrape, /rank and /apply all key on this pair,
        and a colon-bearing key reads as malformed to tools/job_key.py --audit."""
        self.ingest([alert("msg-single-en")])
        key = next(iter(self.seen_entries()))
        self.assertNotIn(":", key)
        import job_key

        self.assertTrue(job_key.is_canonical(key))
        entry = self.seen_entries()[key]
        self.assertEqual(key, job_key.make_key(entry["company"], entry["title"], entry["url"]))

    def test_repeated_alert_with_new_tracking_parameters_is_a_duplicate(self):
        first = self.ingest([alert("msg-digest-en")])
        self.assertEqual(3, len(first.ingested))
        second = self.ingest([alert("msg-duplicate-tracking")])
        self.assertEqual(0, len(second.ingested))
        self.assertEqual(1, len(second.duplicates))
        self.assertEqual("linkedin:4466756970", second.duplicates[0]["source_key"])
        self.assertEqual(3, len(self.seen_entries()), "no second entry for one posting")

    def test_a_job_already_stored_by_scrape_is_not_ingested_again(self):
        self.seen.parent.mkdir(parents=True, exist_ok=True)
        self.seen.write_text(json.dumps({"seen": {
            "lumenalta-analytics_ai-engineer-remote": {
                "title": "AI Engineer (Remote)",
                "company": "Lumenalta Analytics",
                "url": "https://www.linkedin.com/jobs/view/4466756970/",
                "status": "ranked",
                "rank_score": 88,
            }
        }}), encoding="utf-8")
        report = self.ingest([alert("msg-duplicate-tracking")])
        self.assertEqual(0, len(report.ingested))
        self.assertEqual(1, len(report.duplicates))
        entry = self.seen_entries()["lumenalta-analytics_ai-engineer-remote"]
        self.assertEqual(88, entry["rank_score"], "an existing entry is never clobbered")

    def test_an_applied_job_in_the_tracker_is_recorded_as_skipped(self):
        self.write_tracker([{"company": "Fabrikam Data", "role": "Data Scientist (Remote)",
                             "status": "applied", "date": "2026-08-01"}])
        report = self.ingest([alert("msg-single-en")])
        self.assertEqual(0, len(report.ingested))
        self.assertEqual(1, len(report.already_tracked))
        entry = next(iter(self.seen_entries().values()))
        self.assertEqual("skipped", entry["status"])
        self.assertIn("tracker", entry["eligibility_note"])

    def test_brazil_ineligible_jobs_are_stored_skipped_not_presented(self):
        report = self.ingest([alert("msg-us-only")])
        self.assertEqual(0, len(report.ingested))
        self.assertEqual(2, len(report.ineligible))
        for entry in self.seen_entries().values():
            self.assertEqual("skipped", entry["status"])
            self.assertEqual("FAIL", entry["eligibility"])

    def test_expired_cards_are_stored_expired_not_presented(self):
        report = self.ingest([alert("msg-expired-card")])
        self.assertEqual(1, len(report.expired))
        self.assertEqual(["Analytics Engineer"], [job["title"] for job in report.ingested])
        expired = [e for e in self.seen_entries().values() if e["status"] == "expired"]
        self.assertEqual(1, len(expired))
        self.assertEqual("pristine-cloud_data-engineer-remote",
                         next(k for k, v in self.seen_entries().items() if v["status"] == "expired"))

    def test_rejected_messages_ingest_nothing(self):
        report = self.ingest([alert("msg-spoofed-sender"), alert("msg-wrong-class")])
        self.assertEqual(2, len(report.messages_rejected))
        self.assertEqual([], report.ingested)
        self.assertEqual({}, self.seen_entries(), "nothing parsed, so nothing stored")
        self.assertIn("msg-spoofed-sender", self.state.read_text(encoding="utf-8"),
                      "a rejected message is still marked processed, so it is not re-read")

    def test_processed_message_ids_make_a_rerun_idempotent(self):
        first = self.ingest([alert("msg-digest-en")])
        self.assertEqual(3, len(first.ingested))
        state = json.loads(self.state.read_text(encoding="utf-8"))
        self.assertEqual(["msg-digest-en"], state["processed_message_ids"])
        self.assertEqual("2026-09-15", state["last_sync"])

        second = self.ingest([alert("msg-digest-en")])
        self.assertEqual(0, len(second.ingested))
        self.assertEqual(0, len(second.duplicates))
        self.assertEqual(1, len(second.messages_skipped))
        self.assertEqual(3, len(self.seen_entries()))

    def test_dry_run_writes_neither_state_nor_seen(self):
        report = self.ingest([alert("msg-digest-en")], write=False)
        self.assertEqual(3, len(report.ingested))
        self.assertFalse(report.written)
        self.assertFalse(self.seen.exists())
        self.assertFalse(self.state.exists())

    def test_an_unreadable_state_file_is_a_warning_not_a_crash(self):
        self.state.parent.mkdir(parents=True, exist_ok=True)
        self.state.write_text("{not json", encoding="utf-8")
        report = self.ingest([alert("msg-digest-en")])
        self.assertEqual(3, len(report.ingested))
        self.assertTrue(any("unreadable" in w for w in report.warnings))

    def test_default_state_lives_with_the_other_personal_gmail_state(self):
        """`gmail_sync/` is already gitignored as personal data, so job-alert
        state joins it instead of opening a second personal-data path that
        .gitignore and tools/security_guards.py would both have to learn."""
        out = subprocess.run(
            [sys.executable, str(TOOL), "--messages-file", str(FIXTURE), "--dry-run", "--json"],
            capture_output=True, text=True, cwd=REPO,
        )
        self.assertEqual(0, out.returncode, out.stderr)
        state_path = json.loads(out.stdout)["state_path"].replace("\\", "/")
        self.assertIn("gmail_sync/gmail_jobs_state.json", state_path)
        gitignore = (REPO / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("gmail_sync/", gitignore)
        guards = (REPO / "tools" / "security_guards.py").read_text(encoding="utf-8")
        self.assertIn('"gmail_sync/"', guards,
                      "the personal-data ignore rule that covers the new state is pinned")


# --- security ---------------------------------------------------------------


class NoLeakTests(Harness):
    def run_tool(self, *args, expect=0):
        out = subprocess.run(
            [sys.executable, str(TOOL), *args, "--json"],
            capture_output=True, text=True, cwd=REPO,
        )
        self.assertEqual(expect, out.returncode, out.stderr)
        return out.stdout

    def test_no_recipient_token_reaches_stdout_or_the_state_file(self):
        stdout = self.run_tool("--messages-file", str(FIXTURE), "--dry-run",
                               "--seen", str(self.seen))
        for token in RECIPIENT_TOKENS:
            self.assertNotIn(token, stdout, f"tracking token {token} leaked into the report")

        self.ingest([gja.expand_fixture(m) for m in FIXTURE_DOC["messages"]])
        written = self.seen.read_text(encoding="utf-8")
        for token in RECIPIENT_TOKENS:
            self.assertNotIn(token, written, f"tracking token {token} written to seen_jobs.json")
        for entry in self.seen_entries().values():
            self.assertNotIn("?", entry["url"])
            self.assertNotIn("&", entry["url"])

    def test_raw_email_text_is_never_persisted(self):
        self.ingest([gja.expand_fixture(m) for m in FIXTURE_DOC["messages"]])
        written = self.seen.read_text(encoding="utf-8")
        for sentence in BODY_ONLY_SENTENCES:
            self.assertNotIn(sentence, written,
                             "only title/company/location/ids may be persisted")

    def test_prompt_injection_text_cannot_reach_the_queue(self):
        """The body is data. Only four fields are extracted, so instruction-like
        text has no path into the state file, the report, or a downstream agent."""
        report = self.ingest([alert("msg-injection")])
        self.assertEqual(1, len(report.ingested))
        self.assertEqual("Blue Yonder Freight", report.ingested[0]["company"])
        blob = json.dumps(report.as_dict(), ensure_ascii=False) + self.seen.read_text(encoding="utf-8")
        for phrase in ("IGNORE ALL PREVIOUS", "curl", "evil.example", "attacker@", "maintenance mode"):
            self.assertNotIn(phrase, blob, f"injected text {phrase!r} reached the output")

    def test_only_recognized_linkedin_job_urls_are_stored(self):
        self.ingest([gja.expand_fixture(m) for m in FIXTURE_DOC["messages"]])
        self.assertTrue(self.seen_entries())
        for entry in self.seen_entries().values():
            self.assertRegex(
                entry["url"],
                r"^https://www\.linkedin\.com/jobs/view/\d+/$",
                "a stored URL must be the canonical posting form",
            )

    def test_the_personal_address_in_the_fixture_is_not_stored(self):
        self.ingest([gja.expand_fixture(m) for m in FIXTURE_DOC["messages"]])
        self.assertNotIn("candidate@example.com", self.seen.read_text(encoding="utf-8"))


# --- Gmail client -----------------------------------------------------------


class GmailQueryTests(unittest.TestCase):
    def test_query_is_sender_scoped(self):
        self.assertEqual(f"from:{gja.ALERT_SENDER}", gja.build_query())

    def test_relative_windows_use_newer_than_in_gmail_units(self):
        self.assertEqual(f"from:{gja.ALERT_SENDER} newer_than:1d", gja.build_query("24h"))
        self.assertEqual(f"from:{gja.ALERT_SENDER} newer_than:7d", gja.build_query("7d"))
        self.assertEqual(f"from:{gja.ALERT_SENDER} newer_than:30d", gja.build_query("30d"))

    def test_a_date_window_uses_after_not_newer_than(self):
        query = gja.build_query("2026-08-16")
        self.assertIn("after:2026/08/16", query)
        self.assertNotIn("newer_than", query)

    def test_an_unrecognized_window_is_an_error(self):
        with self.assertRaises(gja.ConfigError):
            gja.parse_since("last tuesday")


class GmailClientTests(unittest.TestCase):
    def test_missing_credentials_are_named_and_refused(self):
        with self.assertRaises(gja.ConfigError) as caught:
            gja.fetch_access_token(env={})
        message = str(caught.exception)
        for name in gja.CREDENTIAL_ENV:
            self.assertIn(name, message)
        self.assertIn("never commit", message)

    def test_live_fetch_is_impossible_without_credentials(self):
        out = subprocess.run(
            [sys.executable, str(TOOL), "--fetch", "--since", "24h"],
            capture_output=True, text=True, cwd=REPO,
            env={k: v for k, v in os.environ.items() if k not in gja.CREDENTIAL_ENV},
        )
        self.assertEqual(1, out.returncode)
        self.assertIn("missing Gmail OAuth configuration", out.stderr)
        self.assertEqual("", out.stdout)

    def test_token_exchange_sends_the_refresh_grant_and_keeps_it_in_memory(self):
        calls = []

        def transport(method, url, token, data=None):
            calls.append((method, url, data))
            return {"access_token": "ya29.fake"}

        token = gja.fetch_access_token(
            env={"GMAIL_CLIENT_ID": "id", "GMAIL_CLIENT_SECRET": "secret",
                 "GMAIL_REFRESH_TOKEN": "refresh"},
            transport=transport,
        )
        self.assertEqual("ya29.fake", token)
        self.assertEqual("POST", calls[0][0])
        self.assertEqual(gja.GMAIL_TOKEN_URL, calls[0][1])
        self.assertIn(b"grant_type=refresh_token", calls[0][2])

    def test_message_fetch_paginates_and_honours_the_cap(self):
        listed = []

        def transport(method, url, token, data=None):
            if "/messages?" in url:
                listed.append(url)
                if len(listed) == 1:
                    return {"messages": [{"id": "m1"}, {"id": "m2"}], "nextPageToken": "page2"}
                return {"messages": [{"id": "m3"}, {"id": "m4"}]}
            return {"id": url.rsplit("/", 1)[-1].split("?")[0]}

        messages = gja.fetch_alert_messages("from:x", token="t", max_results=3,
                                            transport=transport)
        self.assertEqual(3, len(messages), "the cap is a cap, not a suggestion")
        self.assertEqual(2, len(listed), "a nextPageToken must be followed")
        self.assertIn("maxResults=3", listed[0])
        self.assertIn("pageToken=page2", listed[1])
        self.assertIn("maxResults=1", listed[1])

    def test_full_format_is_requested_for_each_message(self):
        urls = []

        def transport(method, url, token, data=None):
            urls.append(url)
            return {"messages": [{"id": "abc"}]} if "/messages?" in url else {"id": "abc"}

        gja.fetch_alert_messages("from:x", token="t", max_results=1, transport=transport)
        self.assertTrue(any("format=full" in url for url in urls))


# --- CLI --------------------------------------------------------------------


class CliTests(Harness):
    def run_tool(self, *args, **kwargs):
        return subprocess.run(
            [sys.executable, str(TOOL), *args],
            capture_output=True, text=True, cwd=REPO, **kwargs,
        )

    def test_without_input_it_explains_itself(self):
        out = self.run_tool()
        self.assertEqual(2, out.returncode)
        self.assertIn("--messages-file", out.stderr)

    def test_a_fixture_run_reports_what_it_would_write(self):
        out = self.run_tool("--messages-file", str(FIXTURE), "--dry-run", "--seen", str(self.seen))
        self.assertEqual(0, out.returncode, out.stderr)
        self.assertIn("## Gmail Job Alerts - Ingestion", out.stdout)
        self.assertIn("AI Engineer (Remote)", out.stdout)
        self.assertIn("Duplicates", out.stdout)
        self.assertIn("Gated out", out.stdout)
        self.assertFalse(self.seen.exists(), "--dry-run must not write the state file")

    def test_a_missing_fixture_file_is_an_error(self):
        out = self.run_tool("--messages-file", str(self.seen.parent / "missing.json"))
        self.assertEqual(1, out.returncode)
        self.assertIn("cannot read", out.stderr)

    def test_a_real_run_writes_entries_and_state(self):
        out = self.run_tool(
            "--messages-file", str(FIXTURE),
            "--seen", str(self.seen), "--tracker", str(self.tracker), "--state", str(self.state),
        )
        self.assertEqual(0, out.returncode, out.stderr)
        self.assertTrue(self.seen.exists())
        self.assertTrue(self.state.exists())
        self.assertIn("msg-digest-en", self.state.read_text(encoding="utf-8"))

    def test_help_advertises_the_offline_and_live_paths(self):
        out = self.run_tool("--help")
        self.assertEqual(0, out.returncode)
        self.assertIn("--messages-file", out.stdout)
        self.assertIn("--fetch", out.stdout)

    def test_json_output_is_machine_readable(self):
        out = self.run_tool("--messages-file", str(FIXTURE), "--dry-run", "--seen", str(self.seen),
                            "--json")
        self.assertEqual(0, out.returncode, out.stderr)
        payload = json.loads(out.stdout)
        self.assertTrue(payload["ingested"])
        self.assertIn("eligibility", payload["ingested"][0])


# --- documentation and wiring -----------------------------------------------


class DocumentationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.command = COMMAND.read_text(encoding="utf-8")
        cls.skill = SKILL.read_text(encoding="utf-8")

    def test_command_file_exists_and_has_the_lint_title(self):
        self.assertTrue(COMMAND.exists())
        self.assertTrue(self.command.startswith("# /gmail-jobs"))

    def test_command_documents_the_interface_from_the_issue(self):
        for flag in ("/gmail-jobs --since 24h", "/gmail-jobs --backfill 30d",
                     "/gmail-jobs --rank", "/gmail-jobs --apply-ready"):
            self.assertIn(flag, self.command)

    def test_command_is_read_only_against_gmail(self):
        self.assertIn("gmail.readonly", self.command)
        self.assertIn("never", self.command.lower())
        self.assertIn("read-only", self.command.lower())

    def test_command_forbids_automating_authenticated_linkedin(self):
        self.assertIn("Easy Apply", self.command)
        self.assertIn("manual review", self.command.lower())

    def test_command_never_retries_an_uncertain_submission(self):
        self.assertIn("submission-uncertain", self.command)
        self.assertRegex(self.command, r"[Nn]ever .{0,40}retry")

    def test_command_defers_pipeline_rules_to_the_scraper_skill(self):
        self.assertIn(".claude/skills/job-scraper/SKILL.md", self.command)
        self.assertIn("job_search_tracker.csv", self.command)

    def test_command_sends_new_jobs_to_the_existing_rank_workflow(self):
        self.assertIn("/rank", self.command)
        self.assertIn("/apply", self.command)

    def test_scraper_skill_documents_the_gmail_alert_source(self):
        self.assertIn("linkedin_email_alert", self.skill,
                      "the new discovery source belongs in the canonical scraper spec")
        self.assertIn("gmail_job_alerts.py", self.skill)

    def test_scraper_skill_records_the_additive_fields(self):
        for field_name in ("`eligibility`", "`linkedin_job_id`", "`source_key`", "`location`"):
            self.assertIn(field_name, self.skill,
                          f"{field_name} is written by the alert source and must be documented")

    def test_settings_allows_the_tool_and_security_guards_knows(self):
        settings = json.loads((REPO / ".claude" / "settings.json").read_text(encoding="utf-8"))
        allow = settings["permissions"]["allow"]
        self.assertIn("Bash(python tools/gmail_job_alerts.py:*)", allow)
        self.assertIn("Bash(python3 tools/gmail_job_alerts.py:*)", allow)
        guards = (REPO / "tools" / "security_guards.py").read_text(encoding="utf-8")
        for entry in ("Bash(python tools/gmail_job_alerts.py:*)",
                      "Bash(python3 tools/gmail_job_alerts.py:*)"):
            self.assertIn(entry, guards,
                          "a new pre-approved permission must be added to the reviewed "
                          "allowlist in the same change")

    def test_changelog_records_the_new_source(self):
        changelog = (REPO / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertIn("gmail-jobs", changelog)
        self.assertIn("gmail_job_alerts", changelog)


if __name__ == "__main__":
    unittest.main()

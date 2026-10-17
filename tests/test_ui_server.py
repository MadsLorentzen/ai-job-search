"""Tests for the local web console (ui/server.py).

The server is exercised through its real HTTP handler on an ephemeral port, against
temporary copies of the tracker and seen_jobs.json, so nothing touches workspace data.
"""
import importlib.util
import json
import os
import shutil
import stat
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("jobui_server", os.path.join(REPO, "ui", "server.py"))
server = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(server)

HEADER = ",".join(server.FIELDS)


class UiServerCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        for d in ("ui", "job_scraper", "cv", "cover_letters", "documents"):
            os.makedirs(os.path.join(self.tmp, d))
        self.tracker = os.path.join(self.tmp, "job_search_tracker.csv")
        self.seen = os.path.join(self.tmp, "job_scraper", "seen_jobs.json")
        with open(self.tracker, "w", newline="") as f:
            f.write(HEADER + "\n"
                    "2026-09-07,Northwind Agency (via Talentbridge),Public sector,Administrative Assistant,,Jobindex,"
                    "applied,,medium,\"Deadline 13 Sep 2026; English-working\",,,https://jobs.example.org/posting/48213,\n")
        with open(self.seen, "w") as f:
            json.dump({"seen": {
                "northwind": {"title": "Administrative Assistant (for Northwind)", "company": "Talentbridge (recruiting for Northwind)",
                        "url": "https://jobs.example.org/posting/48213", "status": "new"},
                "acme": {"title": "Travel Coordinator", "company": "Acme", "url": "https://example.com/job/1",
                         "status": "ranked", "rank_score": 71},
                "old": {"title": "Expired role", "company": "Old Co", "url": "https://example.com/job/2",
                        "status": "skipped-expired"},
            }}, f)
        # An isolated profile registry, and this temp folder served as profile "test".
        self._home = server.profiles.HOME
        server.profiles.HOME = __import__("pathlib").Path(tempfile.mkdtemp())
        self.ws = server.Workspace({"slug": "test", "path": self.tmp, "gmail": True}, pinned=True)
        server.WS.clear()
        server.WS["test"] = self.ws
        server.RUNS.clear()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.H)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        shutil.rmtree(server.profiles.HOME, ignore_errors=True)
        server.profiles.HOME = self._home
        server.WS.clear()
        server.RUNS.clear()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def request(self, path, body=None, headers=None):
        if path.startswith(("/api/", "/file")) and not path.startswith("/api/profiles"):
            path = "/p/test" + path
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}",
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            with e:
                return e.code, json.loads(e.read() or b"null")


class TrackerWrites(UiServerCase):
    def test_status_update_keeps_lf_line_endings(self):
        # csv's default lineterminator is \r\n; a UI edit must not rewrite every line of an LF tracker.
        key = server.row_key(server.read_tracker(self.ws)[0])
        code, row = self.request("/api/applications/update", {"key": key, "status": "interview", "note": "call on Fri"})
        self.assertEqual(200, code)
        self.assertEqual("interview", row["status"])
        with open(self.tracker, "rb") as f:
            data = f.read()
        self.assertNotIn(b"\r\n", data)
        self.assertIn(b"update ", data)

    def test_invalid_status_is_rejected(self):
        key = server.row_key(server.read_tracker(self.ws)[0])
        code, _ = self.request("/api/applications/update", {"key": key, "status": "ghosted"})
        self.assertEqual(400, code)

    def test_marking_applied_matches_existing_row_by_posting_url(self):
        # The recruiter's ad names the company differently than the tracker row; same posting URL.
        code, res = self.request("/api/jobs/status", {"key": "northwind", "status": "applied"})
        self.assertEqual(200, code)
        self.assertFalse(res["tracked"])
        self.assertEqual(1, len(server.read_tracker(self.ws)))

    def test_marking_applied_adds_a_new_job_once(self):
        _, res = self.request("/api/jobs/status", {"key": "acme", "status": "applied"})
        self.assertTrue(res["tracked"])
        _, res = self.request("/api/jobs/status", {"key": "acme", "status": "applied"})
        self.assertFalse(res["tracked"])
        rows = server.read_tracker(self.ws)
        self.assertEqual(["Northwind Agency (via Talentbridge)", "Acme"], [r["company"] for r in rows])
        self.assertEqual("applied", rows[1]["status"])


class DiscoveredJobs(UiServerCase):
    def test_groups_and_first_launch_marks_everything_seen(self):
        code, data = self.request("/api/jobs")
        self.assertEqual(200, code)
        groups = {j["key"]: j["group"] for j in data["jobs"]}
        self.assertEqual({"northwind": "review", "acme": "review", "old": "expired"}, groups)
        self.assertFalse(any(j["fresh"] for j in data["jobs"]))

    def test_job_added_after_first_launch_is_fresh_until_acted_on(self):
        self.request("/api/jobs")  # first launch: snapshot of known keys
        with open(self.seen) as f:
            d = json.load(f)
        d["seen"]["new1"] = {"title": "Ops Assistant", "company": "Beta", "url": "https://example.com/3", "status": "new"}
        with open(self.seen, "w") as f:
            json.dump(d, f)
        _, data = self.request("/api/jobs")
        self.assertEqual(["new1"], [j["key"] for j in data["jobs"] if j["fresh"]])
        self.request("/api/jobs/status", {"key": "new1", "status": "saved"})
        _, data = self.request("/api/jobs")
        self.assertEqual([], [j["key"] for j in data["jobs"] if j["fresh"]])


class RequestGuards(UiServerCase):
    def test_foreign_host_is_refused(self):
        # DNS rebinding: a page on evil.example resolving to 127.0.0.1 must not read the tracker.
        code, _ = self.request("/api/applications", headers={"Host": "evil.example"})
        self.assertEqual(403, code)

    def test_cross_origin_post_is_refused(self):
        code, _ = self.request("/api/run", {"action": "scrape", "args": ""},
                               headers={"Origin": "https://evil.example"})
        self.assertEqual(403, code)

    def test_unknown_action_and_shell_like_args_are_refused(self):
        self.assertEqual(400, self.request("/api/run", {"action": "reset", "args": "all"})[0])
        self.assertEqual(400, self.request("/api/run", {"action": "scrape", "args": "x; rm -rf ~"})[0])
        self.assertEqual({}, server.RUNS)

    def test_file_endpoint_only_serves_document_folders(self):
        with open(os.path.join(self.tmp, "cv", "cv.pdf"), "wb") as f:
            f.write(b"%PDF-1.4")
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/p/test/file?path=cv/cv.pdf", timeout=5) as r:
            self.assertEqual(200, r.status)
        for path in ("job_search_tracker.csv", "cv/../job_search_tracker.csv", "../etc/passwd"):
            with self.assertRaises(urllib.error.HTTPError) as cm:
                urllib.request.urlopen(f"http://127.0.0.1:{self.port}/p/test/file?path={path}", timeout=5)
            cm.exception.close()
            self.assertEqual(404, cm.exception.code, path)


class RunLocks(UiServerCase):
    def fake_running(self, action, label):
        server.RUNS[label] = {"id": label, "action": action, "label": label, "status": "running", "ws": "test"}

    def test_runs_writing_the_same_file_conflict(self):
        self.fake_running("scrape", "/scrape")
        self.assertEqual("/scrape", server.conflict(self.ws, "rank"))          # both write seen_jobs.json
        self.assertIsNone(server.conflict(self.ws, "cover-letter"))            # tracker only
        code, err = self.request("/api/jobs/status", {"key": "acme", "status": "skipped"})
        self.assertEqual(409, code)                                   # UI edits wait too

    def test_resuming_a_session_that_is_still_running_conflicts(self):
        server.RUNS["r1"] = {"id": "r1", "action": "interview", "label": "prep", "status": "running", "ws": "test",
                             "session_id": "s-1"}
        self.assertEqual("prep", server.conflict(self.ws, "interview", resume="s-1"))
        self.assertIsNone(server.conflict(self.ws, "interview", resume="s-2"))


@unittest.skipUnless(hasattr(os, "killpg"), "process groups are POSIX-only")
class StopKillsTheWholeRun(UiServerCase):
    def test_stop_ends_a_run_whose_child_holds_the_output_pipe(self):
        # A stand-in `claude` that, like the real one, starts a child sharing its stdout.
        bindir = os.path.join(self.tmp, "bin")
        os.makedirs(bindir)
        fake = os.path.join(bindir, "claude")
        with open(fake, "w") as f:
            f.write('#!/bin/sh\necho \'{"type":"system","subtype":"init","session_id":"s-1"}\'\n'
                    "sleep 30 &\nwait\n")
        os.chmod(fake, os.stat(fake).st_mode | stat.S_IEXEC)
        old_path = os.environ["PATH"]
        os.environ["PATH"] = bindir + os.pathsep + old_path
        try:
            run = server.start_run(self.ws, "interview", "/interview acme", "prep")
            for _ in range(50):
                if run.get("session_id"):
                    break
                time.sleep(0.05)
            start = time.time()
            server.stop_run(run)
            while run["status"] in ("running", "cancelling") and time.time() - start < 10:
                time.sleep(0.05)
        finally:
            os.environ["PATH"] = old_path
        self.assertEqual("cancelled", run["status"])
        self.assertLess(time.time() - start, 5)
        with open(os.path.join(self.ws.runs_dir, run["id"] + ".json")) as f:
            self.assertEqual("cancelled", json.load(f)["status"])


FAKE_CLAUDE = r"""#!/usr/bin/env python3
# Stand-in for `claude -p ... --output-format stream-json`, enough for the brief flow.
import json, os, sys
prompt = sys.argv[2]
with open("ui/fake_argv.json", "a") as f:
    f.write(json.dumps(sys.argv[1:]) + "\n")
say = lambda t: print(json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": t}]}}), flush=True)
print(json.dumps({"type": "system", "subtype": "init", "session_id": "s-1", "mcp_servers": []}), flush=True)
if prompt.startswith("/scrape"):
    with open("job_scraper/seen_jobs.json") as f:
        d = json.load(f)
    d["seen"]["fresh1"] = {"title": "Ops Assistant", "company": "Beta", "url": "https://example.com/job/9", "status": "new"}
    with open("job_scraper/seen_jobs.json", "w") as f:
        json.dump(d, f)
    say("Found 1 new job.")
elif prompt.startswith("Write a short brief"):
    if os.path.exists("ui/fake_broken"):
        say("Here you go: ```json {not json} ```")
    else:
        brief = {"summary": "Coordinates staff travel for a regional office.", "requirements": ["2+ years travel coordination"],
                 "nice_to_have": [], "strengths": ["Direct travel booking experience"], "concerns": ["Some evening calls"],
                 "gaps": [], "fit": "high", "verdict": "Strong match on the core duties.", "source": "posting"}
        say("Done.\n```json\n" + json.dumps({"j1": brief}) + "\n```")
print(json.dumps({"type": "result", "is_error": False, "total_cost_usd": 0.01}), flush=True)
"""


@unittest.skipUnless(hasattr(os, "killpg"), "the stand-in claude is a POSIX script")
class RoleBriefs(UiServerCase):
    def setUp(self):
        super().setUp()
        bindir = os.path.join(self.tmp, "bin")
        os.makedirs(bindir)
        fake = os.path.join(bindir, "claude")
        with open(fake, "w") as f:
            f.write(FAKE_CLAUDE)
        os.chmod(fake, os.stat(fake).st_mode | stat.S_IEXEC)
        self._path = os.environ["PATH"]
        os.environ["PATH"] = bindir + os.pathsep + self._path

    def tearDown(self):
        os.environ["PATH"] = self._path
        super().tearDown()

    def wait(self, run_id):
        for _ in range(200):
            if server.RUNS[run_id]["status"] not in ("running", "cancelling"):
                return server.RUNS[run_id]
            time.sleep(0.05)
        self.fail("run did not finish")

    def test_brief_is_stored_once_and_shown_on_the_job_and_its_tracker_row(self):
        row_key = server.row_key(server.read_tracker(self.ws)[0])
        # The scraped job and the tracker row point at the same posting: one target, one brief.
        code, run = self.request("/api/run", {"action": "brief", "refs": [{"kind": "job", "key": "northwind"},
                                                                          {"kind": "app", "key": row_key}]})
        self.assertEqual(200, code)
        self.assertEqual(1, len(run["brief_ids"]))
        self.assertEqual("done", self.wait(run["id"])["status"])
        _, jobs = self.request("/api/jobs")
        brief = next(j for j in jobs["jobs"] if j["key"] == "northwind")["brief"]
        self.assertEqual("Coordinates staff travel for a regional office.", brief["summary"])
        self.assertEqual(["Some evening calls"], brief["concerns"])
        _, apps = self.request("/api/applications")
        self.assertEqual(brief, apps["rows"][0]["brief"])

    def test_brief_runs_cannot_edit_files(self):
        _, run = self.request("/api/run", {"action": "brief", "refs": [{"kind": "job", "key": "acme"}]})
        self.wait(run["id"])
        with open(os.path.join(self.tmp, "ui", "fake_argv.json")) as f:
            argv = json.loads(f.readline())
        self.assertIn("--disallowedTools", argv)
        self.assertTrue({"Write", "Edit"} <= set(argv[argv.index("--disallowedTools") + 1:]))

    def test_unparseable_reply_saves_nothing_and_reports_it(self):
        open(os.path.join(self.tmp, "ui", "fake_broken"), "w").close()
        _, run = self.request("/api/run", {"action": "brief", "refs": [{"kind": "job", "key": "acme"}]})
        done = self.wait(run["id"])
        self.assertEqual("error", done["status"])
        self.assertIn("did not parse", " ".join(t for _, t in done["lines"]))
        self.assertEqual({}, server.read_briefs(self.ws))

    def test_a_finished_scrape_summarizes_the_jobs_it_added(self):
        self.request("/api/jobs")   # first launch: everything already scraped counts as seen
        scrape = server.start_run(self.ws, "scrape", "/scrape ")
        self.wait(scrape["id"])
        briefs = [r for r in server.RUNS.values() if r["action"] == "brief"]
        self.assertEqual(1, len(briefs))
        self.assertEqual(["https://example.com/job/9"], [t["id"] for t in briefs[0]["targets"]])
        self.wait(briefs[0]["id"])
        _, jobs = self.request("/api/jobs")
        self.assertIsNotNone(next(j for j in jobs["jobs"] if j["key"] == "fresh1")["brief"])


if __name__ == "__main__":
    unittest.main()

"""Tests for UI profiles (ui/profiles.py) and the server's per-profile isolation.

A throwaway git repo stands in for the app, so the template ref, the working tree and the
profile home are all temporary; a stand-in `claude` records where and how it was started.
"""
import base64
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("jobui_server_p", os.path.join(REPO, "ui", "server.py"))
server = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(server)
profiles = server.profiles

PROFILE_01 = ".claude/skills/job-application-assistant/01-candidate-profile.md"
TEMPLATE = {
    "CLAUDE.md": "# Job Application Assistant for [YOUR_NAME]\n\n## Candidate Profile\n- **Name:** [YOUR_NAME]\n\n## Repo\n",
    PROFILE_01: "---\nframework_version: 1\n---\n- **Email:** [YOUR_EMAIL]\n",
    ".claude/skills/job-application-assistant/04-job-evaluation.md": "Skills: [YOUR_PRIMARY_SKILLS]\n",
    ".claude/skills/job-application-assistant/05-cv-templates.md": "\\name{[YOUR_NAME]}\n",
    ".claude/skills/job-application-assistant/06-cover-letter-templates.md": "\\signature{[YOUR_NAME]}\n",
    ".claude/skills/job-scraper/search-queries.md": "City: [YOUR_CITY]\n",
    ".claude/commands/setup.md": "# /setup v1\n",
    ".agents/skills/demo-search/SKILL.md": "---\nname: demo-search\nenabled: false\n---\nv1\n",
    ".agents/skills/demo-search/cli/package.json": "{}\n",
    "cv/main_example.tex": "\\name{[First]}{[Last]}\n",
    "cover_letters/cover_example.tex": "[YOUR NAME]\n",
    "tools/rank_state.py": "print('v1')\n",
    "documents/README.md": "docs\n",
    "tests/test_x.py": "app only\n",
    "ui/server.py": "app only\n",
}
FAKE_CLAUDE = r"""#!/usr/bin/env python3
import json, os, sys, time
with open(os.path.join(os.getcwd(), "claude_calls.jsonl"), "a") as f:
    f.write(json.dumps({"cwd": os.getcwd(), "argv": sys.argv[1:]}) + "\n")
print(json.dumps({"type": "system", "subtype": "init", "session_id": "s-1", "mcp_servers": []}), flush=True)
if os.path.exists("stage_me"):   # behave like Claude under the write-protected .claude/
    os.makedirs("ui/staging/skills/job-scraper", exist_ok=True)
    open("ui/staging/skills/job-scraper/search-queries.md", "w").write("City: Copenhagen\n")
    os.makedirs("ui/staging/commands", exist_ok=True)
    open("ui/staging/commands/setup.md", "w").write("hijacked\n")
    print(json.dumps({"type": "result", "is_error": False, "permission_denials": [
        {"tool_name": "Edit", "tool_input": {"file_path": os.getcwd() + "/.claude/skills/job-scraper/search-queries.md"}}]}), flush=True)
if "SLOW" in os.environ.get("FAKE_MODE", "") or os.path.exists("slow"):
    time.sleep(3)
print(json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": "Done."}]}}), flush=True)
print(json.dumps({"type": "result", "is_error": False, "total_cost_usd": 0.01}), flush=True)
"""


def git(cwd, *args):
    subprocess.run(["git", "-C", cwd, *args], check=True, capture_output=True)


def write(root, rel, text):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


class ProfilesCase(unittest.TestCase):
    def setUp(self):
        self.app = tempfile.mkdtemp()
        git(self.app, "init", "-q", "-b", "main")
        git(self.app, "config", "user.email", "t@example.com")
        git(self.app, "config", "user.name", "t")
        for rel, text in TEMPLATE.items():
            write(self.app, rel, text)
        os.makedirs(os.path.join(self.app, ".agents/skills/demo-search/cli/node_modules"))
        git(self.app, "add", "-A")
        git(self.app, "commit", "-qm", "template")
        # The app checkout itself holds someone's data, as a personal checkout would.
        write(self.app, "CLAUDE.md", "# Job Application Assistant for Jane Doe\n")
        write(self.app, "job_search_tracker.csv", "date,company\n2026-01-01,Secret Co\n")
        self.home = Path(tempfile.mkdtemp())
        self._saved = (profiles.APP, profiles.HOME, profiles.TEMPLATE_REF)
        profiles.APP, profiles.HOME, profiles.TEMPLATE_REF = Path(self.app), self.home, "main"
        server.WS.clear()
        server.RUNS.clear()

    def tearDown(self):
        profiles.APP, profiles.HOME, profiles.TEMPLATE_REF = self._saved
        server.WS.clear()
        server.RUNS.clear()
        shutil.rmtree(self.app, ignore_errors=True)
        shutil.rmtree(self.home, ignore_errors=True)


class CreateAndSync(ProfilesCase):
    def test_profile_gets_the_template_not_the_app_working_tree(self):
        p = profiles.create("anna", "Anna")
        root = Path(p["path"])
        self.assertIn("[YOUR_NAME]", (root / "CLAUDE.md").read_text())          # from the ref, not "Jane Doe"
        self.assertFalse((root / "job_search_tracker.csv").exists())             # app's data never copied
        self.assertFalse((root / "tests").exists())                               # app-only files left out
        self.assertTrue((root / "documents" / "cv").is_dir())
        nm = root / ".agents/skills/demo-search/cli/node_modules"
        self.assertFalse(nm.is_symlink())                                         # never shares the app's install
        self.assertEqual("new", profiles.status(root)["state"])

    def test_status_moves_from_new_to_partial_to_ready(self):
        root = Path(profiles.create("anna", "Anna")["path"])
        write(root, "CLAUDE.md", "# Job Application Assistant for Anna\n")
        write(root, PROFILE_01, "---\nframework_version: 1\n---\n- **Email:** anna@example.com\n")
        st = profiles.status(root)
        self.assertEqual("partial", st["state"])
        self.assertIn("cv/main_example.tex", [m["file"] for m in st["missing"]])
        for rel in TEMPLATE:
            f = root / rel
            if f.exists() and "[" in f.read_text():
                f.write_text(f.read_text().replace("[YOUR_", "[x").replace("[First]", "Anna").replace("[YOUR NAME]", "Anna"))
        self.assertEqual("ready", profiles.status(root)["state"])

    def test_sync_updates_framework_and_keeps_person_files_and_portal_choice(self):
        root = Path(profiles.create("anna", "Anna")["path"])
        write(root, "CLAUDE.md", "# Job Application Assistant for Anna\n")
        write(root, ".agents/skills/demo-search/SKILL.md", "---\nname: demo-search\nenabled: true\n---\nv1\n")
        # New framework release: methodology file, portal skill and a personalized file's template change.
        write(self.app, ".claude/commands/setup.md", "# /setup v2\n")
        write(self.app, ".agents/skills/demo-search/SKILL.md", "---\nname: demo-search\nenabled: false\n---\nv2\n")
        write(self.app, PROFILE_01, "---\nframework_version: 2\n---\n- **Email:** [YOUR_EMAIL]\n")
        write(self.app, "CLAUDE.md", TEMPLATE["CLAUDE.md"] + "new section\n")
        git(self.app, "add", ".claude", ".agents", PROFILE_01, "CLAUDE.md")
        git(self.app, "commit", "-qm", "release 2")
        report = profiles.sync("anna")
        self.assertEqual("# /setup v2\n", (root / ".claude/commands/setup.md").read_text())
        skill = (root / ".agents/skills/demo-search/SKILL.md").read_text()
        self.assertIn("v2", skill)
        self.assertIn("enabled: true", skill)                                      # profile's choice kept
        self.assertEqual("# Job Application Assistant for Anna\n", (root / "CLAUDE.md").read_text())
        self.assertEqual([PROFILE_01], report["needs_merge"])                     # version moved: flag, don't overwrite
        self.assertIn("[YOUR_EMAIL]", (root / PROFILE_01).read_text())            # untouched (still the old copy)


class ServerIsolation(ProfilesCase):
    def setUp(self):
        super().setUp()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.H)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        bindir = Path(tempfile.mkdtemp())
        (bindir / "claude").write_text(FAKE_CLAUDE)
        (bindir / "claude").chmod((bindir / "claude").stat().st_mode | stat.S_IEXEC)
        self.bindir = bindir
        self._path = os.environ["PATH"]
        os.environ["PATH"] = str(bindir) + os.pathsep + self._path

    def tearDown(self):
        os.environ["PATH"] = self._path
        self.httpd.shutdown()
        self.httpd.server_close()
        for r in list(server.RUNS.values()):
            if r.get("proc") and r["proc"].poll() is None:
                r["proc"].kill()
        shutil.rmtree(self.bindir, ignore_errors=True)
        super().tearDown()

    def request(self, path, body=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}",
                                     data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            with e:
                return e.code, json.loads(e.read() or b"null")

    def wait(self, run_id):
        for _ in range(200):
            if server.RUNS[run_id]["status"] not in ("running", "cancelling"):
                return server.RUNS[run_id]
            time.sleep(0.05)
        self.fail("run did not finish")

    def make(self, name):
        code, p = self.request("/api/profiles", {"name": name})
        self.assertEqual(200, code, p)
        return p["slug"], Path(profiles.get(p["slug"])["path"])

    def test_profiles_never_see_each_others_data(self):
        a, root_a = self.make("Anna Berg")
        b, root_b = self.make("Bob Lee")
        self.assertEqual(("anna-berg", "bob-lee"), (a, b))
        write(root_a, "job_search_tracker.csv", ",".join(server.FIELDS) + "\n2026-01-01,Anna Co,,Analyst,,,applied,,,,,,,\n")
        self.assertEqual(1, len(self.request(f"/p/{a}/api/applications")[1]["rows"]))
        self.assertEqual([], self.request(f"/p/{b}/api/applications")[1]["rows"])
        self.assertEqual(404, self.request("/p/nobody/api/applications")[0])

    def test_claude_runs_inside_the_profile_folder(self):
        a, root_a = self.make("Anna")
        b, root_b = self.make("Bob")
        _, run = self.request(f"/p/{b}/api/run", {"action": "rank", "args": ""})
        self.assertEqual("done", self.wait(run["id"])["status"])
        calls = [json.loads(l) for l in (root_b / "claude_calls.jsonl").read_text().splitlines()]
        self.assertEqual(os.path.realpath(root_b), os.path.realpath(calls[0]["cwd"]))
        self.assertFalse((root_a / "claude_calls.jsonl").exists())
        self.assertTrue((root_b / "ui" / "runs" / f"{run['id']}.json").exists())    # history lives with the profile
        self.assertEqual([], self.request(f"/p/{a}/api/runs")[1])

    def test_upload_is_confined_to_the_profile_documents(self):
        a, root = self.make("Anna")
        data = base64.b64encode(b"%PDF-1.4 cv").decode()
        code, res = self.request(f"/p/{a}/api/upload", {"folder": "cv", "name": "../../evil.pdf", "data": data})
        self.assertEqual(200, code)
        self.assertTrue((root / "documents" / "cv" / "evil.pdf").exists())
        self.assertFalse((root.parent / "evil.pdf").exists())
        self.assertEqual(400, self.request(f"/p/{a}/api/upload", {"folder": "cv", "name": "x.exe", "data": data})[0])
        self.assertEqual(400, self.request(f"/p/{a}/api/upload", {"folder": "../ui", "name": "x.pdf", "data": data})[0])
        self.assertEqual(200, self.request(f"/p/{a}/api/upload", {"folder": "cv", "name": "evil.pdf", "data": data})[0])
        names = sorted(d["name"] for d in self.request(f"/p/{a}/api/profile")[1]["documents"])
        self.assertEqual(["evil (2).pdf", "evil.pdf"], names)                        # never overwrites

    def test_setup_writes_answers_runs_exclusively_and_only_blocks_its_own_profile(self):
        a, root_a = self.make("Anna")
        b, _ = self.make("Bob")
        self.assertEqual(400, self.request(f"/p/{a}/api/setup", {"answers": {"full_name": "Anna"}})[0])
        (root_a / "slow").write_text("1")          # keep the fake setup run alive for a moment
        answers = {"full_name": "Anna Berg", "roles": "Travel coordinator", "market": "Denmark",
                   "areas": "Copenhagen", "cv_text": "Anna Berg - 5 years travel coordination",
                   "languages": [{"language": "English", "level": "Fluent"}], "salary": ""}
        code, run = self.request(f"/p/{a}/api/setup", {"answers": answers})
        self.assertEqual(200, code, run)
        md = (root_a / "documents" / "setup_answers.md").read_text()
        self.assertIn("## Target role titles\n\nTravel coordinator", md)
        self.assertIn("- English: Fluent", md)
        self.assertNotIn("Salary", md)                                               # blank answers left out
        self.assertEqual(409, self.request(f"/p/{a}/api/run", {"action": "scrape", "args": ""})[0])
        code, other = self.request(f"/p/{b}/api/run", {"action": "scrape", "args": ""})
        self.assertEqual(200, code)                                                  # other profile unaffected
        self.wait(run["id"]); self.wait(other["id"])
        prompt = server.RUNS[run["id"]]["prompt"]
        self.assertIn(".claude/commands/setup.md", prompt)
        self.assertIn("Path B", prompt)

    def test_staged_profile_files_are_installed_with_a_backup_and_nothing_else(self):
        a, root = self.make("Anna")
        (root / "stage_me").write_text("1")
        _, run = self.request(f"/p/{a}/api/run", {"action": "rank", "args": ""})
        done = self.wait(run["id"])
        self.assertEqual("done", done["status"], done["lines"])                  # expected .claude denial is not an error
        self.assertEqual("City: Copenhagen\n", (root / ".claude/skills/job-scraper/search-queries.md").read_text())
        self.assertEqual("# /setup v1\n", (root / ".claude/commands/setup.md").read_text())   # not a profile file
        self.assertTrue((root / "ui/backups" / run["id"] / "claude/skills/job-scraper/search-queries.md").exists())
        self.assertFalse((root / "ui/staging").exists())
        argv = json.loads((root / "claude_calls.jsonl").read_text().splitlines()[0])["argv"]
        self.assertIn("--append-system-prompt", argv)

    def test_gmail_sync_is_off_for_new_profiles(self):
        a, _ = self.make("Anna")
        code, res = self.request(f"/p/{a}/api/run", {"action": "gmail-sync", "args": ""})
        self.assertEqual(400, code)
        self.assertIn("shared by every profile", res["error"])

    def test_existing_personal_checkout_is_adopted_in_place(self):
        orig = server.APP
        server.APP = self.app
        try:
            server.adopt_app_checkout()
        finally:
            server.APP = orig
        p = profiles.get("jane")
        self.assertEqual("Jane Doe", p["name"])
        self.assertTrue(p["external"])
        self.assertEqual(os.path.realpath(self.app), p["path"])
        self.assertEqual(1, len(self.request("/p/jane/api/applications")[1]["rows"]))


if __name__ == "__main__":
    unittest.main()

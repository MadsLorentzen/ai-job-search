"""tools/export_seen_jobs.py: seen_jobs.json as a spreadsheet the user can search."""

import csv
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

from export_seen_jobs import COLUMNS, contact_cell, export  # noqa: E402

STATE = {"seen": {
    "acme_data-engineer": {
        "title": "Data Engineer", "company": "Acme", "url": "https://acme.example/jobs/1",
        "first_seen": "2026-10-14", "posted_date": "2026-10-12", "deadline": None,
        "fit": "medium", "status": "new", "portal": "linkedin-search", "source": "cli",
        "contacts": [{"name": "Jane Doe", "email": None, "role": "Recruiter", "kind": "named"},
                     {"name": None, "email": "careers@acme.example", "role": None,
                      "kind": "recruiting_inbox"}],
    },
    "beta_qa-engineer": {
        "title": "QA Engineer, Payments", "company": "Béta Ltd", "url": "https://b.example/2",
        "first_seen": "2026-10-14", "posted_date": None, "deadline": "2026-11-01",
        "fit": "high", "status": "ranked", "rank_score": 78, "rank_verdict": "strong fit",
        "portal": "indeed (websearch)", "source": "websearch",
    },
    "old_analyst": {
        "title": "Analyst", "company": "Old Co", "url": "https://o.example/3",
        "first_seen": "2026-09-01", "fit": "low", "status": "skipped",
    },
}}


class Export(unittest.TestCase):
    def run_export(self, state=STATE):
        d = Path(tempfile.mkdtemp())
        (d / "seen.json").write_text(json.dumps(state), encoding="utf-8")
        n = export(str(d / "seen.json"), str(d / "out.csv"))
        with open(d / "out.csv", encoding="utf-8-sig", newline="") as fh:
            return n, list(csv.DictReader(fh)), (d / "out.csv").read_bytes()

    def test_one_row_per_job_with_the_fixed_header(self):
        n, table, _ = self.run_export()
        self.assertEqual(n, 3)
        self.assertEqual(list(table[0].keys()), COLUMNS)

    def test_newest_first_then_best_fit(self):
        _, table, _ = self.run_export()
        self.assertEqual([r["key"] for r in table],
                         ["beta_qa-engineer", "acme_data-engineer", "old_analyst"])

    def test_commas_and_accents_survive_the_round_trip(self):
        _, table, raw = self.run_export()
        self.assertEqual(table[0]["title"], "QA Engineer, Payments")
        self.assertEqual(table[0]["company"], "Béta Ltd")
        self.assertTrue(raw.startswith(b"\xef\xbb\xbf"), "Excel needs the BOM for UTF-8")

    def test_missing_fields_are_blank_not_none(self):
        _, table, _ = self.run_export()
        old = table[2]
        self.assertEqual(old["posted_date"], "")
        self.assertNotIn("None", old.values())

    def test_contacts_flatten_to_one_cell(self):
        self.assertEqual(contact_cell(STATE["seen"]["acme_data-engineer"]["contacts"]),
                         "Jane Doe (Recruiter); careers@acme.example")
        self.assertEqual(contact_cell(None), "")

    def test_state_file_is_not_modified(self):
        d = Path(tempfile.mkdtemp())
        src = d / "seen.json"
        src.write_text(json.dumps(STATE), encoding="utf-8")
        before = src.read_bytes()
        export(str(src), str(d / "out.csv"))
        self.assertEqual(src.read_bytes(), before)

    def test_missing_state_exits_2(self):
        proc = subprocess.run(
            [sys.executable, str(REPO / "tools" / "export_seen_jobs.py"),
             "--state", "/nonexistent/seen.json", "--out", str(Path(tempfile.mkdtemp()) / "o.csv")],
            capture_output=True, text=True)
        self.assertEqual(proc.returncode, 2)


if __name__ == "__main__":
    unittest.main()

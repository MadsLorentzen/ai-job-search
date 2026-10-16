"""tools/parse_job_alerts.py: job-alert emails -> job records (formats copied from real alerts, links shortened)."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

import parse_job_alerts as pja  # noqa: E402

LINKEDIN_DIGEST = {
    "id": "m1", "date": "2026-10-14T18:00:32Z", "sender": "jobalerts-noreply@linkedin.com",
    "subject": "Ryanair Workforce Planning & Business Analyst and 12 other jobs you may be interested in",
    "plaintextBody": (
        "Your job alert for Data Analyst in Ireland\n13 new jobs match your preferences.\n\n"
        "Workforce Planning & Business Analyst\nRyanair - Europe's Favourite Airline\nSwords\n\n3 company alumni\n"
        "View job: https://www.linkedin.com/comm/jobs/view/4474282690/?trackingId=abc&trk=x\n\n"
        "---------------------------------------------------------\n\n"
        "Finance Data Analyst\nJobgether\nIreland\nFast growing\nApply with resume & profile\n"
        "View job: https://www.linkedin.com/comm/jobs/view/4478407917/?trackingId=def\n\n"
        "---------------------------------------------------------\n\n"
        "See all jobs on LinkedIn: https://www.linkedin.com/comm/jobs/search-results/?keywords=Data+Analyst\n"),
}
INDEED_MATCH = {
    "id": "m2", "date": "2026-10-15T05:20:50Z", "sender": "donotreply@match.indeed.com",
    "subject": "Data Analyst @ Optum",
    "plaintextBody": ("Hi MOHIT,\n\nIt looks like your background could be a match for this Data Analyst role. "
                      "Please submit a quick application if you have any interest.\n\nData Analyst\nOptum\n"
                      "DUBLIN 8, County Dublin\nWork setting: Office\n\nView job: https://cts.indeed.com/v3/xyz\n"),
}
STATUS = {"id": "m3", "sender": "jobs-noreply@linkedin.com", "subject": "Mohit, your application was sent to Creditsafe Group",
          "plaintextBody": "View job: https://www.linkedin.com/comm/jobs/view/4431660480/"}


class Parse(unittest.TestCase):
    def test_linkedin_digest(self):
        jobs = pja.parse_message(LINKEDIN_DIGEST)
        self.assertEqual([(j["title"], j["company"], j["location"], j["linkedin_id"]) for j in jobs], [
            ("Workforce Planning & Business Analyst", "Ryanair - Europe's Favourite Airline", "Swords", "4474282690"),
            ("Finance Data Analyst", "Jobgether", "Ireland", "4478407917")])
        self.assertEqual(jobs[0]["url"], "https://www.linkedin.com/jobs/view/4474282690/")
        self.assertEqual(jobs[0]["alert"], "Data Analyst in Ireland")
        self.assertEqual(jobs[0]["email_date"], "2026-10-14")

    def test_indeed_match(self):
        [j] = pja.parse_message(INDEED_MATCH)
        self.assertEqual((j["title"], j["company"], j["location"], j["url"]), ("Data Analyst", "Optum", "DUBLIN 8, County Dublin", None))

    def test_status_emails_are_skipped(self):
        self.assertEqual(pja.parse_message(STATUS), [])

    def test_newsletters_are_skipped(self):
        self.assertEqual(pja.parse_message(dict(LINKEDIN_DIGEST, sender="newsletters-noreply@linkedin.com")), [])

    def test_dedupe_across_emails(self):
        jobs = pja.dedupe(pja.parse_message(LINKEDIN_DIGEST) + pja.parse_message(dict(LINKEDIN_DIGEST, id="m9")))
        self.assertEqual(len(jobs), 2)


class Cli(unittest.TestCase):
    def test_seen_state_skips_processed_messages(self):
        d = Path(tempfile.mkdtemp())
        (d / "t.json").write_text(json.dumps({"messages": [LINKEDIN_DIGEST, INDEED_MATCH, STATUS]}))
        run = lambda: json.loads(subprocess.run([sys.executable, str(REPO / "tools" / "parse_job_alerts.py"), str(d / "t.json"),
                                                 "--seen", str(d / "state.json")], capture_output=True, text=True).stdout)
        first = run()
        self.assertEqual((len(first["jobs"]), first["messages"]), (3, 3))
        second = run()
        self.assertEqual((len(second["jobs"]), second["skipped"]), (0, 3))


if __name__ == "__main__":
    unittest.main()

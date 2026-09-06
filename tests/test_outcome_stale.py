"""Guards for /outcome's stale sweep branch (Step 2c).

Pins the invariants for batch-resolving quiet applications:
- Step 0 documents `stale` / `sweep` and `stale <N>` / `sweep <N>`.
- Step 1.3 offers stale sweep when open rows exceed 60 days quiet.
- Step 2c defines the Stale Sweep Branch.
- Drafted applications are strictly excluded (never submitted).
- The default threshold is 60 days quiet.
- User confirmation (all, select, skip) is strictly required before writing.
- Status is resolved to canonical 'no_response' spelling.
"""

from datetime import date, datetime, timedelta
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
COMMAND = REPO / ".claude" / "commands" / "outcome.md"


def filter_stale_candidates(
    rows: list[dict[str, str]],
    today: date,
    threshold_days: int = 60,
) -> list[dict[str, str]]:
    """Reference implementation of /outcome Step 2c candidate filtering."""
    FINAL_STATUSES = {"hired", "rejected", "no_response", "offer_declined", "withdrawn"}
    candidates = []

    for row in rows:
        status = row.get("status", "").strip().lower()
        if status in FINAL_STATUSES or status == "drafted":
            continue

        # Parse row date or latest date in notes
        row_date_str = row.get("date", "").strip()
        try:
            row_date = datetime.strptime(row_date_str, "%Y-%m-%d").date()
        except ValueError:
            continue

        latest_date = row_date
        notes = row.get("notes", "")
        for match in re.finditer(r"\d{4}-\d{2}-\d{2}", notes):
            try:
                d = datetime.strptime(match.group(0), "%Y-%m-%d").date()
                if d > latest_date:
                    latest_date = d
            except ValueError:
                pass

        days_quiet = (today - latest_date).days
        if days_quiet >= threshold_days:
            cand = dict(row)
            cand["days_quiet"] = str(days_quiet)
            candidates.append(cand)

    return candidates


class OutcomeStaleBranchSpecTests(unittest.TestCase):
    def setUp(self):
        self.text = COMMAND.read_text(encoding="utf-8")

    def test_stale_argument_documented_in_step0(self):
        self.assertIn("`stale` or `sweep`", self.text)
        self.assertIn("`stale <N>` or `sweep <N>`", self.text)

    def test_step1_suggests_stale_sweep(self):
        self.assertIn("/outcome stale", self.text)
        self.assertIn("60+ days", self.text)

    def test_step2c_section_exists(self):
        self.assertIn("## Step 2c: Stale Sweep Branch", self.text)

    def test_drafted_rows_excluded_from_stale_candidates(self):
        match = re.search(r"## Step 2c: Stale Sweep Branch(.*?)(?=## Step 3:)", self.text, re.DOTALL)
        self.assertTrue(match, "Step 2c must exist")
        step2c = match.group(1)
        self.assertIn("neither final nor `drafted`", step2c)
        self.assertIn("never submitted and cannot receive a response", step2c)

    def test_default_60_day_threshold(self):
        match = re.search(r"## Step 2c: Stale Sweep Branch(.*?)(?=## Step 3:)", self.text, re.DOTALL)
        self.assertTrue(match)
        step2c = match.group(1)
        self.assertIn("60 days", step2c)

    def test_user_confirmation_options_required(self):
        match = re.search(r"## Step 2c: Stale Sweep Branch(.*?)(?=## Step 3:)", self.text, re.DOTALL)
        self.assertTrue(match)
        step2c = match.group(1)
        self.assertIn("`all`", step2c)
        self.assertIn("`select`", step2c)
        self.assertIn("`skip`", step2c)

    def test_resolves_to_canonical_no_response(self):
        match = re.search(r"## Step 2c: Stale Sweep Branch(.*?)(?=## Step 3:)", self.text, re.DOTALL)
        self.assertTrue(match)
        step2c = match.group(1)
        self.assertIn("no_response", step2c)

    def test_candidate_filter_logic(self):
        today = date(2026, 9, 6)
        rows = [
            {"company": "Fresh", "role": "Dev", "status": "applied", "date": "2026-08-25", "notes": ""},
            {"company": "DraftOnly", "role": "Dev", "status": "drafted", "date": "2026-05-01", "notes": ""},
            {"company": "OldApplied", "role": "Dev", "status": "applied", "date": "2026-06-01", "notes": ""},
            {"company": "OldFollowedUp", "role": "Dev", "status": "applied", "date": "2026-05-01", "notes": "followed up 2026-08-20"},
            {"company": "OldWithdrawn", "role": "Dev", "status": "withdrawn", "date": "2026-05-01", "notes": ""},
        ]
        candidates = filter_stale_candidates(rows, today, threshold_days=60)
        companies = [c["company"] for c in candidates]
        self.assertEqual(companies, ["OldApplied"], f"Only OldApplied should qualify, got: {companies}")


if __name__ == "__main__":
    unittest.main()

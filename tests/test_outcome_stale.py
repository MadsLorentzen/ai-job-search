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

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
COMMAND = REPO / ".claude" / "commands" / "outcome.md"


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


if __name__ == "__main__":
    unittest.main()

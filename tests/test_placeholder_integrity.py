"""Guards for CI's placeholder-integrity sentinels.

The job exists to catch personal data committed to the upstream template.
That only works when each sentinel sits IN the data /setup replaces: the
CV's old sentinel was `[YOUR_NAME]`, whose only occurrences were a header
comment and the hyperref pdftitle - /setup's documented edit ("replace
placeholder personal data with their actual name, contact info") touches
neither, so a fully personalized CV with a real name, address, phone and
email passed the check (review finding F28, 2026-08-19; proven
empirically). Same weakness for 01-candidate-profile.md's `<!-- SETUP`
comment sentinel.

These tests pin (a) that ci.yml checks data-located sentinels, (b) that
the sentinels exist in the pristine files, and (c) that simulating the
/setup edit destroys at least one checked sentinel per file - i.e. the
guard actually fires on the failure it exists to catch.
"""
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CI = REPO / ".github" / "workflows" / "ci.yml"
EXAMPLE_CV = REPO / "cv" / "main_example.tex"
PROFILE = REPO / ".claude" / "skills" / "job-application-assistant" / "01-candidate-profile.md"

# The literal sentinel strings (unescaped) that ci.yml's grep patterns match.
CV_SENTINELS = ["\\name{[First]}{[Last]}", "\\email{[your.email@example.com]}"]
PROFILE_SENTINEL = "[YOUR_EMAIL]"


def personalize_cv(text: str) -> str:
    """Apply /setup Step 3.7's documented edit: replace placeholder personal
    data with a real name and contact info. Header comments and hyperref
    metadata are not personal data, so they are deliberately left alone -
    that is exactly why a comment-located sentinel guards nothing."""
    return (
        text.replace("\\name{[First]}{[Last]}", "\\name{Jane}{Doe}")
        .replace("[Your Address, City, Country]", "Some Street 1, Aarhus, Denmark")
        .replace("[+XX XXXXXXXXXX]", "+45 12345678")
        .replace("[your.email@example.com]", "jane.doe@example.org")
    )


class TestCvSentinelsAreDataLocated(unittest.TestCase):
    def setUp(self):
        self.ci = CI.read_text(encoding="utf-8")
        self.cv = EXAMPLE_CV.read_text(encoding="utf-8")

    def test_ci_checks_the_name_and_email_data_lines(self):
        self.assertIn(
            "check cv/main_example.tex '\\\\name{\\[First\\]}{\\[Last\\]}'",
            self.ci,
            "ci.yml must assert the sentinel inside the \\name{} data line",
        )
        self.assertIn(
            "check cv/main_example.tex '\\\\email{\\[your\\.email@example\\.com\\]}'",
            self.ci,
            "ci.yml must assert the sentinel inside the \\email{} data line",
        )

    def test_pristine_cv_carries_both_sentinels(self):
        for sentinel in CV_SENTINELS:
            self.assertIn(sentinel, self.cv)

    def test_setup_edit_destroys_the_sentinels(self):
        personalized = personalize_cv(self.cv)
        self.assertNotEqual(personalized, self.cv, "the simulated /setup edit must change the file")
        surviving = [s for s in CV_SENTINELS if s in personalized]
        self.assertEqual(
            surviving,
            [],
            "a sentinel survived the documented /setup personalization - the "
            f"guard would pass on committed personal data: {surviving}",
        )


class TestProfileSentinelIsDataLocated(unittest.TestCase):
    def test_ci_checks_a_data_placeholder_not_the_header_comment(self):
        ci = CI.read_text(encoding="utf-8")
        self.assertIn(
            "check .claude/skills/job-application-assistant/01-candidate-profile.md '\\[YOUR_EMAIL\\]'",
            ci,
            "01's sentinel must sit in the Identity data /setup fills, not in "
            "a header comment the model may leave untouched",
        )

    def test_pristine_profile_carries_the_sentinel(self):
        self.assertIn(PROFILE_SENTINEL, PROFILE.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

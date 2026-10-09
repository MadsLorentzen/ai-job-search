"""Table-driven tests for the deterministic remote-status classifier.

`classify_remote` is pure text classification with no I/O, so every case here
is a literal string. The regression rows pin a broken alternation in the
region-restriction regex: `europe|eu|european union\b` parses as
`(\beurope)|(eu)|(european union\b)`, and the unbounded `eu` branch matches
inside ordinary words ("nucleus", "queue"). Those postings were therefore
misfiled as EU-region-restricted.
"""

import unittest

from app.jobs.normalize import classify_remote
from app.state.models import RemoteStatus


class ClassifyRemoteTests(unittest.TestCase):
    def assert_classifies(self, text, expected):
        self.assertEqual(classify_remote(text), expected, msg=f"input: {text!r}")

    def test_matches_intended_region_restricted_phrasings(self):
        for text in (
            "Data Engineer | Remote (EU)",
            "Remote, Europe",
            "Remote - European Union",
            "Remote for European candidates",
        ):
            with self.subTest(text=text):
                self.assert_classifies(text, RemoteStatus.FULLY_REMOTE_REGION_RESTRICTED)

    def test_bare_eu_substring_inside_ordinary_words_is_not_a_region_restriction(self):
        for text in (
            "Remote, nucleus team",
            "Remote, queueing systems",
        ):
            with self.subTest(text=text):
                self.assert_classifies(text, RemoteStatus.FULLY_REMOTE_COUNTRY_RESTRICTED)

    def test_global_wins_over_region_restriction(self):
        self.assert_classifies(
            "Remote worldwide, EU",
            RemoteStatus.FULLY_REMOTE_GLOBAL,
        )

    def test_empty_text_is_unknown(self):
        self.assert_classifies("", RemoteStatus.UNKNOWN)


if __name__ == "__main__":
    unittest.main()

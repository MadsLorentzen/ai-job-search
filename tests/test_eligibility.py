"""Tests for location eligibility: can a candidate residing in Kenya take this role?

`evaluate_eligibility` deliberately does not trust `classify_remote`'s tier for
this decision. `classify_remote` checks global marketing phrases
("worldwide", "global", "anywhere") *before* it checks for a region
restriction, so a posting reading "Remote, work from anywhere in Europe"
classifies as fully-remote-global. Eligibility therefore re-reads the text and
gives an explicit region restriction precedence over a global phrase.

Silence is unverified, not permission: an ambiguous posting is `unknown`,
never `eligible`.
"""

import unittest

from app.jobs.eligibility import NOT_ELIGIBLE, evaluate_eligibility
from app.jobs.filters import filter_job
from app.jobs.normalize import normalize_job


def job_from(**raw):
    base = {
        "id": "probe",
        "title": "Data Engineer",
        "company": "Acme",
        "url": "https://example.test/job",
    }
    base.update(raw)
    return normalize_job(base)


class EvaluateEligibilityTests(unittest.TestCase):
    def assert_verdict(self, job, expected, *, note_contains=None):
        result = evaluate_eligibility(job, candidate_country="KE")
        self.assertEqual(
            result.verdict,
            expected,
            msg=f"verdict={result.verdict!r} reasons={result.reasons} "
                f"evidence={result.evidence_quotes} location={job.location!r}",
        )
        if note_contains:
            joined = " ".join(result.notes).casefold()
            self.assertIn(note_contains.casefold(), joined)
        return result

    # --- the regression: a Denmark-restricted role must not pass a KE gate ---

    def test_denmark_restricted_role_is_not_eligible(self):
        self.assert_verdict(job_from(country="DK", location="Remote"), "not_eligible")

    def test_kenya_named_alongside_another_region_is_still_eligible(self):
        # Policy 1: an employer who writes "Kenya" has made a positive
        # statement; a co-listed region does not undo it.
        for description in (
            "Remote (APAC), Kenya or South Africa.",
            "Remote, EMEA. Kenya candidates welcome.",
        ):
            with self.subTest(description=description):
                self.assert_verdict(job_from(description=description), "eligible")

    def test_non_kenyan_location_outranks_a_passing_kenya_mention(self):
        # Policy 1, second half: "Kenya market knowledge" is not an offer.
        self.assert_verdict(
            job_from(
                location="London, United Kingdom",
                description="Remote. Needs Kenya market knowledge.",
            ),
            "not_eligible",
        )

    def test_region_restriction_beats_a_global_marketing_phrase(self):
        # Each of these classified as fully_remote_global before the fix, because
        # classify_remote tests worldwide/global/anywhere ahead of any region.
        for description in (
            "Remote. Our offices are worldwide.",
            "Remote position at a global insurer.",
            "Remote, work from anywhere in Europe.",
            "Remote, offices worldwide. Must be located in Denmark.",
        ):
            with self.subTest(description=description):
                self.assert_verdict(
                    job_from(country="DK", description=description), "not_eligible"
                )

    def test_country_in_explicit_non_kenyan_region_is_not_eligible(self):
        # No `country` field at all: the gate previously ignored free text.
        self.assert_verdict(job_from(location="Remote (Denmark)"), "not_eligible")

    # --- Kenya-side roles ---

    def test_kenya_onsite_is_eligible(self):
        self.assert_verdict(
            job_from(location="Nairobi, Kenya", description="On-site data engineering role."), "eligible"
        )

    def test_kenya_hybrid_is_eligible(self):
        self.assert_verdict(
            job_from(location="Nairobi, Kenya", description="Hybrid role, three days on site."), "eligible"
        )

    def test_kenya_remote_is_eligible(self):
        self.assert_verdict(job_from(country="KE", location="Remote"), "eligible")

    def test_worldwide_remote_is_eligible_with_an_explanatory_note(self):
        self.assert_verdict(
            job_from(description="Fully remote worldwide"), "eligible", note_contains="worldwide"
        )

    def test_africa_scoped_remote_is_eligible_because_kenya_is_in_africa(self):
        self.assert_verdict(job_from(description="Remote, candidates anywhere in Africa."), "eligible")

    # --- ambiguity resolves to unknown, never to eligible ---

    def test_apac_only_is_unknown_not_eligible_and_not_eligible_only_if_kenya_named(self):
        # Kenya is not in APAC, but the vision requires this to stay `unknown`
        # rather than a confident rejection.
        self.assert_verdict(job_from(description="Remote (APAC)."), "unknown")

    def test_apac_with_kenya_explicitly_in_scope_is_eligible(self):
        self.assert_verdict(
            job_from(description="Remote (APAC), Kenya or South Africa."), "eligible"
        )

    def test_emea_only_without_explicit_kenya_mention_is_unknown(self):
        self.assert_verdict(job_from(description="Remote, EMEA region only."), "unknown")

    def test_no_location_information_is_unknown_and_never_eligible(self):
        for extra in ({}, {"description": "Great team, ship fast."}, {"location": ""}):
            with self.subTest(extra=extra):
                self.assert_verdict(job_from(**extra), "unknown")

    # --- reporting obligations ---

    def test_every_not_eligible_result_carries_a_human_readable_reason(self):
        for extra in (
            {"country": "DK", "location": "Remote"},
            {"location": "Remote (Denmark)"},
            {"description": "Remote (EU) only."},
            {"location": "London, United Kingdom"},
        ):
            with self.subTest(extra=extra):
                result = evaluate_eligibility(job_from(**extra), candidate_country="KE")
                self.assertEqual(result.verdict, "not_eligible")
                self.assertTrue(result.reasons, "a rejection must state a reason")
                for reason in result.reasons:
                    self.assertRegex(reason, r"[a-z]", msg="reason must be prose")

    def test_every_verdict_supports_evidence_quotes_when_text_is_available(self):
        result = evaluate_eligibility(
            job_from(country="DK", description="Remote, must be located in Denmark."),
            candidate_country="KE",
        )
        self.assertTrue(result.evidence_quotes, "a decision from posting text must cite it")


class FilterJobIntegrationTests(unittest.TestCase):
    def test_dk_restricted_job_is_rejected_by_filter_job(self):
        result = filter_job(job_from(country="DK", location="Remote"), allowed_country="KE")
        self.assertFalse(result.accepted)
        self.assertTrue(result.reasons)

    def test_dk_job_with_a_global_phrase_is_rejected_by_filter_job(self):
        # The exact bypass observed before the fix.
        result = filter_job(
            job_from(country="DK", description="Remote. Our offices are worldwide."),
            allowed_country="KE",
        )
        self.assertFalse(result.accepted, "a global marketing phrase must not defeat a country gate")

    def test_unknown_verdict_does_not_reject_but_is_reported_as_a_flag(self):
        result = filter_job(job_from(description="Great team, ship fast."), allowed_country="KE")
        self.assertTrue(result.accepted, "ambiguity is a flag, not a rejection")
        self.assertTrue(result.flags, "ambiguity must still be surfaced")

    def test_missing_salary_alone_never_rejects(self):
        result = filter_job(job_from(description="Fully remote worldwide"), minimum_salary=100000)
        self.assertTrue(result.accepted, "an unstated salary must not reject a job")
        self.assertTrue(result.flags, "an unstated salary should still be flagged")

    def test_explicitly_low_salary_below_the_minimum_is_flagged_not_rejected(self):
        result = filter_job(
            job_from(description="Fully remote worldwide", salary_min=1000), minimum_salary=100000
        )
        self.assertTrue(result.accepted, "compensation is a preference, not a hard gate")

    def test_kenya_hybrid_survives_a_plain_location_gate(self):
        result = filter_job(
            job_from(location="Nairobi, Kenya", description="Hybrid role, three days on site."),
            allowed_country="KE",
        )
        self.assertTrue(result.accepted, f"rejected: {result.reasons}")

    def test_unknown_work_arrangement_flags_rather_than_rejects_when_remote_is_wanted(self):
        # Policy 4: ambiguity is surfaced, never a silent rejection.
        result = filter_job(
            job_from(description="Great team, ship fast."), require_remote=True
        )
        self.assertTrue(result.accepted, f"rejected: {result.reasons}")
        self.assertTrue(
            any("work arrangement is unknown" in flag for flag in result.flags),
            f"expected an unknown-arrangement flag, got {result.flags}",
        )

    def test_verdict_default_country_is_kenya(self):
        job = job_from(country="DK", location="Remote")
        self.assertEqual(evaluate_eligibility(job).verdict, NOT_ELIGIBLE)


if __name__ == "__main__":
    unittest.main()

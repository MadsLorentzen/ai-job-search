"""Tests for salary_lookup.py — format_entry, match_score, and search_company."""

import unittest

from salary_lookup import format_entry, match_score, search_company


# ---------------------------------------------------------------------------
# format_entry tests (from #75 / #98)
# ---------------------------------------------------------------------------

class FormatEntryTests(unittest.TestCase):
    def test_zero_count_is_displayed_as_zero(self):
        entry = {
            "company": "Example Corp",
            "city": "",
            "categories": {
                "public_data": {
                    "count": 0,
                    "index": 100.0,
                },
            },
        }

        rendered = format_entry(entry, {"index_baseline": 100, "index_label": "Index"})

        self.assertRegex(rendered, r"Public Data\s+0\s+100\.0")

    def test_text_index_does_not_crash(self):
        entry = {
            "company": "Example Corp",
            "city": "",
            "categories": {
                "sample": {
                    "count": 3,
                    "index": "private",
                },
            },
        }

        rendered = format_entry(entry, {"index_baseline": 100, "index_label": "Index"})

        self.assertIn("private", rendered)

    def test_format_entry_with_zero_baseline(self):
        entry = {
            "company": "Example Corp",
            "city": "",
            "categories": {
                "it": {
                    "count": None,
                    "index": 45000.0,
                },
            },
        }
        rendered = format_entry(entry, {"index_baseline": 0, "index_label": "Salary"})
        self.assertIn("45000.0", rendered)
        self.assertNotIn("%", rendered)

    def test_format_entry_with_custom_baseline(self):
        entry = {
            "company": "Example Corp",
            "city": "",
            "categories": {
                "it": {
                    "count": None,
                    "index": 45000.0,
                },
            },
        }
        rendered = format_entry(entry, {"index_baseline": 40000, "index_label": "Salary"})
        self.assertIn("45000.0", rendered)
        self.assertIn("+12.5%", rendered)


# ---------------------------------------------------------------------------
# match_score tests (from #106)
# ---------------------------------------------------------------------------

class TestMatchScoreExactMatch(unittest.TestCase):
    def test_exact_match_returns_100(self):
        self.assertEqual(match_score("Novo Nordisk", "Novo Nordisk"), 100)

    def test_exact_match_case_insensitive(self):
        self.assertEqual(match_score("NOVO NORDISK", "Novo Nordisk"), 100)

    def test_exact_match_after_suffix_stripping(self):
        self.assertEqual(match_score("Mærsk", "Mærsk A/S"), 100)


class TestMatchScoreSubstring(unittest.TestCase):
    def test_query_contained_in_entry_gives_high_score(self):
        score = match_score("Carlsberg", "Carlsberg Danmark A/S")
        self.assertGreaterEqual(score, 80)

    def test_entry_contained_in_query_gives_high_score(self):
        score = match_score("Carlsberg Danmark", "Carlsberg")
        self.assertGreaterEqual(score, 80)


class TestMatchScoreShortQuery(unittest.TestCase):
    def test_short_query_no_word_overlap_returns_zero(self):
        score = match_score("ab", "Something Unrelated Company")
        self.assertEqual(score, 0)

    def test_short_query_with_word_overlap_scores(self):
        score = match_score("IBM", "IBM Corporation")
        self.assertGreater(score, 0)


class TestMatchScoreAnglicize(unittest.TestCase):
    def test_oe_variant_matches_o_with_slash(self):
        score = match_score("Maersk", "Mærsk A/S")
        self.assertGreater(score, 0)

    def test_aa_variant_matches_aa(self):
        self.assertEqual(match_score("Aarsleff", "Aarsleff"), 100)

    def test_danish_characters_roundtrip(self):
        score = match_score("Maersk", "Mærsk A/S")
        self.assertGreater(score, 0)


class TestMatchScoreNoOverlap(unittest.TestCase):
    def test_completely_unrelated_names_return_zero(self):
        self.assertEqual(match_score("Apple", "Vestas Wind Systems"), 0)

    def test_empty_query_returns_zero(self):
        self.assertEqual(match_score("", "Novo Nordisk"), 0)

    def test_empty_entry_returns_zero(self):
        self.assertEqual(match_score("Novo Nordisk", ""), 0)


# ---------------------------------------------------------------------------
# search_company tests (from #75 / #98 and #106)
# ---------------------------------------------------------------------------

def _make_data(*entries):
    return {"companies": list(entries)}


def _entry(company, city=""):
    return {"company": company, "city": city}


class SearchCompanyTests(unittest.TestCase):
    def test_search_company_with_none_city(self):
        data = {
            "companies": [
                {
                    "company": "Acme",
                    "city": None,
                }
            ]
        }
        results = search_company(data, "Acme", city="Aarhus")
        self.assertEqual(results, [])


class TestSearchCompanyBasicMatch(unittest.TestCase):
    def test_exact_name_returns_match(self):
        data = _make_data(_entry("Novo Nordisk", "Bagsværd"))
        results = search_company(data, "Novo Nordisk")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["company"], "Novo Nordisk")

    def test_no_match_returns_empty_list(self):
        data = _make_data(_entry("Vestas Wind Systems", "Aarhus"))
        results = search_company(data, "Apple")
        self.assertEqual(results, [])

    def test_multiple_candidates_all_returned(self):
        data = _make_data(
            _entry("Carlsberg A/S", "Copenhagen"),
            _entry("Carlsberg Danmark", "Fredericia"),
            _entry("Unrelated Corp", "Odense"),
        )
        results = search_company(data, "Carlsberg")
        companies = [r["company"] for r in results]
        self.assertIn("Carlsberg A/S", companies)
        self.assertIn("Carlsberg Danmark", companies)
        self.assertNotIn("Unrelated Corp", companies)


class TestSearchCompanyCityFilter(unittest.TestCase):
    def test_matching_city_is_included(self):
        data = _make_data(
            _entry("Novo Nordisk", "Bagsværd"),
            _entry("Novo Nordisk", "Aarhus"),
        )
        results = search_company(data, "Novo Nordisk", city="Aarhus")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["city"], "Aarhus")

    def test_non_matching_city_is_excluded(self):
        data = _make_data(_entry("Novo Nordisk", "Bagsværd"))
        results = search_company(data, "Novo Nordisk", city="Odense")
        self.assertEqual(results, [])

    def test_no_city_filter_returns_all_cities(self):
        data = _make_data(
            _entry("Novo Nordisk", "Bagsværd"),
            _entry("Novo Nordisk", "Aarhus"),
        )
        results = search_company(data, "Novo Nordisk")
        self.assertEqual(len(results), 2)

    def test_city_filter_case_insensitive(self):
        data = _make_data(_entry("Novo Nordisk", "København"))
        results = search_company(data, "Novo Nordisk", city="københavn")
        self.assertEqual(len(results), 1)

    def test_anglicized_city_matches_danish_city(self):
        data = _make_data(_entry("Novo Nordisk", "København"))
        results = search_company(data, "Novo Nordisk", city="kobenhavn")
        self.assertEqual(len(results), 1)


class TestSearchCompanyScoreThreshold(unittest.TestCase):
    def test_low_score_matches_excluded(self):
        data = _make_data(_entry("Novo Nordisk", "Bagsværd"))
        results = search_company(data, "xyz")
        self.assertEqual(results, [])

    def test_results_sorted_by_relevance_descending(self):
        data = _make_data(
            _entry("Novo Nordisk International", "Bagsværd"),
            _entry("Novo Nordisk", "Bagsværd"),
        )
        results = search_company(data, "Novo Nordisk")
        self.assertEqual(results[0]["company"], "Novo Nordisk")


if __name__ == "__main__":
    unittest.main()

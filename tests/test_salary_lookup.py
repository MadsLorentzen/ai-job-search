import unittest

from salary_lookup import format_entry, match_score, search_company


class MatchScoreTests(unittest.TestCase):
    def test_exact_match_scores_100(self):
        self.assertEqual(match_score("Acme", "Acme"), 100)

    def test_substring_match_scores_highly(self):
        score = match_score("Acme Consulting Services", "Acme Consulting")

        self.assertGreaterEqual(score, 80)

    def test_short_query_without_word_overlap_scores_zero(self):
        self.assertEqual(match_score("AI", "Fairview"), 0)

    def test_anglicized_variant_matches(self):
        self.assertGreater(match_score("Moller", "M\u00f8ller"), 0)

    def test_names_without_overlap_score_zero(self):
        self.assertEqual(match_score("Acme", "Globex"), 0)


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


class SearchCompanyTests(unittest.TestCase):
    def test_city_filter_includes_only_matching_city(self):
        copenhagen_entry = {"company": "Acme", "city": "Copenhagen"}
        aarhus_entry = {"company": "Acme", "city": "Aarhus"}
        data = {"companies": [copenhagen_entry, aarhus_entry]}

        results = search_company(data, "Acme", city="Copenhagen")

        self.assertEqual(results, [copenhagen_entry])

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


if __name__ == "__main__":
    unittest.main()

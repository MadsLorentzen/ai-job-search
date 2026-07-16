#!/usr/bin/env python3
"""Tests for tools/check_upstream_updates.py helper functions."""

import unittest
from tools.check_upstream_updates import (
    get_framework_version_from_text,
    parse_semver,
)


class TestGetFrameworkVersionFromText(unittest.TestCase):
    """Tests for extracting framework_version from YAML-like frontmatter."""

    def test_valid_frontmatter(self):
        text = "---\nframework_version: 1.0.0\n---\nContent here"
        self.assertEqual(get_framework_version_from_text(text), "1.0.0")

    def test_valid_frontmatter_quoted(self):
        text = '---\nframework_version: "1.2.3"\n---\nContent'
        self.assertEqual(get_framework_version_from_text(text), "1.2.3")

    def test_valid_frontmatter_single_quoted(self):
        text = "---\nframework_version: '2.0.1'\n---\nContent"
        self.assertEqual(get_framework_version_from_text(text), "2.0.1")

    def test_no_frontmatter(self):
        text = "Just some plain text without frontmatter"
        self.assertIsNone(get_framework_version_from_text(text))

    def test_empty_frontmatter(self):
        text = "---\n---\nContent"
        self.assertIsNone(get_framework_version_from_text(text))

    def test_frontmatter_without_version(self):
        text = "---\nother_key: value\n---\nContent"
        self.assertIsNone(get_framework_version_from_text(text))

    def test_unclosed_frontmatter(self):
        text = "---\nframework_version: 1.0.0\nContent without closing"
        self.assertIsNone(get_framework_version_from_text(text))

    def test_version_with_whitespace(self):
        text = "---\nframework_version:   1.5.0  \n---\nContent"
        self.assertEqual(get_framework_version_from_text(text), "1.5.0")

    def test_multiple_frontmatter_keys(self):
        text = "---\ntitle: My Skill\nframework_version: 3.1.0\ndescription: Test\n---\nBody"
        self.assertEqual(get_framework_version_from_text(text), "3.1.0")

    def test_empty_string(self):
        self.assertIsNone(get_framework_version_from_text(""))

    def test_only_opening_fence(self):
        text = "---\nframework_version: 1.0.0"
        self.assertIsNone(get_framework_version_from_text(text))


class TestParseSemver(unittest.TestCase):
    """Tests for semver parsing."""

    def test_standard_version(self):
        self.assertEqual(parse_semver("1.0.0"), (1, 0, 0))

    def test_version_with_v_prefix(self):
        self.assertEqual(parse_semver("v2.3.4"), (2, 3, 4))

    def test_large_numbers(self):
        self.assertEqual(parse_semver("10.200.3000"), (10, 200, 3000))

    def test_invalid_version_returns_zero(self):
        self.assertEqual(parse_semver("invalid"), (0, 0, 0))

    def test_empty_string(self):
        self.assertEqual(parse_semver(""), (0, 0, 0))

    def test_partial_version(self):
        self.assertEqual(parse_semver("1.2"), (0, 0, 0))

    def test_version_with_suffix(self):
        self.assertEqual(parse_semver("1.2.3-beta"), (1, 2, 3))

    def test_version_with_extra_text(self):
        self.assertEqual(parse_semver("version 1.2.3"), (0, 0, 0))

    def test_zero_version(self):
        self.assertEqual(parse_semver("0.0.0"), (0, 0, 0))

    def test_comparisonordering(self):
        self.assertGreater(parse_semver("1.0.1"), parse_semver("1.0.0"))
        self.assertGreater(parse_semver("2.0.0"), parse_semver("1.9.9"))
        self.assertGreater(parse_semver("1.1.0"), parse_semver("1.0.9"))


if __name__ == "__main__":
    unittest.main()

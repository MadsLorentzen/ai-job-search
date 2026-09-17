import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from app.services.text_utils import contains_phrase as _contains_skill
from app.services.text_utils import split_respecting_parens as _split_respecting_parens
from seed_resume_master import assign_tier, parse_skills


def test_split_respecting_parens_keeps_nested_comma_intact():
    text = "Cross-border/LATAM marketing (Brazil, broader Latin America) and localization, SEO"
    parts = [p.strip() for p in _split_respecting_parens(text)]
    assert "Cross-border/LATAM marketing (Brazil, broader Latin America) and localization" in parts
    assert "SEO" in parts
    # the bug this guards against: splitting inside the parens
    assert "Cross-border/LATAM marketing (Brazil" not in parts


def test_contains_skill_has_no_short_token_false_positives():
    assert _contains_skill("digital marketing automation", "Git") is False
    assert _contains_skill("Git and MySQL experience", "Git") is True
    assert _contains_skill("Google Ads and paid social", "Google Ads") is True


def test_assign_tier_uses_word_boundaries():
    tiers = {
        "strong": ["Digital/performance marketing (Google Ads, GA4, SEO, paid social)"],
        "moderate": ["SQL/data analysis"],
        "weak": [],
    }
    # "Git" is a substring of "Digital" -- must not tier as strong because of that.
    assert assign_tier("Git", tiers) == "moderate"
    assert assign_tier("Google Ads", tiers) == "strong"
    assert assign_tier("SQL", tiers) == "moderate"


def test_parse_skills_from_fixture_markdown():
    fixture = """# Candidate Profile

## Technical Skills

### Marketing & Growth
- Performance marketing: Google Ads, Google Analytics (GA4), paid social

### Domain Expertise
- Cross-border/LATAM marketing (Brazil, broader Latin America) and localization

## Publications
None currently.
"""
    skills = parse_skills(fixture)
    assert "Google Ads" in skills
    assert "Google Analytics" in skills
    assert "paid social" in skills
    assert "Cross-border/LATAM marketing (Brazil, broader Latin America) and localization" in skills
    # nothing should have leaked a dangling, unbalanced fragment
    assert not any(s.count("(") != s.count(")") for s in skills)

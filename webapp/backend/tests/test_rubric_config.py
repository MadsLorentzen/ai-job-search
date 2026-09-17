import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import rubric_config as rc


def test_location_pass_atlanta_metro():
    passed, note = rc.location_pass("Atlanta, GA", "Great hybrid role")
    assert passed is True
    assert "metro" in note.lower()


def test_location_pass_remote():
    passed, _ = rc.location_pass("Denver, CO", "This role is fully remote")
    assert passed is True


def test_location_pass_relocation_required_fails():
    passed, note = rc.location_pass("Denver, CO", "Relocation required for this role")
    assert passed is False
    assert "relocation" in note.lower()


def test_location_pass_does_not_false_positive_on_negated_remote():
    # "no remote option" contains "remote" as a plain substring but means the
    # opposite -- this is the bug: naive matching returned True here.
    passed, _ = rc.location_pass("Denver, CO", "On-site only, no remote option")
    assert passed is False


def test_location_pass_unrecognized_city_fails():
    passed, _ = rc.location_pass("Denver, CO", "On-site role in our downtown office")
    assert passed is False


def test_location_pass_rejects_international_remote_without_us_qualifier():
    # Real bug: a posting whose location field literally said "Chennai,
    # Tamil Nadu, India" passed location_pass because its description also
    # said "remote" with no country qualifier -- REMOTE_PHRASES alone can't
    # tell an India-remote role from a US-remote one.
    passed, note = rc.location_pass("Chennai, Tamil Nadu, India", "This is a remote position.")
    assert passed is False
    assert "india" in note.lower()


def test_location_pass_allows_explicit_us_remote_even_with_country_mentioned():
    # A US-remote role whose description happens to mention another country
    # (e.g. serving international clients) should still pass.
    passed, _ = rc.location_pass("Remote (US)", "Remote (US) role serving clients in Canada and India.")
    assert passed is True


def test_location_pass_rejects_city_name_without_country_word():
    # Real bug: a posting with location "Greater Kolkata Area" (Kolkata,
    # India) passed location_pass -- the location field names a city/region,
    # not the literal country name, so it matched none of
    # NON_US_LOCATION_SIGNALS' country names even though the job is
    # obviously India-based.
    passed, note = rc.location_pass("Greater Kolkata Area", "Location: Remote. Job Type: Full-time.")
    assert passed is False
    assert "kolkata" in note.lower()


def test_location_pass_rejects_non_us_linkedin_subdomain_even_with_generic_location():
    # A location string with no recognizable city or country name at all
    # (so the text-based signal has nothing to match) should still be
    # caught via the posting's own LinkedIn country-subdomain URL.
    passed, note = rc.location_pass(
        "Remote",
        "This is a remote position.",
        url="https://in.linkedin.com/jobs/view/social-media-manager-4465042154",
    )
    assert passed is False
    assert "subdomain" in note.lower()


def test_location_pass_allows_www_linkedin_subdomain():
    passed, _ = rc.location_pass(
        "Remote",
        "This is a remote position.",
        url="https://www.linkedin.com/jobs/view/marketing-manager-4462819997",
    )
    assert passed is True


def test_clean_keyword_fragments_keeps_nested_parens_intact():
    # the bug: naive comma-splitting broke "(Brazil, wider)" into two dangling
    # fragments instead of keeping the short phrase whole.
    fragments = rc._clean_keyword_fragments("LATAM (Brazil, wider), SEO")
    assert "LATAM (Brazil, wider)" in fragments
    assert "SEO" in fragments
    assert not any(f.strip() in ("Brazil", "wider)") for f in fragments)


def test_clean_keyword_fragments_drops_prose_length_clauses():
    # a 10-word clause will never match a job posting verbatim -- it should
    # be dropped rather than silently wasting a scoring slot.
    fragments = rc._clean_keyword_fragments(
        "building/fixing something from a rough state (campaigns, systems, teams), SEO"
    )
    assert "SEO" in fragments
    assert not any("building/fixing" in f for f in fragments)


def test_clean_keyword_fragments_strips_dash_qualifier_clause():
    fragments = rc._clean_keyword_fragments("website/CRO - open to hands-on or strategic scope")
    assert "website/CRO" in fragments
    assert not any("hands-on" in f for f in fragments)


def test_career_alignment_keywords_has_no_overlong_fragments():
    keywords = rc.load_career_alignment_keywords()
    assert all(len(k.split()) <= rc.MAX_KEYWORD_WORDS for k in keywords)
    assert "ABM" in keywords


def test_experience_title_tiers_loaded():
    tiers = rc.load_experience_title_tiers()
    assert "strong" in tiers and "moderate" in tiers and "entry-level" in tiers
    assert any("Digital Marketing Manager" in t for t in tiers["strong"])

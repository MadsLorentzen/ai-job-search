import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import models
from app.database import Base
from app.services import credentials, search_discovery
from app.services.search_discovery import (
    build_search_query,
    discover_via_search_api,
    extract_company_from_search_title,
    fetch_full_description,
    is_aggregator_url,
    is_individual_job_url,
    parse_search_results,
)


@pytest.fixture()
def db():
    # Isolated in-memory DB per test -- must never touch the real app.db.
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def test_build_search_query_with_site_filter():
    assert build_search_query("marketing manager", "Atlanta, GA", "site:indeed.com") == (
        'site:indeed.com "marketing manager" Atlanta, GA'
    )


def test_build_search_query_without_site_filter_omits_it():
    # the "unconventional" source has site_filter="" -- must not leave a
    # leading space or literal empty token in the query string.
    assert build_search_query("marketing manager", "Remote", "") == (
        '"marketing manager" Remote'
    )


def test_is_aggregator_url_matches_bare_and_www_and_subdomain():
    assert is_aggregator_url("https://www.indeed.com/viewjob?jk=abc") is True
    assert is_aggregator_url("https://indeed.com/viewjob?jk=abc") is True
    assert is_aggregator_url("https://jobs.linkedin.com/view/123") is True


def test_is_aggregator_url_does_not_match_unrelated_domain():
    assert is_aggregator_url("https://jobs.acmecorp.com/careers/123") is False


def test_is_aggregator_url_does_not_false_positive_on_substring_domain():
    # the bug this guards against: naive `"indeed.com" in domain` would
    # wrongly match a domain like "notindeed.com" or "indeed.company.com".
    assert is_aggregator_url("https://notindeed.com/jobs/123") is False
    assert is_aggregator_url("https://indeed.com.evil-mirror.net/jobs/123") is False


def test_is_individual_job_url_indeed_viewjob_passes():
    assert is_individual_job_url("https://www.indeed.com/viewjob?jk=6c98c526aebe5a5d", "indeed-search") is True


def test_is_individual_job_url_indeed_category_page_rejected():
    # confirmed live: Indeed's site:-restricted search results mix individual
    # postings with category/listing pages like this one -- these must not
    # be ingested as if they were a single job.
    assert is_individual_job_url("https://www.indeed.com/q-marketing-manager-l-atlanta,-ga-jobs.html", "indeed-search") is False


def test_is_individual_job_url_glassdoor_job_listing_passes():
    url = "https://www.glassdoor.com/job-listing/marketing-manager-koi-healthcare-services-JV_IC1155583_KO0,17_KE18,41.htm?jl=1008090736186"
    assert is_individual_job_url(url, "glassdoor-search") is True


def test_is_individual_job_url_glassdoor_search_page_rejected():
    url = "https://www.glassdoor.com/Job/atlanta-marketing-manager-jobs-SRCH_IL.0,7_IC1155583_KO8,25.htm"
    assert is_individual_job_url(url, "glassdoor-search") is False


def test_is_individual_job_url_unconventional_rejects_aggregators_only():
    assert is_individual_job_url("https://jobs.acmecorp.com/careers/123", "unconventional-search") is True
    assert is_individual_job_url("https://www.linkedin.com/jobs/view/123", "unconventional-search") is False


def test_extract_company_from_search_title_glassdoor_with_employer():
    title = "Voltline Atlanta hiring Marketing Manager Job in Atlanta, GA | Glassdoor"
    assert extract_company_from_search_title(title, "glassdoor-search") == "Voltline Atlanta"


def test_extract_company_from_search_title_glassdoor_without_employer():
    title = "Marketing Manager Job in Atlanta, GA | Glassdoor"
    assert extract_company_from_search_title(title, "glassdoor-search") == ""


def test_extract_company_from_search_title_indeed_never_guesses():
    # Indeed's search-result titles don't reliably carry a company name --
    # confirmed live. Guessing one would be fabrication, so this must always
    # return "" for indeed-search regardless of title shape.
    title = "Marketing Manager - Atlanta, GA 30326 - Indeed.com"
    assert extract_company_from_search_title(title, "indeed-search") == ""


def test_parse_search_results_extracts_title_url_snippet():
    raw = {
        "web": {
            "results": [
                {"title": "Marketing Manager Job in Atlanta, GA | Glassdoor", "url": "https://www.glassdoor.com/job-listing/x", "description": "Salary $64K-$77K."},
            ]
        }
    }
    parsed = parse_search_results(raw)
    assert parsed == [
        {"title": "Marketing Manager Job in Atlanta, GA | Glassdoor", "url": "https://www.glassdoor.com/job-listing/x", "snippet": "Salary $64K-$77K."}
    ]


def test_parse_search_results_skips_results_without_url():
    raw = {"web": {"results": [{"title": "no url here", "description": "x"}]}}
    assert parse_search_results(raw) == []


def test_parse_search_results_missing_web_key_returns_empty_list():
    # a malformed/changed API response shape must degrade to "no results",
    # not raise -- discovery shouldn't crash because a third-party API
    # changed its schema.
    assert parse_search_results({}) == []


def test_parse_search_results_missing_results_key_returns_empty_list():
    assert parse_search_results({"web": {}}) == []


def test_fetch_full_description_falls_back_to_empty_on_short_body(monkeypatch):
    # simulates the confirmed-live behavior: Indeed's "Authenticating..."
    # block page returns HTTP 200 with a tiny body, not an exception -- must
    # still be treated as a failed fetch, not stored as a real description.
    import app.services.search_discovery as sd

    monkeypatch.setattr(sd, "fetch_page_text", lambda url: ("Authenticating...", "Authenticating... Redirecting to login."))
    assert fetch_full_description("https://www.indeed.com/viewjob?jk=abc") == ""


def test_fetch_full_description_falls_back_to_empty_on_exception(monkeypatch):
    import app.services.search_discovery as sd

    def raise_http_error(url):
        raise OSError("blocked")

    monkeypatch.setattr(sd, "fetch_page_text", raise_http_error)
    assert fetch_full_description("https://www.glassdoor.com/job-listing/x") == ""


def test_fetch_full_description_returns_text_on_success(monkeypatch):
    import app.services.search_discovery as sd

    long_text = "Full job description text. " * 20
    monkeypatch.setattr(sd, "fetch_page_text", lambda url: ("Title", long_text))
    assert fetch_full_description("https://jobs.acmecorp.com/careers/123") == long_text


def test_discover_via_search_api_skips_without_key(db, monkeypatch):
    monkeypatch.setattr(credentials, "get_credential", lambda key, user_id: None)
    stats = discover_via_search_api(db, user_id=1)
    assert stats["new_jobs"] == 0
    assert stats["portals_run"] == 0
    assert "No Brave Search API key configured" in stats["errors"][0]


def test_discover_via_search_api_no_sources_enabled_by_default(db, monkeypatch):
    # every SOURCES entry ships enabled=False -- with a key configured but
    # nothing turned on, discovery should be a safe no-op, not an error.
    monkeypatch.setattr(credentials, "get_credential", lambda key, user_id: "fake-key")
    stats = discover_via_search_api(db, user_id=1)
    assert stats["portals_run"] == 0
    assert stats["new_jobs"] == 0
    assert stats["errors"] == []


def test_discover_via_search_api_ingests_new_job_from_enabled_source(db, monkeypatch):
    monkeypatch.setattr(credentials, "get_credential", lambda key, user_id: "fake-key")
    monkeypatch.setitem(search_discovery.SOURCES["glassdoor-search"], "enabled", True)

    def fake_brave_search(query, api_key):
        return {
            "web": {
                "results": [
                    {
                        "title": "Voltline Atlanta hiring Marketing Manager Job in Atlanta, GA | Glassdoor",
                        "url": "https://www.glassdoor.com/job-listing/marketing-manager-voltline-atlanta-JV_IC1155583",
                        "description": "Salary range $64K to $77K.",
                    },
                    # a category page mixed into the same result set -- must be filtered out
                    {
                        "title": "1,421 marketing manager Jobs in Atlanta, GA | Glassdoor",
                        "url": "https://www.glassdoor.com/Job/atlanta-marketing-manager-jobs-SRCH_IL.0,7",
                        "description": "Browse all jobs.",
                    },
                ]
            }
        }

    monkeypatch.setattr(search_discovery, "_brave_search", fake_brave_search)
    monkeypatch.setattr(search_discovery, "fetch_full_description", lambda url: "")  # simulate blocked fetch

    stats = discover_via_search_api(db, user_id=1)

    jobs = db.query(models.JobPosting).all()
    assert len(jobs) == 1
    assert jobs[0].source_portal == "glassdoor-search"
    assert jobs[0].company == "Voltline Atlanta"
    assert jobs[0].raw_description == "Salary range $64K to $77K."  # fell back to snippet
    assert stats["new_jobs"] == 1
    assert stats["results_seen"] == 2 * len(search_discovery.SEARCH_QUERIES)

    search_discovery.SOURCES["glassdoor-search"]["enabled"] = False  # restore module-level default


def test_discover_via_search_api_dedupes_against_existing_url(db, monkeypatch):
    user = models.User(email="test@example.com", password_hash="x")
    db.add(user)
    db.commit()
    db.refresh(user)

    existing = models.JobPosting(
        user_id=user.id,
        source_portal="glassdoor-search",
        url="https://www.glassdoor.com/job-listing/marketing-manager-voltline-atlanta-JV_IC1155583",
        company="Voltline Atlanta", title="Marketing Manager", location="Atlanta, GA",
    )
    db.add(existing)
    db.commit()

    monkeypatch.setattr(credentials, "get_credential", lambda key, user_id: "fake-key")
    monkeypatch.setitem(search_discovery.SOURCES["glassdoor-search"], "enabled", True)

    def fake_brave_search(query, api_key):
        return {
            "web": {
                "results": [
                    {
                        "title": "Voltline Atlanta hiring Marketing Manager Job in Atlanta, GA | Glassdoor",
                        "url": existing.url,
                        "description": "Salary range $64K to $77K.",
                    }
                ]
            }
        }

    monkeypatch.setattr(search_discovery, "_brave_search", fake_brave_search)

    stats = discover_via_search_api(db, user_id=user.id)

    assert stats["new_jobs"] == 0
    assert db.query(models.JobPosting).count() == 1

    search_discovery.SOURCES["glassdoor-search"]["enabled"] = False  # restore module-level default

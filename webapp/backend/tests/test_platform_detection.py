import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.automation.base import detect_platform_from_url


def test_detects_greenhouse_by_domain():
    assert detect_platform_from_url("https://job-boards.greenhouse.io/acme/jobs/123") == "greenhouse"


def test_detects_lever_by_domain():
    assert detect_platform_from_url("https://jobs.lever.co/acme/456") == "lever"


def test_detects_workday_by_domain():
    assert detect_platform_from_url("https://acme.wd1.myworkdayjobs.com/External/job/123") == "workday"


def test_detects_icims_by_domain():
    assert detect_platform_from_url("https://careers-acme.icims.com/jobs/123/login") == "icims"


def test_detects_branded_greenhouse_via_gh_src_param():
    # the bug this guards against: stripe.com/careers/apply/... is actually
    # Greenhouse-hosted, given away only by the gh_src= tracking parameter,
    # not by the domain -- domain-only matching missed this entirely.
    url = "https://stripe.com/careers/apply/lifecycle-marketing-manager-capital/8082149?gh_src=73vnei"
    assert detect_platform_from_url(url) == "greenhouse"


def test_detects_branded_greenhouse_via_gh_jid_param():
    url = "https://careers.example.com/apply?gh_jid=4562311007"
    assert detect_platform_from_url(url) == "greenhouse"


def test_unrecognized_url_returns_default():
    assert detect_platform_from_url("https://careers.somecompany.com/apply/1") == "other"
    assert detect_platform_from_url("https://careers.somecompany.com/apply/1", default="linkedin") == "linkedin"


def test_none_url_returns_default():
    assert detect_platform_from_url(None) == "other"

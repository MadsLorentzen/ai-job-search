import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.manual_add import clean_job_title, guess_company_from_title, parse_workday_url_hints


def test_guess_company_from_title_with_pipe():
    assert guess_company_from_title("CRM Manager, Digital Customer Experience Job Details | CRH") == "CRH"


def test_guess_company_from_title_no_pipe():
    assert guess_company_from_title("Just a plain title") == ""


def test_guess_company_from_title_multiple_pipes_takes_last():
    assert guess_company_from_title("Careers | Job Details | Acme Corp") == "Acme Corp"


def test_clean_job_title_strips_pipe_and_noise_suffix():
    assert clean_job_title("CRM Manager, Digital Customer Experience Job Details | CRH") == (
        "CRM Manager, Digital Customer Experience"
    )


def test_clean_job_title_no_noise():
    assert clean_job_title("Marketing Manager | Acme Corp") == "Marketing Manager"


def test_clean_job_title_no_pipe_at_all():
    assert clean_job_title("Just a plain title") == "Just a plain title"


def test_parse_workday_url_hints_real_posting():
    url = (
        "https://carmax.wd1.myworkdayjobs.com/External/job/"
        "Corporate---Atlanta/Senior-Manager---Customer-Experience_JR-177773"
    )
    company, title, location = parse_workday_url_hints(url)
    assert company == "Carmax"
    # the bug this guards against: naively replacing "-{2,}" with " - " and
    # then blindly replacing every remaining "-" with " " destroyed the dash
    # it had just inserted, collapsing "Corporate - Atlanta" into "Corporate Atlanta".
    assert title == "Senior Manager - Customer Experience"
    assert location == "Corporate - Atlanta"


def test_parse_workday_url_hints_non_workday_url_returns_empty():
    assert parse_workday_url_hints("https://jobs.crh.com/default/job/foo/123") == ("", "", "")


def test_parse_workday_url_hints_no_job_path_still_gets_company():
    company, title, location = parse_workday_url_hints("https://acme.wd5.myworkdayjobs.com/External")
    assert company == "Acme"
    assert title == ""
    assert location == ""

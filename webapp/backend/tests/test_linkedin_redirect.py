import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.automation import linkedin
from app.services.automation.base import ApplyResult


def test_no_redirect_url_needs_manual():
    result = linkedin._handle_redirect(None, "r.pdf", "c.pdf", None, [], dry_run=True)
    assert result.status == "needs_manual"
    assert "no external redirect" in result.detail.lower()


def test_unrecognized_platform_needs_manual():
    result = linkedin._handle_redirect(
        "https://careers.somecompany.com/apply/123", "r.pdf", "c.pdf", None, [], dry_run=True
    )
    assert result.status == "needs_manual"
    assert "careers.somecompany.com" in result.detail


def test_greenhouse_redirect_hands_off_correctly(monkeypatch):
    called = {}

    def fake_apply(url, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run):
        called["args"] = (url, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run)
        return ApplyResult(status="dry_run_ready", detail="greenhouse handled it")

    monkeypatch.setattr(linkedin.greenhouse, "apply", fake_apply)
    result = linkedin._handle_redirect(
        "https://job-boards.greenhouse.io/somecompany/jobs/123", "r.pdf", "c.pdf", "PROFILE", ["QA"], dry_run=True
    )
    assert result.status == "dry_run_ready"
    assert called["args"] == (
        "https://job-boards.greenhouse.io/somecompany/jobs/123", "r.pdf", "c.pdf", "PROFILE", ["QA"], True
    )


def test_lever_redirect_hands_off_correctly(monkeypatch):
    called = {}

    def fake_apply(url, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run):
        called["hit"] = url
        return ApplyResult(status="applied", detail="ok")

    monkeypatch.setattr(linkedin.lever, "apply", fake_apply)
    result = linkedin._handle_redirect(
        "https://jobs.lever.co/somecompany/456", "r.pdf", "c.pdf", None, [], dry_run=False
    )
    assert called["hit"] == "https://jobs.lever.co/somecompany/456"
    assert result.status == "applied"


def test_workday_redirect_hands_off_correctly(monkeypatch):
    called = {}
    monkeypatch.setattr(
        linkedin.workday, "apply",
        lambda url, *a, **kw: called.setdefault("url", url) or ApplyResult(status="needs_manual", detail="x"),
    )
    linkedin._handle_redirect("https://company.myworkdayjobs.com/en-US/job/123", "r", "c", None, [], True)
    assert called["url"] == "https://company.myworkdayjobs.com/en-US/job/123"


def test_icims_redirect_hands_off_correctly(monkeypatch):
    called = {}
    monkeypatch.setattr(
        linkedin.icims, "apply",
        lambda url, *a, **kw: called.setdefault("url", url) or ApplyResult(status="failed", detail="x"),
    )
    linkedin._handle_redirect("https://careers-company.icims.com/jobs/123/apply", "r", "c", None, [], True)
    assert called["url"] == "https://careers-company.icims.com/jobs/123/apply"

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import models
from app.services.automation import dispatcher
from app.services.automation.base import ApplyResult


def make_job(platform):
    return models.JobPosting(
        id=1, source_portal="linkedin-search", url="https://example.com/job", company="Co",
        title="Role", location="Atlanta, GA", employment_type="Full-time", raw_description="",
        detected_platform=platform,
    )


def test_dispatch_routes_linkedin(monkeypatch):
    called = {}

    def fake_linkedin_apply(job, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run, user_id):
        called["args"] = (job, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run, user_id)
        return ApplyResult(status="dry_run_ready", detail="ok")

    monkeypatch.setattr(dispatcher.linkedin, "apply", fake_linkedin_apply)
    result = dispatcher.dispatch(make_job("linkedin"), "resume.pdf", "cover.pdf", None, [], dry_run=True, user_id=1)
    assert result.status == "dry_run_ready"
    assert called["args"][5] is True
    assert called["args"][6] == 1


def test_dispatch_routes_greenhouse(monkeypatch):
    called = {}

    def fake_apply(job, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run):
        called["hit"] = True
        return ApplyResult(status="applied", detail="ok")

    monkeypatch.setattr(dispatcher.greenhouse, "apply", fake_apply)
    result = dispatcher.dispatch(make_job("greenhouse"), "r.pdf", "c.pdf", None, [], dry_run=False, user_id=1)
    assert called["hit"] is True
    assert result.status == "applied"


def test_dispatch_routes_lever(monkeypatch):
    called = {}

    def fake_apply(job, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run):
        called["hit"] = True
        return ApplyResult(status="failed", detail="ok")

    monkeypatch.setattr(dispatcher.lever, "apply", fake_apply)
    result = dispatcher.dispatch(make_job("lever"), "r.pdf", "c.pdf", None, [], dry_run=False, user_id=1)
    assert called["hit"] is True
    assert result.status == "failed"


def test_dispatch_routes_workday(monkeypatch):
    called = {}

    def fake_apply(job, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run):
        called["hit"] = True
        return ApplyResult(status="needs_manual", detail="account creation required")

    monkeypatch.setattr(dispatcher.workday, "apply", fake_apply)
    result = dispatcher.dispatch(make_job("workday"), "r.pdf", "c.pdf", None, [], dry_run=True, user_id=1)
    assert called["hit"] is True
    assert result.status == "needs_manual"


def test_dispatch_routes_icims(monkeypatch):
    called = {}

    def fake_apply(job, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run):
        called["hit"] = True
        return ApplyResult(status="dry_run_ready", detail="ok")

    monkeypatch.setattr(dispatcher.icims, "apply", fake_apply)
    result = dispatcher.dispatch(make_job("icims"), "r.pdf", "c.pdf", None, [], dry_run=True, user_id=1)
    assert called["hit"] is True
    assert result.status == "dry_run_ready"


def test_dispatch_unknown_platform_needs_manual():
    result = dispatcher.dispatch(make_job("custom_ats"), "r.pdf", "c.pdf", None, [], dry_run=True, user_id=1)
    assert result.status == "needs_manual"
    assert "custom_ats" in result.detail.lower()

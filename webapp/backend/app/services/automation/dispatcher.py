from __future__ import annotations

from app import models
from app.services.automation import ashby, greenhouse, icims, indeed, lever, linkedin, workday
from app.services.automation.base import ApplyResult


def dispatch(
    job: models.JobPosting,
    resume_pdf_path: str,
    cover_letter_pdf_path: str,
    profile: models.CandidateProfile,
    qa_bank: list[models.QABankEntry],
    dry_run: bool,
    user_id: int,
) -> ApplyResult:
    if job.detected_platform == "linkedin":
        # LinkedIn's own connector may discover the posting actually redirects
        # externally (see its module docstring) and hand off internally to one
        # of the connectors below with the real destination URL -- it needs
        # the full argument set to be able to do that. user_id selects this
        # account's own LinkedIn credentials and saved browser session --
        # never another account's.
        return linkedin.apply(job, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run, user_id)
    if job.detected_platform == "greenhouse":
        return greenhouse.apply(job.url, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run)
    if job.detected_platform == "lever":
        return lever.apply(job.url, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run)
    if job.detected_platform == "workday":
        return workday.apply(job.url, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run)
    if job.detected_platform == "icims":
        return icims.apply(job.url, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run)
    if job.detected_platform == "ashby":
        return ashby.apply(job.url, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run)
    if job.detected_platform == "indeed":
        return indeed.apply(job.url, resume_pdf_path, cover_letter_pdf_path, profile, qa_bank, dry_run)
    return ApplyResult(
        status="needs_manual",
        detail=f"No automated connector for platform '{job.detected_platform}' -- apply manually.",
    )

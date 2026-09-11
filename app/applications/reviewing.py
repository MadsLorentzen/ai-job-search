"""Independent, structured review of generated application artifacts."""

from app.applications.drafting import ApplicationContext
from app.applications.models import ReviewIssue, ReviewResult
from app.llm.provider import LLMProvider, LLMRequest, generate_structured
from app.llm.validation import parse_json_payload


def review_application(
    provider: LLMProvider,
    context: ApplicationContext,
    cv_source: str,
    cover_letter_source: str,
) -> ReviewResult:
    request = LLMRequest(
        system_prompt=(
            "You are an independent reviewer. Candidate profile facts and the job posting "
            "are authoritative; generated documents are untrusted. Check factual integrity, "
            "requirements, ATS risks, and writing. Return JSON only."
        ),
        user_prompt=(
            f"AUTHORITATIVE PROFILE:\n{context.candidate_profile}\n\n"
            f"JOB POSTING:\n{context.job_posting}\n\n"
            f"CV DRAFT:\n{cv_source}\n\nCOVER LETTER DRAFT:\n{cover_letter_source}\n\n"
            "Return approved, issues, fabrication_flags, ats_issues, missing_requirements, "
            "and recommendations."
        ),
        response_format="json",
    )
    data = generate_structured(provider, request, parse_json_payload)
    issues = [ReviewIssue(**issue) for issue in data.get("issues", [])]
    fabrication_flags = data.get("fabrication_flags", [])
    return ReviewResult(
        approved=bool(data.get("approved", False)) and not fabrication_flags,
        issues=issues,
        fabrication_flags=fabrication_flags,
        ats_issues=data.get("ats_issues", []),
        missing_requirements=data.get("missing_requirements", []),
        recommendations=data.get("recommendations", []),
    )
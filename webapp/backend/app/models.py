from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, Float, ForeignKey, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


# --- Accounts ----------------------------------------------------------------


class User(Base):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True)
    password_hash: Mapped[str] = mapped_column(String)
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)


class Session(Base):
    """Server-side session -- the row IS the source of truth for validity, so
    logout/expiry is just deleting or aging out a row, no token-refresh logic
    to get wrong. `id` is the opaque token stored in the client's cookie.
    """

    __tablename__ = "session"

    id: Mapped[str] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"))
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)
    expires_at: Mapped[dt.datetime] = mapped_column()


# --- Resume master data -----------------------------------------------------


class CandidateProfile(Base):
    """One row per user: identity/contact/summary fields."""

    __tablename__ = "candidate_profile"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), unique=True)
    name: Mapped[str] = mapped_column(String)
    email: Mapped[str] = mapped_column(String)
    phone: Mapped[str] = mapped_column(String)
    location: Mapped[str] = mapped_column(String)
    commute_radius_miles: Mapped[int] = mapped_column(default=40)
    remote_ok: Mapped[bool] = mapped_column(Boolean, default=True)
    linkedin_url: Mapped[str] = mapped_column(String, default="")
    languages: Mapped[str] = mapped_column(String, default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    employment_type_preference: Mapped[str] = mapped_column(String, default="part-time")


class SkillBankEntry(Base):
    """A single skill/tool, tagged with a match-strength tier used by the evaluation engine."""

    __tablename__ = "skill_bank"
    __table_args__ = (UniqueConstraint("user_id", "skill", name="uq_skill_bank_user_skill"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"))
    skill: Mapped[str] = mapped_column(String)
    tier: Mapped[str] = mapped_column(String)  # "strong" | "moderate" | "weak"
    category: Mapped[str] = mapped_column(String, default="")  # e.g. "marketing", "programming"
    # Comma-separated alternate phrasings a JD might use for this same skill, e.g.
    # "marketing automation" -> "HubSpot,Marketo,lifecycle marketing". Only ever
    # substituted verbatim by the tailoring engine, never invented at runtime.
    synonyms: Mapped[str] = mapped_column(String, default="")


class ExperienceEntry(Base):
    __tablename__ = "experience_entry"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"))
    title: Mapped[str] = mapped_column(String)
    company: Mapped[str] = mapped_column(String)
    location: Mapped[str] = mapped_column(String, default="")
    start_date: Mapped[str] = mapped_column(String)  # free-text, e.g. "Oct 2024"
    end_date: Mapped[str] = mapped_column(String, default="Present")
    sort_order: Mapped[int] = mapped_column(default=0)

    bullets: Mapped[list["BulletLibraryEntry"]] = relationship(
        back_populates="experience", cascade="all, delete-orphan"
    )


class BulletLibraryEntry(Base):
    """A single, factual, pre-approved achievement statement for one role.

    The tailoring engine may only SELECT and REORDER these verbatim per job --
    never generate new bullet text. This is the anti-fabrication guardrail from
    the plan encoded structurally, not just as a runtime check.
    """

    __tablename__ = "bullet_library"

    id: Mapped[int] = mapped_column(primary_key=True)
    experience_id: Mapped[int] = mapped_column(ForeignKey("experience_entry.id"))
    text: Mapped[str] = mapped_column(Text)
    keywords: Mapped[str] = mapped_column(String, default="")  # comma-separated, for match scoring
    sort_order: Mapped[int] = mapped_column(default=0)

    experience: Mapped[ExperienceEntry] = relationship(back_populates="bullets")


class EducationEntry(Base):
    __tablename__ = "education_entry"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"))
    degree: Mapped[str] = mapped_column(String)
    institution: Mapped[str] = mapped_column(String)
    period: Mapped[str] = mapped_column(String, default="")
    key_topics: Mapped[str] = mapped_column(String, default="")
    sort_order: Mapped[int] = mapped_column(default=0)


# --- Job pipeline ------------------------------------------------------------


class JobPosting(Base):
    __tablename__ = "job_posting"
    # Composite, not a plain unique=True on url -- two different users can
    # legitimately both discover the same real posting (e.g. both searching
    # "marketing manager" find the same LinkedIn listing). A global unique
    # constraint would silently dedupe User B's import against User A's row.
    __table_args__ = (UniqueConstraint("user_id", "url", name="uq_job_posting_user_url"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"))
    source_portal: Mapped[str] = mapped_column(String)  # linkedin-search, jobindex-search, ...
    url: Mapped[str] = mapped_column(String)
    company: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    location: Mapped[str] = mapped_column(String, default="")
    employment_type: Mapped[str] = mapped_column(String, default="")
    raw_description: Mapped[str] = mapped_column(Text, default="")
    detected_platform: Mapped[str] = mapped_column(String, default="other")
    discovered_at: Mapped[dt.datetime] = mapped_column(default=_now)
    # Third-party employee-review rating (e.g. Indeed's 1-5 scale), supplied
    # at ingestion time by whatever discovered the posting -- the backend
    # itself has no access to fetch this (see evaluation_engine.py's
    # behavioral-score notes). Nullable: most sources won't have it.
    company_rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    company_rating_source: Mapped[str] = mapped_column(String, default="")

    evaluation: Mapped["Evaluation | None"] = relationship(
        back_populates="job", uselist=False, cascade="all, delete-orphan"
    )
    resume_variants: Mapped[list["ResumeVariant"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    cover_letter_variants: Mapped[list["CoverLetterVariant"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    application: Mapped["Application | None"] = relationship(
        back_populates="job", uselist=False, cascade="all, delete-orphan"
    )
    events: Mapped[list["ApplicationEvent"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )


class Evaluation(Base):
    __tablename__ = "evaluation"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("job_posting.id"), unique=True)

    technical_score: Mapped[float] = mapped_column(Float, default=0)
    experience_score: Mapped[float] = mapped_column(Float, default=0)
    experience_note: Mapped[str] = mapped_column(String, default="")
    behavioral_score: Mapped[float] = mapped_column(Float, default=50)  # neutral default, unassessed
    behavioral_assessed: Mapped[bool] = mapped_column(Boolean, default=False)
    behavioral_note: Mapped[str] = mapped_column(String, default="")
    location_pass: Mapped[bool] = mapped_column(Boolean, default=False)
    location_note: Mapped[str] = mapped_column(String, default="")
    career_alignment_score: Mapped[float] = mapped_column(Float, default=0)
    salary_index: Mapped[float | None] = mapped_column(Float, nullable=True)
    overall_score: Mapped[float] = mapped_column(Float, default=0)
    matched_keywords: Mapped[list] = mapped_column(JSON, default=list)
    gap_keywords: Mapped[list] = mapped_column(JSON, default=list)
    computed_at: Mapped[dt.datetime] = mapped_column(default=_now)

    job: Mapped[JobPosting] = relationship(back_populates="evaluation")


class ResumeVariant(Base):
    __tablename__ = "resume_variant"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("job_posting.id"))
    selected_bullet_ids: Mapped[list] = mapped_column(JSON, default=list)
    html_path: Mapped[str] = mapped_column(String, default="")
    pdf_path: Mapped[str] = mapped_column(String, default="")
    ats_validation: Mapped[dict] = mapped_column(JSON, default=dict)
    is_ready: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)

    job: Mapped[JobPosting] = relationship(back_populates="resume_variants")


class CoverLetterVariant(Base):
    __tablename__ = "cover_letter_variant"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("job_posting.id"))
    template_name: Mapped[str] = mapped_column(String, default="default")
    merge_fields: Mapped[dict] = mapped_column(JSON, default=dict)
    pdf_path: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)

    job: Mapped[JobPosting] = relationship(back_populates="cover_letter_variants")


class Application(Base):
    __tablename__ = "application"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("job_posting.id"), unique=True)
    resume_variant_id: Mapped[int | None] = mapped_column(ForeignKey("resume_variant.id"), nullable=True)
    cover_letter_variant_id: Mapped[int | None] = mapped_column(
        ForeignKey("cover_letter_variant.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(String, default="new")
    # new -> evaluated -> tailoring -> ready -> applying -> applied | failed | needs_manual | skipped
    method: Mapped[str] = mapped_column(String, default="")
    submitted_at: Mapped[dt.datetime | None] = mapped_column(nullable=True)
    error_detail: Mapped[str] = mapped_column(Text, default="")
    # Snapshots of the exact PDFs at the moment of a real submission.
    # resume_variant.pdf_path / cover_letter_variant.pdf_path get overwritten
    # in place on every re-tailor, so without this there is no way to
    # reconstruct after the fact what was actually sent to an employer --
    # confirmed as a real gap when a profile edit happened between a real
    # submission and a later inspection with no way to verify which content
    # went out first.
    submitted_resume_path: Mapped[str] = mapped_column(String, default="")
    submitted_cover_letter_path: Mapped[str] = mapped_column(String, default="")

    job: Mapped[JobPosting] = relationship(back_populates="application")


class ApplicationEvent(Base):
    """Audit log entry -- the accountability trail for the autonomous pipeline."""

    __tablename__ = "application_event"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("job_posting.id"))
    event_type: Mapped[str] = mapped_column(String)
    detail: Mapped[str] = mapped_column(Text, default="")
    timestamp: Mapped[dt.datetime] = mapped_column(default=_now)

    job: Mapped[JobPosting] = relationship(back_populates="events")


class QABankEntry(Base):
    """Screening-question -> answer pairs used to fill LinkedIn/ATS custom questions."""

    __tablename__ = "qa_bank"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"))
    question_pattern: Mapped[str] = mapped_column(String)  # substring or regex
    is_regex: Mapped[bool] = mapped_column(Boolean, default=False)
    answer: Mapped[str] = mapped_column(String)


class Settings(Base):
    """One row per user: tunable configuration, editable from the dashboard Settings page."""

    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), unique=True)
    fit_threshold: Mapped[float] = mapped_column(Float, default=70.0)
    scheduler_interval_minutes: Mapped[int] = mapped_column(default=60)
    scheduler_paused: Mapped[bool] = mapped_column(Boolean, default=True)  # starts paused; see Phase 4/5 notes
    dry_run: Mapped[bool] = mapped_column(Boolean, default=True)  # starts in dry-run; see Phase 4 notes

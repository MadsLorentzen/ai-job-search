from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, ConfigDict


class ORMBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Resume master -----------------------------------------------------------


class CandidateProfileSchema(ORMBase):
    id: int
    name: str
    email: str
    phone: str
    location: str
    commute_radius_miles: int
    remote_ok: bool
    linkedin_url: str
    languages: str
    summary: str
    employment_type_preference: str


class SkillBankEntrySchema(ORMBase):
    id: int
    skill: str
    tier: str
    category: str
    synonyms: str


class BulletLibraryEntrySchema(ORMBase):
    id: int
    experience_id: int
    text: str
    keywords: str
    sort_order: int


class ExperienceEntrySchema(ORMBase):
    id: int
    title: str
    company: str
    location: str
    start_date: str
    end_date: str
    sort_order: int
    bullets: list[BulletLibraryEntrySchema] = []


class SkillBankEntryUpdate(BaseModel):
    tier: str | None = None
    synonyms: str | None = None


class BulletLibraryEntryUpdate(BaseModel):
    text: str | None = None
    keywords: str | None = None
    sort_order: int | None = None


class EducationEntrySchema(ORMBase):
    id: int
    degree: str
    institution: str
    period: str
    key_topics: str
    sort_order: int


# --- Job pipeline --------------------------------------------------------------


class EvaluationSchema(ORMBase):
    id: int
    job_id: int
    technical_score: float
    experience_score: float
    experience_note: str
    behavioral_score: float
    behavioral_assessed: bool
    behavioral_note: str
    location_pass: bool
    location_note: str
    career_alignment_score: float
    salary_index: float | None
    overall_score: float
    matched_keywords: list
    gap_keywords: list
    computed_at: dt.datetime


class JobPostingSchema(ORMBase):
    id: int
    source_portal: str
    url: str
    company: str
    title: str
    location: str
    employment_type: str
    detected_platform: str
    discovered_at: dt.datetime
    company_rating: float | None = None
    company_rating_source: str = ""
    evaluation: EvaluationSchema | None = None


class ResumeVariantSchema(ORMBase):
    id: int
    job_id: int
    selected_bullet_ids: list
    html_path: str
    pdf_path: str
    ats_validation: dict
    is_ready: bool
    created_at: dt.datetime


class CoverLetterVariantSchema(ORMBase):
    id: int
    job_id: int
    template_name: str
    merge_fields: dict
    pdf_path: str
    created_at: dt.datetime


class TailorResultSchema(BaseModel):
    resume_variant: ResumeVariantSchema
    cover_letter_variant: CoverLetterVariantSchema
    application_status: str


class ApplicationSchema(ORMBase):
    id: int
    job_id: int
    resume_variant_id: int | None
    cover_letter_variant_id: int | None
    status: str
    method: str
    submitted_at: dt.datetime | None
    error_detail: str
    submitted_resume_path: str
    submitted_cover_letter_path: str
    job: JobPostingSchema | None = None


class ApplicationEventSchema(ORMBase):
    id: int
    job_id: int
    event_type: str
    detail: str
    timestamp: dt.datetime


class ApplicationEventWithJobSchema(BaseModel):
    id: int
    job_id: int
    event_type: str
    detail: str
    timestamp: dt.datetime
    company: str
    title: str


class QABankEntrySchema(ORMBase):
    id: int
    question_pattern: str
    is_regex: bool
    answer: str


class QABankEntryCreate(BaseModel):
    question_pattern: str
    is_regex: bool = False
    answer: str


class SettingsSchema(ORMBase):
    fit_threshold: float
    scheduler_interval_minutes: int
    scheduler_paused: bool
    dry_run: bool


class SettingsUpdate(BaseModel):
    fit_threshold: float | None = None
    scheduler_interval_minutes: int | None = None
    scheduler_paused: bool | None = None
    dry_run: bool | None = None


# --- Auth ---------------------------------------------------------------------


class UserSchema(ORMBase):
    id: int
    email: str
    created_at: dt.datetime


class SignupRequest(BaseModel):
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str

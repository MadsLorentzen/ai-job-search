"""Background autonomous pipeline: discover -> evaluate -> tailor -> apply,
with no per-application confirmation, per this project's explicit
fully-autonomous design decision. `Settings.scheduler_paused` is the only
intervention point (a global kill switch, not a per-job gate), and
`Settings.dry_run` is threaded through to every automation connector so
"autonomous" doesn't have to mean "submits for real" until that's
deliberately turned off.

A job is only ever tailored+applied-to once automatically: once it has an
Application row at all, the scheduler won't re-tailor it on a later cycle
(that would risk hammering a broken posting every interval). A job that
reached "ready" but hasn't been applied to yet (e.g. tailored manually, or
left at "ready" by a previous dry run) IS retried each cycle, since "ready"
specifically means "nothing has gone wrong yet, just hasn't been submitted."
"needs_manual"/"failed" jobs are left for the user to review, not retried
blindly.

Before retrying any "ready" application, the score/location gate is
re-checked -- confirmed live this matters: a job manually tailored during
testing (below fit_threshold, or failing location_pass) can sit at "ready"
indefinitely, and once dry_run/scheduler_paused are both off, an unguarded
retry loop will autonomously submit to it anyway, including postings that
violate the user's own stated deal-breakers (e.g. requires relocation). A
"ready" application that no longer clears the gate is marked "skipped"
(a terminal status, so it isn't reconsidered every cycle) with a clear
audit-log reason, rather than resubmitted blindly.
"""

from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session

from app import models
from app.database import SessionLocal
from app.services.pipeline import PipelineError, apply_to_job, evaluate_unevaluated_jobs, run_discovery, tailor_job

logger = logging.getLogger("scheduler")

_scheduler: BackgroundScheduler | None = None

# The tick cadence is shared by every account (not configurable per user --
# see the multi-user plan's explicit "keeps this simple" design decision).
# Each user's own Settings.scheduler_paused/dry_run/fit_threshold still fully
# govern what happens *within* their own slice of the cycle.
DEFAULT_INTERVAL_MINUTES = 60


def _is_paused(db: Session, user_id: int) -> bool:
    settings = db.query(models.Settings).filter_by(user_id=user_id).first()
    return not settings or settings.scheduler_paused


def run_cycle(db: Session) -> None:
    """One tick, run independently for every account. A failure -- or even
    a PipelineError -- scoped to one user's data must never stop the loop
    from reaching the next user.
    """
    for user in db.query(models.User).all():
        try:
            _run_cycle_for_user(db, user.id)
        except Exception:
            logger.exception("Scheduler cycle failed for user_id=%s", user.id)


def _run_cycle_for_user(db: Session, user_id: int) -> None:
    settings = db.query(models.Settings).filter_by(user_id=user_id).first()
    if not settings or settings.scheduler_paused:
        return

    stats = run_discovery(db, user_id)
    evaluated = evaluate_unevaluated_jobs(db, user_id)
    logger.info("user_id=%s discovery: %s new, %s evaluated", user_id, stats.get("new_jobs"), evaluated)

    fresh_candidates = (
        db.query(models.JobPosting)
        .filter(models.JobPosting.user_id == user_id)
        .join(models.Evaluation)
        .outerjoin(models.Application)
        .filter(models.Evaluation.overall_score >= settings.fit_threshold)
        .filter(models.Evaluation.location_pass.is_(True))
        .filter(models.Application.id.is_(None))
        .all()
    )
    for job in fresh_candidates:
        if _is_paused(db, user_id):
            return
        try:
            _, _, application = tailor_job(db, job.id, user_id)
            if application.status == "ready":
                apply_to_job(db, job.id, user_id)
        except PipelineError as e:
            db.add(models.ApplicationEvent(job_id=job.id, event_type="scheduler_error", detail=str(e)))
            db.commit()

    ready_applications = (
        db.query(models.Application)
        .join(models.JobPosting)
        .filter(models.JobPosting.user_id == user_id)
        .filter(models.Application.status == "ready")
        .all()
    )
    for application in ready_applications:
        if _is_paused(db, user_id):
            return
        job = db.get(models.JobPosting, application.job_id)
        evaluation = job.evaluation if job else None
        if not evaluation or evaluation.overall_score < settings.fit_threshold or not evaluation.location_pass:
            application.status = "skipped"
            application.error_detail = (
                "Skipped by scheduler safety gate: "
                f"score={evaluation.overall_score if evaluation else 'N/A'} "
                f"(threshold={settings.fit_threshold}), "
                f"location_pass={evaluation.location_pass if evaluation else 'N/A'}."
            )
            db.add(
                models.ApplicationEvent(
                    job_id=application.job_id,
                    event_type="scheduler_skip_stale_ready",
                    detail=application.error_detail,
                )
            )
            db.commit()
            continue
        try:
            apply_to_job(db, application.job_id, user_id)
        except PipelineError as e:
            db.add(models.ApplicationEvent(job_id=application.job_id, event_type="scheduler_error", detail=str(e)))
            db.commit()


def _run_cycle_with_own_session() -> None:
    db = SessionLocal()
    try:
        run_cycle(db)
    finally:
        db.close()


def start_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    _scheduler = BackgroundScheduler()
    _scheduler.add_job(
        _run_cycle_with_own_session, "interval", minutes=DEFAULT_INTERVAL_MINUTES, id="pipeline_cycle"
    )
    _scheduler.start()
    return _scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None


def get_scheduler() -> BackgroundScheduler | None:
    return _scheduler


def trigger_now() -> None:
    if _scheduler is not None:
        _scheduler.add_job(_run_cycle_with_own_session, id="pipeline_cycle_manual", replace_existing=True)
    else:
        _run_cycle_with_own_session()

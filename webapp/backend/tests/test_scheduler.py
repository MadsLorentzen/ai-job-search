import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import models
from app.database import Base
from app.services import scheduler
from app.services.pipeline import PipelineError


@pytest.fixture()
def db():
    # Isolated in-memory DB per test -- must never touch the real app.db.
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture()
def user(db):
    u = models.User(email="test@example.com", password_hash="x")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def make_job(db, user_id, score=80, location_pass=True):
    job = models.JobPosting(
        user_id=user_id, source_portal="linkedin-search", url=f"https://example.com/{id(object())}", company="Co",
        title="Role", location="Atlanta, GA", detected_platform="linkedin",
    )
    db.add(job)
    db.flush()
    db.add(models.Evaluation(job_id=job.id, overall_score=score, location_pass=location_pass, matched_keywords=[]))
    db.commit()
    return job


def make_settings(db, user_id, paused=False, threshold=70.0):
    settings = models.Settings(user_id=user_id, scheduler_paused=paused, fit_threshold=threshold, dry_run=True)
    db.add(settings)
    db.commit()
    return settings


@pytest.fixture(autouse=True)
def stub_discovery(monkeypatch):
    # These hit real network/subprocess calls in production; stub them out so
    # scheduler tests only exercise the candidate-selection/gating logic.
    monkeypatch.setattr(scheduler, "run_discovery", lambda db, user_id: {"new_jobs": 0})
    monkeypatch.setattr(scheduler, "evaluate_unevaluated_jobs", lambda db, user_id: 0)


def test_paused_scheduler_does_nothing(db, user, monkeypatch):
    make_settings(db, user.id, paused=True)
    make_job(db, user.id, score=90)
    called = []
    monkeypatch.setattr(scheduler, "tailor_job", lambda db, job_id, user_id: called.append(job_id))
    scheduler.run_cycle(db)
    assert called == []


def test_fresh_candidate_above_threshold_gets_tailored_and_applied(db, user, monkeypatch):
    make_settings(db, user.id, paused=False, threshold=70.0)
    job = make_job(db, user.id, score=80, location_pass=True)
    tailored, applied = [], []
    monkeypatch.setattr(
        scheduler,
        "tailor_job",
        lambda db, job_id, user_id: (tailored.append(job_id), (None, None, models.Application(status="ready")))[1],
    )
    monkeypatch.setattr(scheduler, "apply_to_job", lambda db, job_id, user_id: applied.append(job_id))
    scheduler.run_cycle(db)
    assert tailored == [job.id]
    assert applied == [job.id]


def test_below_threshold_job_is_skipped(db, user, monkeypatch):
    make_settings(db, user.id, paused=False, threshold=70.0)
    make_job(db, user.id, score=50, location_pass=True)
    called = []
    monkeypatch.setattr(scheduler, "tailor_job", lambda db, job_id, user_id: called.append(job_id))
    scheduler.run_cycle(db)
    assert called == []


def test_location_fail_job_is_skipped(db, user, monkeypatch):
    make_settings(db, user.id, paused=False, threshold=70.0)
    make_job(db, user.id, score=90, location_pass=False)
    called = []
    monkeypatch.setattr(scheduler, "tailor_job", lambda db, job_id, user_id: called.append(job_id))
    scheduler.run_cycle(db)
    assert called == []


def test_already_tailored_ready_application_is_retried_for_apply_only(db, user, monkeypatch):
    make_settings(db, user.id, paused=False, threshold=70.0)
    job = make_job(db, user.id, score=90, location_pass=True)
    db.add(models.Application(job_id=job.id, status="ready"))
    db.commit()

    tailored, applied = [], []
    monkeypatch.setattr(scheduler, "tailor_job", lambda db, job_id, user_id: tailored.append(job_id))
    monkeypatch.setattr(scheduler, "apply_to_job", lambda db, job_id, user_id: applied.append(job_id))
    scheduler.run_cycle(db)
    assert tailored == []  # already tailored -- must not re-tailor
    assert applied == [job.id]  # still needs an apply attempt


def test_stale_ready_application_below_threshold_is_skipped_not_retried(db, user, monkeypatch):
    make_settings(db, user.id, paused=False, threshold=70.0)
    # Simulates a job manually tailored during testing whose score no longer
    # (or never did) clear the bar -- the gate must catch it before apply_to_job.
    job = make_job(db, user.id, score=50, location_pass=True)
    application = models.Application(job_id=job.id, status="ready")
    db.add(application)
    db.commit()

    applied = []
    monkeypatch.setattr(scheduler, "apply_to_job", lambda db, job_id, user_id: applied.append(job_id))
    scheduler.run_cycle(db)

    assert applied == []
    db.refresh(application)
    assert application.status == "skipped"
    assert "score=50" in application.error_detail

    events = db.query(models.ApplicationEvent).filter_by(job_id=job.id, event_type="scheduler_skip_stale_ready").all()
    assert len(events) == 1


def test_stale_ready_application_failing_location_is_skipped_not_retried(db, user, monkeypatch):
    make_settings(db, user.id, paused=False, threshold=70.0)
    # Simulates a deal-breaker violation (e.g. requires relocation) that was
    # true when the job was manually tailored and must still block auto-apply.
    job = make_job(db, user.id, score=90, location_pass=False)
    application = models.Application(job_id=job.id, status="ready")
    db.add(application)
    db.commit()

    applied = []
    monkeypatch.setattr(scheduler, "apply_to_job", lambda db, job_id, user_id: applied.append(job_id))
    scheduler.run_cycle(db)

    assert applied == []
    db.refresh(application)
    assert application.status == "skipped"
    assert "location_pass=False" in application.error_detail


@pytest.mark.parametrize("status", ["needs_manual", "failed", "applied"])
def test_non_ready_applications_are_not_retried(db, user, monkeypatch, status):
    make_settings(db, user.id, paused=False, threshold=70.0)
    job = make_job(db, user.id, score=90, location_pass=True)
    db.add(models.Application(job_id=job.id, status=status))
    db.commit()

    applied = []
    monkeypatch.setattr(scheduler, "apply_to_job", lambda db, job_id, user_id: applied.append(job_id))
    scheduler.run_cycle(db)
    assert applied == []


def test_pipeline_error_logs_event_and_continues(db, user, monkeypatch):
    make_settings(db, user.id, paused=False, threshold=70.0)
    job = make_job(db, user.id, score=90, location_pass=True)

    def raise_error(db, job_id, user_id):
        raise PipelineError("boom")

    monkeypatch.setattr(scheduler, "tailor_job", raise_error)
    scheduler.run_cycle(db)  # must not raise

    events = db.query(models.ApplicationEvent).filter_by(job_id=job.id).all()
    assert len(events) == 1
    assert "boom" in events[0].detail


def test_run_cycle_processes_each_user_independently(db, monkeypatch):
    user_a = models.User(email="a@example.com", password_hash="x")
    user_b = models.User(email="b@example.com", password_hash="x")
    db.add_all([user_a, user_b])
    db.commit()
    db.refresh(user_a)
    db.refresh(user_b)

    make_settings(db, user_a.id, paused=False, threshold=70.0)
    make_settings(db, user_b.id, paused=True, threshold=70.0)  # b is paused
    job_a = make_job(db, user_a.id, score=90, location_pass=True)
    make_job(db, user_b.id, score=90, location_pass=True)

    tailored = []
    monkeypatch.setattr(
        scheduler,
        "tailor_job",
        lambda db, job_id, user_id: (tailored.append((job_id, user_id)), (None, None, models.Application(status="ready")))[1],
    )
    monkeypatch.setattr(scheduler, "apply_to_job", lambda db, job_id, user_id: None)
    scheduler.run_cycle(db)

    # Only user_a's fresh candidate is processed -- user_b is paused.
    assert tailored == [(job_a.id, user_a.id)]

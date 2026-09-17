import datetime as dt
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import models
from app.database import Base
from app.routers.applications import get_recent_events


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


def make_job(db, company, title, user_id):
    job = models.JobPosting(
        user_id=user_id, source_portal="linkedin-search", url=f"https://example.com/{id(object())}",
        company=company, title=title, location="Atlanta, GA", detected_platform="linkedin",
    )
    db.add(job)
    db.flush()
    return job


def make_event(db, job_id, event_type, detail, timestamp=None):
    event = models.ApplicationEvent(job_id=job_id, event_type=event_type, detail=detail)
    if timestamp is not None:
        event.timestamp = timestamp
    db.add(event)
    db.commit()
    return event


def test_get_recent_events_orders_newest_first_and_embeds_job_info(db, user):
    job_a = make_job(db, "Acme Corp", "Marketing Manager", user.id)
    job_b = make_job(db, "Widgets Inc", "Growth Lead", user.id)
    base = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
    make_event(db, job_a.id, "evaluated", "scored 82", base)
    make_event(db, job_b.id, "tailored", "resume built", base + dt.timedelta(minutes=1))
    make_event(db, job_a.id, "applied", "submitted via linkedin", base + dt.timedelta(minutes=2))

    events = get_recent_events(limit=20, db=db, current_user=user)

    assert [e["event_type"] for e in events] == ["applied", "tailored", "evaluated"]
    assert events[0]["company"] == "Acme Corp"
    assert events[0]["title"] == "Marketing Manager"
    assert events[1]["company"] == "Widgets Inc"


def test_get_recent_events_respects_limit(db, user):
    job = make_job(db, "Acme Corp", "Marketing Manager", user.id)
    for i in range(5):
        make_event(db, job.id, "event", f"detail {i}")

    events = get_recent_events(limit=2, db=db, current_user=user)

    assert len(events) == 2


def test_get_recent_events_empty_db_returns_empty_list(db, user):
    assert get_recent_events(limit=20, db=db, current_user=user) == []


def test_get_recent_events_excludes_other_users_jobs(db, user):
    other = models.User(email="other@example.com", password_hash="x")
    db.add(other)
    db.commit()
    db.refresh(other)

    mine = make_job(db, "Acme Corp", "Marketing Manager", user.id)
    theirs = make_job(db, "Other Co", "Other Role", other.id)
    make_event(db, mine.id, "evaluated", "scored 82")
    make_event(db, theirs.id, "evaluated", "scored 91")

    events = get_recent_events(limit=20, db=db, current_user=user)

    assert len(events) == 1
    assert events[0]["company"] == "Acme Corp"

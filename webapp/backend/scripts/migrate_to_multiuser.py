"""One-time migration: create the account for the existing app owner and
assign every pre-existing row in the per-user tables to it.

Must run AFTER alembic migration 514908acd80f (user/session tables +
nullable user_id columns) and BEFORE ef5df81f52ac (which makes user_id
NOT NULL) -- that second migration will fail with an IntegrityError on any
row this script hasn't touched yet.

Idempotent: if a User already exists for --email, reuses it instead of
creating a second account, and only backfills rows that are still NULL, so
re-running after a partial failure is safe.

Usage:
    ./.venv/bin/python scripts/migrate_to_multiuser.py --email you@example.com [--password ...]

If --password is omitted, a random one is generated and printed once --
there is no change-password flow yet, so treat it as the real login
password, not a placeholder to swap out later.
"""

from __future__ import annotations

import argparse
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import models  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.services import auth as auth_service  # noqa: E402
from app.services.automation.base import SESSION_DIR, linkedin_storage_state_path  # noqa: E402

# Tables scoped directly by user_id (per the multi-user plan). Tables that
# hang off a job (evaluation, resume_variant, cover_letter_variant,
# application, application_event) are scoped transitively through
# job_posting.user_id and need no backfill of their own.
BACKFILL_MODELS = [
    models.CandidateProfile,
    models.SkillBankEntry,
    models.ExperienceEntry,
    models.EducationEntry,
    models.JobPosting,
    models.QABankEntry,
    models.Settings,
]

LEGACY_LINKEDIN_STATE = SESSION_DIR / "linkedin_storage_state.json"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", default=None, help="Omit to auto-generate a random password")
    args = parser.parse_args()

    email = args.email.strip().lower()
    generated_password = None
    password = args.password
    if not password:
        generated_password = secrets.token_urlsafe(18)
        password = generated_password

    db = SessionLocal()
    try:
        user = db.query(models.User).filter_by(email=email).first()
        if user:
            print(f"Reusing existing account: {email} (id={user.id})")
        else:
            user = models.User(email=email, password_hash=auth_service.hash_password(password))
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"Created account: {email} (id={user.id})")

        for model in BACKFILL_MODELS:
            updated = (
                db.query(model)
                .filter(model.user_id.is_(None))
                .update({model.user_id: user.id}, synchronize_session=False)
            )
            db.commit()
            print(f"  {model.__tablename__}: backfilled {updated} row(s)")

        if LEGACY_LINKEDIN_STATE.exists():
            target = linkedin_storage_state_path(user.id)
            LEGACY_LINKEDIN_STATE.rename(target)
            print(f"  Moved legacy LinkedIn browser session -> {target.name}")

    finally:
        db.close()

    print()
    print(f"Owner account ready: {email}")
    if generated_password:
        print(f"Generated password (shown once -- there is no change-password flow yet): {generated_password}")


if __name__ == "__main__":
    main()

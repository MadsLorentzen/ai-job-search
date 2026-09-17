"""enforce user_id NOT NULL and drop legacy standalone unique constraints

This is the follow-up half of the two-step multi-user migration: 514908acd80f
added `user_id` as nullable (so it could be applied before any rows had an
owner) and a data-backfill script must run between that migration and this
one to assign every existing row to an owner `User`. Only after that backfill
can `user_id` safely become NOT NULL here.

`job_posting.url` and `skill_bank.skill` also still carry their original
single-column `UNIQUE` constraints (from back when these were global
singleton-style tables) alongside the new composite
`uq_job_posting_user_url` / `uq_skill_bank_user_skill` ones added in
514908acd80f. Autogenerate can't detect that diff -- SQLite reflects an
anonymous column-level UNIQUE as an unnamed `sqlite_autoindex_*`, which
alembic's comparator doesn't reliably match against the model's absence of
`unique=True` -- so those two tables are rebuilt here via raw SQL instead of
`batch_alter_table`, both to set `user_id NOT NULL` and to drop the legacy
single-column UNIQUE, in one pass. Left in place, that old constraint would
keep blocking the very thing per-user scoping is for: two different users
discovering and applying to the same real posting URL / having the same
named skill in their own skill bank.

Revision ID: ef5df81f52ac
Revises: 514908acd80f
Create Date: 2026-09-17 13:02:25.366005

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ef5df81f52ac'
down_revision: Union[str, Sequence[str], None] = '514908acd80f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('candidate_profile', schema=None) as batch_op:
        batch_op.alter_column('user_id', existing_type=sa.INTEGER(), nullable=False)

    with op.batch_alter_table('education_entry', schema=None) as batch_op:
        batch_op.alter_column('user_id', existing_type=sa.INTEGER(), nullable=False)

    with op.batch_alter_table('experience_entry', schema=None) as batch_op:
        batch_op.alter_column('user_id', existing_type=sa.INTEGER(), nullable=False)

    with op.batch_alter_table('qa_bank', schema=None) as batch_op:
        batch_op.alter_column('user_id', existing_type=sa.INTEGER(), nullable=False)

    with op.batch_alter_table('settings', schema=None) as batch_op:
        batch_op.alter_column('user_id', existing_type=sa.INTEGER(), nullable=False)

    # job_posting and skill_bank: rebuilt via raw SQL (not batch_alter_table)
    # so the rebuild can drop the legacy single-column UNIQUE at the same
    # time -- see module docstring.
    op.execute("""
        CREATE TABLE job_posting_new (
            id INTEGER NOT NULL,
            source_portal VARCHAR NOT NULL,
            url VARCHAR NOT NULL,
            company VARCHAR NOT NULL,
            title VARCHAR NOT NULL,
            location VARCHAR NOT NULL,
            employment_type VARCHAR NOT NULL,
            raw_description TEXT NOT NULL,
            detected_platform VARCHAR NOT NULL,
            discovered_at DATETIME NOT NULL,
            company_rating FLOAT,
            company_rating_source VARCHAR DEFAULT ('') NOT NULL,
            user_id INTEGER NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT uq_job_posting_user_url UNIQUE (user_id, url),
            CONSTRAINT fk_job_posting_user_id FOREIGN KEY(user_id) REFERENCES user (id)
        )
    """)
    op.execute("""
        INSERT INTO job_posting_new
        SELECT id, source_portal, url, company, title, location, employment_type,
               raw_description, detected_platform, discovered_at, company_rating,
               company_rating_source, user_id
        FROM job_posting
    """)
    op.execute("DROP TABLE job_posting")
    op.execute("ALTER TABLE job_posting_new RENAME TO job_posting")

    op.execute("""
        CREATE TABLE skill_bank_new (
            id INTEGER NOT NULL,
            skill VARCHAR NOT NULL,
            tier VARCHAR NOT NULL,
            category VARCHAR NOT NULL,
            synonyms VARCHAR NOT NULL,
            user_id INTEGER NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT uq_skill_bank_user_skill UNIQUE (user_id, skill),
            CONSTRAINT fk_skill_bank_user_id FOREIGN KEY(user_id) REFERENCES user (id)
        )
    """)
    op.execute("""
        INSERT INTO skill_bank_new
        SELECT id, skill, tier, category, synonyms, user_id
        FROM skill_bank
    """)
    op.execute("DROP TABLE skill_bank")
    op.execute("ALTER TABLE skill_bank_new RENAME TO skill_bank")


def downgrade() -> None:
    """Downgrade schema.

    Reverts `user_id` back to nullable on all seven tables. Does NOT restore
    the legacy single-column `UNIQUE(url)` / `UNIQUE(skill)` constraints on
    job_posting/skill_bank -- an intentional, disclosed simplification (this
    is a personal-scale app; forward-only migrations for this kind of
    constraint-shape change are an acceptable tradeoff over the extra raw-SQL
    machinery needed to resurrect a constraint we deliberately want gone).
    """
    with op.batch_alter_table('skill_bank', schema=None) as batch_op:
        batch_op.alter_column('user_id', existing_type=sa.INTEGER(), nullable=True)

    with op.batch_alter_table('settings', schema=None) as batch_op:
        batch_op.alter_column('user_id', existing_type=sa.INTEGER(), nullable=True)

    with op.batch_alter_table('qa_bank', schema=None) as batch_op:
        batch_op.alter_column('user_id', existing_type=sa.INTEGER(), nullable=True)

    with op.batch_alter_table('job_posting', schema=None) as batch_op:
        batch_op.alter_column('user_id', existing_type=sa.INTEGER(), nullable=True)

    with op.batch_alter_table('experience_entry', schema=None) as batch_op:
        batch_op.alter_column('user_id', existing_type=sa.INTEGER(), nullable=True)

    with op.batch_alter_table('education_entry', schema=None) as batch_op:
        batch_op.alter_column('user_id', existing_type=sa.INTEGER(), nullable=True)

    with op.batch_alter_table('candidate_profile', schema=None) as batch_op:
        batch_op.alter_column('user_id', existing_type=sa.INTEGER(), nullable=True)

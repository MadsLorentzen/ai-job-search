from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
DATABASE_URL = f"sqlite:///{DATA_DIR / 'app.db'}"

# Confirmed live (2026-09-16): a long-running discovery cycle (many LinkedIn
# queries, each new posting fetched via a slow `bun` subprocess call) holds
# its session open across the whole loop, autoflushing pending inserts as it
# goes -- and SQLite's DEFAULT rollback-journal mode gives that a lock that
# blocks essentially every other connection (including a concurrent request
# on this same process, e.g. the scheduler's own next cycle or a manual
# discovery trigger overlapping it) until the final commit. The result was a
# raw, unhandled "database is locked" OperationalError -- either a 500 to
# whichever request lost the race, or (worse, seen live) the entire
# in-progress discovery cycle's newly-found jobs silently discarded when its
# session got torn down without ever committing. WAL mode lets readers and a
# writer coexist without blocking each other, and a real busy_timeout makes a
# genuine writer-writer collision wait and retry instead of failing
# immediately -- the standard fix for this well-known SQLite+web-app pattern.
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False, "timeout": 30})


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, _record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=True, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

from webapp.persistence.db import init_db, connect
from webapp.persistence.workspaces import (
    PROFILE_WORKSPACE_ID,
    ensure_profile_workspace,
    create_workspace,
    get_workspace,
    list_workspaces,
)


def _conn(tmp_path):
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    return connect(db_path)


def test_ensure_profile_workspace_is_idempotent_and_has_fixed_id(tmp_path):
    conn = _conn(tmp_path)
    first = ensure_profile_workspace(conn)
    second = ensure_profile_workspace(conn)
    assert first["id"] == second["id"] == PROFILE_WORKSPACE_ID
    assert first["kind"] == "profile"
    conn.close()


def test_profile_workspace_never_appears_in_list_workspaces(tmp_path):
    conn = _conn(tmp_path)
    ensure_profile_workspace(conn)
    create_workspace(conn, company="Acme", title="Backend Engineer")
    listed = list_workspaces(conn)
    assert all(ws["id"] != PROFILE_WORKSPACE_ID for ws in listed)
    assert len(listed) == 1
    conn.close()


def test_create_workspace_has_null_workflow_status_and_job_kind(tmp_path):
    conn = _conn(tmp_path)
    ws = create_workspace(conn, company="Acme", title="Backend Engineer")
    assert ws["workflow_status"] is None
    assert ws["kind"] == "job"
    assert ws["company"] == "Acme"
    conn.close()


def test_get_workspace_roundtrip(tmp_path):
    conn = _conn(tmp_path)
    created = create_workspace(conn, company="Acme", title="Backend Engineer")
    assert get_workspace(conn, created["id"])["id"] == created["id"]
    conn.close()


def test_get_workspace_missing_returns_none(tmp_path):
    conn = _conn(tmp_path)
    assert get_workspace(conn, "does-not-exist") is None
    conn.close()


def test_ensure_profile_workspace_survives_concurrent_insert_race(tmp_path):
    # Simulate two callers racing to create the profile workspace: both see
    # `existing is None`, then a second connection inserts the row first, so
    # the module-under-test's own INSERT hits a primary-key conflict. This
    # must resolve to the existing row rather than raising IntegrityError.
    db_path = tmp_path / "jobsearch.sqlite3"
    init_db(db_path)
    conn = connect(db_path)

    other = connect(db_path)
    other.execute(
        "INSERT INTO workspaces (id, kind, company, title, workflow_status, created_at, updated_at) "
        "VALUES (?, 'profile', '', '', NULL, '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')",
        (PROFILE_WORKSPACE_ID,),
    )
    other.commit()
    other.close()

    # `conn` still thinks the row may not exist (no prior read in this test),
    # so calling ensure_profile_workspace on it exercises the INSERT ->
    # IntegrityError -> fallback-read path directly.
    result = ensure_profile_workspace(conn)
    assert result["id"] == PROFILE_WORKSPACE_ID
    assert result["kind"] == "profile"
    conn.close()

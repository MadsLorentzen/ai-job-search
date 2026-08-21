from __future__ import annotations

from webapp.persistence.db import connect, init_db
from webapp.persistence.user_profile import (
    get_current_user_profile,
    list_user_profile_versions,
    save_user_profile,
)


def _conn(tmp_path):
    path = tmp_path / "user-profile.sqlite3"
    init_db(path)
    return connect(path)


def test_user_profile_versions_are_append_only_and_current_pointer_moves(tmp_path):
    conn = _conn(tmp_path)

    first = save_user_profile(conn, {"target_roles": ["Planner"]})
    second = save_user_profile(conn, {"target_roles": ["Project Manager"]})

    assert first["id"] != second["id"]
    assert get_current_user_profile(conn)["id"] == second["id"]
    assert [item["id"] for item in list_user_profile_versions(conn)] == [
        second["id"], first["id"],
    ]


def test_saving_equivalent_normalized_profile_is_idempotent(tmp_path):
    conn = _conn(tmp_path)

    first = save_user_profile(conn, {"target_roles": [" Project   Manager "]})
    second = save_user_profile(conn, {"target_roles": ["Project Manager"]})

    assert second["id"] == first["id"]
    assert len(list_user_profile_versions(conn)) == 1

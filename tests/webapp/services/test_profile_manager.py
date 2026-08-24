import shutil
from pathlib import Path

import pytest

from webapp.persistence.artifacts import get_current_artifact, list_artifact_history, save_artifact
from webapp.persistence.db import connect, init_db
from webapp.persistence.profile_sources import list_profile_source_settings
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID, create_workspace
from webapp.services.pipeline import refresh_profile
from webapp.services.profile_manager import (
    ProfileManagerError,
    ProfileRevisionConflict,
    create_profile_entry,
    delete_profile_entry,
    get_profile_manager,
    update_profile_entry,
    update_profile_source,
)
from webapp.services.staleness import check_staleness, record_dependency_fingerprint


FIXTURE_ROOT = Path(__file__).parents[1] / "fixtures" / "webapp_profile_root"
CANDIDATE = Path(".claude/skills/job-application-assistant/01-candidate-profile.md")


PROFILE = """# Candidate Profile

## Identity
- **Name:** Ada Lovelace
- **Location:** London, UK

## Professional Experience

### Engineer - Analytical Engines Ltd (2020 - Present)

London

- Built reliable analytical systems.

## Technical Skills

### Tools

- Python

## Certifications

- PRINCE2 Practitioner
"""


def _setup(tmp_path):
    root = tmp_path / "profile-root"
    shutil.copytree(FIXTURE_ROOT, root)
    (root / CANDIDATE).write_text(PROFILE, encoding="utf-8")
    db_path = tmp_path / "profile.sqlite3"
    init_db(db_path)
    conn = connect(db_path)
    original = refresh_profile(conn, root=str(root))
    return root, conn, original


def _entry(manager, kind):
    return next(item for item in manager["entries"] if item["kind"] == kind)


def test_crud_uses_stable_source_entry_identity_and_immutable_snapshots(tmp_path):
    root, conn, original = _setup(tmp_path)
    manager = get_profile_manager(conn, root=root)
    employment = _entry(manager, "employment")
    entry_id = employment["entry_id"]

    updated = update_profile_entry(
        conn, root=root, expected_revision=manager["revision"], entry_id=entry_id,
        kind="employment", fields={
            "job_title": "Senior Engineer", "employer": "Analytical Engines Ltd",
            "date_range": "2020 - Present", "location": "London",
            "details": ["Built reliable analytical systems.", "Led delivery planning."],
        },
    )
    assert _entry(updated["manager"], "employment")["entry_id"] == entry_id
    assert "profile-entry-id: " + entry_id in (root / CANDIDATE).read_text(encoding="utf-8")
    assert any(
        claim["value"] == "Senior Engineer"
        for claim in updated["profile"]["payload"]["claims"]
    )
    assert get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")["id"] != original["id"]
    assert len(list_artifact_history(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")) == 2
    assert original["payload"] == list_artifact_history(
        conn, PROFILE_WORKSPACE_ID, "profile_snapshot"
    )[-1]["payload"]

    added = create_profile_entry(
        conn, root=root, expected_revision=updated["manager"]["revision"],
        kind="certification", fields={"value": "AWS Solutions Architect"},
    )
    added_id = added["entry_id"]
    assert any(item["entry_id"] == added_id for item in added["manager"]["entries"])

    deleted = delete_profile_entry(
        conn, root=root, expected_revision=added["manager"]["revision"],
        entry_id=added_id,
    )
    assert all(item["entry_id"] != added_id for item in deleted["manager"]["entries"])
    assert "AWS Solutions Architect" not in (root / CANDIDATE).read_text(encoding="utf-8")
    assert len(list_artifact_history(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")) == 4


def test_stale_revision_and_validation_failure_preserve_source_and_current_snapshot(tmp_path):
    root, conn, original = _setup(tmp_path)
    manager = get_profile_manager(conn, root=root)
    source_before = (root / CANDIDATE).read_bytes()

    create_profile_entry(
        conn, root=root, expected_revision=manager["revision"],
        kind="technical_skill", fields={"subsection": "Tools", "value": "SQL"},
    )
    current = get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")
    with pytest.raises(ProfileRevisionConflict):
        create_profile_entry(
            conn, root=root, expected_revision=manager["revision"],
            kind="certification", fields={"value": "Stale write"},
        )
    assert get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")["id"] == current["id"]

    fresh = get_profile_manager(conn, root=root)
    name = next(item for item in fresh["entries"] if item["kind"] == "identity" and item["fields"]["label"] == "Name")
    source_after_success = (root / CANDIDATE).read_bytes()
    with pytest.raises(ProfileManagerError, match="cannot be deleted"):
        delete_profile_entry(
            conn, root=root, expected_revision=fresh["revision"], entry_id=name["entry_id"]
        )
    assert (root / CANDIDATE).read_bytes() == source_after_success
    with pytest.raises(ProfileManagerError, match="non-conflicted candidate name"):
        update_profile_entry(
            conn, root=root, expected_revision=fresh["revision"],
            entry_id=name["entry_id"], kind="identity",
            fields={"label": "Name", "value": "[YOUR_NAME]"},
        )
    assert (root / CANDIDATE).read_bytes() == source_after_success
    assert get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")["id"] == current["id"]
    assert source_before != source_after_success
    assert original["id"] != current["id"]


def test_persistence_failure_restores_source_and_current_pointer(tmp_path, monkeypatch):
    root, conn, original = _setup(tmp_path)
    manager = get_profile_manager(conn, root=root)
    source_before = (root / CANDIDATE).read_bytes()

    def fail_save(*args, **kwargs):
        raise sqlite3.OperationalError("simulated persistence failure")

    import sqlite3
    monkeypatch.setattr("webapp.services.profile_manager.save_artifact", fail_save)
    with pytest.raises(sqlite3.OperationalError, match="simulated"):
        create_profile_entry(
            conn, root=root, expected_revision=manager["revision"],
            kind="certification", fields={"value": "Must roll back"},
        )
    assert (root / CANDIDATE).read_bytes() == source_before
    assert get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")["id"] == original["id"]
    assert len(list_artifact_history(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")) == 1
    with pytest.raises(sqlite3.OperationalError, match="simulated"):
        update_profile_source(
            conn, root=root, expected_revision=manager["revision"],
            source_path="CLAUDE.md", included=False,
        )
    assert next(
        source for source in list_profile_source_settings(conn)
        if source["source_path"] == "CLAUDE.md"
    )["included"] is True


def test_supplemental_sources_can_be_excluded_and_reenabled_but_candidate_is_required(tmp_path):
    root, conn, original = _setup(tmp_path)
    manager = get_profile_manager(conn, root=root)
    excluded = update_profile_source(
        conn, root=root, expected_revision=manager["revision"],
        source_path="CLAUDE.md", included=False,
    )
    assert "CLAUDE.md" not in {
        source["file"] for source in excluded["profile"]["payload"]["sources"]
    }
    assert (root / "CLAUDE.md").is_file()
    refreshed_while_excluded = refresh_profile(conn, root=str(root))
    assert "CLAUDE.md" not in {
        source["file"] for source in refreshed_while_excluded["payload"]["sources"]
    }
    with pytest.raises(ValueError, match="cannot be disabled"):
        update_profile_source(
            conn, root=root, expected_revision=excluded["manager"]["revision"],
            source_path=CANDIDATE.as_posix(), included=False,
        )
    reenabled = update_profile_source(
        conn, root=root, expected_revision=excluded["manager"]["revision"],
        source_path="CLAUDE.md", included=True,
    )
    assert "CLAUDE.md" in {
        source["file"] for source in reenabled["profile"]["payload"]["sources"]
    }
    assert len(list_artifact_history(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")) == 4


def test_profile_change_uses_existing_dependency_staleness_path(tmp_path):
    root, conn, original = _setup(tmp_path)
    workspace = create_workspace(conn, company="Acme", title="Engineer")
    fit = save_artifact(
        conn, workspace_id=workspace["id"], artifact_type="job_fit_result",
        content_id="fit-old", payload={"status": "READY"},
    )
    record_dependency_fingerprint(
        conn, artifact_id=fit["id"], upstream_artifact_type="profile_snapshot",
        upstream_content_id=original["content_id"],
    )
    manager = get_profile_manager(conn, root=root)
    create_profile_entry(
        conn, root=root, expected_revision=manager["revision"],
        kind="certification", fields={"value": "New evidence"},
    )
    stale = check_staleness(conn, workspace["id"], "job_fit_result")
    assert stale["stale"] is True
    assert any("profile_snapshot changed" in reason for reason in stale["reasons"])


def test_entry_identity_and_source_settings_survive_database_restart(tmp_path):
    root, conn, _ = _setup(tmp_path)
    manager = get_profile_manager(conn, root=root)
    ids_before = {
        (item["kind"], tuple(sorted(
            (key, tuple(value) if isinstance(value, list) else value)
            for key, value in item["fields"].items()
        ))): item["entry_id"]
        for item in manager["entries"]
    }
    excluded = update_profile_source(
        conn, root=root, expected_revision=manager["revision"],
        source_path="cv/main_example.tex", included=False,
    )
    db_path = conn.execute("PRAGMA database_list").fetchone()[2]
    conn.close()

    reopened = connect(Path(db_path))
    restarted = get_profile_manager(reopened, root=root)
    ids_after = {
        (item["kind"], tuple(sorted(
            (key, tuple(value) if isinstance(value, list) else value)
            for key, value in item["fields"].items()
        ))): item["entry_id"]
        for item in restarted["entries"]
    }
    assert ids_after == ids_before
    assert next(
        source for source in restarted["sources"]
        if source["source_path"] == "cv/main_example.tex"
    )["included"] is False
    assert restarted["revision"] == excluded["manager"]["revision"]

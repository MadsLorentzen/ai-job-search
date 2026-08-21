import shutil
from pathlib import Path

import pytest

from webapp.persistence.db import connect, init_db
from webapp.persistence.workspaces import PROFILE_WORKSPACE_ID
from webapp.persistence.artifacts import get_current_artifact
from webapp.services.pipeline import PipelineError
from webapp.services.profile_setup import (
    CANDIDATE_PROFILE_PATH,
    import_profile_markdown,
    profile_snapshot_is_ready,
    setup_basic_profile,
)


FIXTURE_ROOT = Path(__file__).parents[1] / "fixtures" / "webapp_profile_root"
PLACEHOLDER_PROFILE = """---
framework_version: 1.1.1
---

# Candidate Profile

<!-- SETUP: This file is populated by running /setup -->

## Identity
- **Name:** [YOUR_NAME]
"""


def _root(tmp_path):
    root = tmp_path / "profile-root"
    shutil.copytree(FIXTURE_ROOT, root)
    target = root / CANDIDATE_PROFILE_PATH
    target.write_text(PLACEHOLDER_PROFILE, encoding="utf-8")
    return root


def _conn(tmp_path):
    path = tmp_path / "profile.sqlite3"
    init_db(path)
    return connect(path)


def test_basic_setup_writes_canonical_source_and_builds_global_snapshot(tmp_path):
    root = _root(tmp_path)
    conn = _conn(tmp_path)

    artifact = setup_basic_profile(conn, root=root, data={
        "name": "Ada Lovelace",
        "location": "London, UK",
        "status": "UK work authorised",
        "constraints": "Open to hybrid work",
        "education": ["MSc Computing - Example University"],
        "experience": ["Led delivery planning for a complex programme."],
        "skills": ["Primavera P6", "Power BI"],
        "certifications": ["PRINCE2 Practitioner"],
    })

    assert artifact["workspace_id"] == PROFILE_WORKSPACE_ID
    assert profile_snapshot_is_ready(artifact)
    assert get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot")["id"] == artifact["id"]
    candidate_claims = [
        claim for claim in artifact["payload"]["claims"]
        if claim["source"]["file"] == CANDIDATE_PROFILE_PATH.as_posix()
    ]
    values = {claim["value"] for claim in candidate_claims}
    assert {"Ada Lovelace", "Primavera P6", "PRINCE2 Practitioner"} <= values
    assert any(claim["category"] == "education" for claim in candidate_claims)
    assert any(claim["category"] == "employment" for claim in candidate_claims)
    assert "[YOUR_NAME]" not in (root / CANDIDATE_PROFILE_PATH).read_text(encoding="utf-8")
    conn.close()


def test_invalid_import_preserves_placeholder_source_and_creates_no_snapshot(tmp_path):
    root = _root(tmp_path)
    conn = _conn(tmp_path)
    target = root / CANDIDATE_PROFILE_PATH

    with pytest.raises(PipelineError, match="explicit non-placeholder name"):
        import_profile_markdown(
            conn, root=root,
            markdown="# Candidate Profile\n\n## Identity\n- **Name:** [YOUR_NAME]\n",
        )

    assert target.read_text(encoding="utf-8") == PLACEHOLDER_PROFILE
    assert get_current_artifact(conn, PROFILE_WORKSPACE_ID, "profile_snapshot") is None
    conn.close()


def test_setup_refuses_to_overwrite_a_populated_candidate_source(tmp_path):
    root = _root(tmp_path)
    target = root / CANDIDATE_PROFILE_PATH
    populated = "# Candidate Profile\n\n## Identity\n- **Name:** Existing Person\n"
    target.write_text(populated, encoding="utf-8")
    conn = _conn(tmp_path)

    with pytest.raises(PipelineError, match="only available"):
        import_profile_markdown(
            conn, root=root,
            markdown="# Candidate Profile\n\n## Identity\n- **Name:** Replacement Person\n",
        )

    assert target.read_text(encoding="utf-8") == populated
    conn.close()

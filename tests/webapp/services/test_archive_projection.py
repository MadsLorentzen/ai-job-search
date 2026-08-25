import hashlib
import json
from pathlib import Path

from webapp.services.archive_projection import (
    _render_markdown,
    write_application_pack_projection,
)


_FIXTURES = Path(__file__).parents[2] / "fixtures" / "application_pack"


def test_v0_archive_projection_baseline_is_frozen_from_a7faadd():
    pack = json.loads(
        (_FIXTURES / "v0_renderer_baseline.json").read_text(encoding="utf-8")
    )
    expected = (_FIXTURES / "v0_archive_projection_baseline.md").read_bytes()
    actual = _render_markdown(
        pack, projection_id="art_v0_projection_baseline"
    ).encode("utf-8")

    assert len(expected) == 752
    assert hashlib.sha256(expected).hexdigest() == (
        "f6951f92b4cdcd81790b871a3639b899fc7ff05f2c16651be8cf00d96795ab68"
    )
    assert actual == expected


def test_v1_archive_projection_baseline_is_frozen_from_9f99898():
    pack = json.loads((_FIXTURES / "v1_valid.json").read_text(encoding="utf-8"))
    expected = (_FIXTURES / "v1_archive_projection_baseline.md").read_bytes()
    actual = _render_markdown(
        pack, projection_id="art_v1_manual_editing_projection_baseline"
    ).encode("utf-8")

    assert len(expected) == 2_705
    assert hashlib.sha256(expected).hexdigest() == (
        "8811be42ac296b0bd530900d9e6894d62d15574f44c081018c22164bc012a60a"
    )
    assert actual == expected


def _pack():
    return {
        "schema_version": "application-pack.v0",
        "source_artifacts": {"profile_snapshot": {"artifact_id": "art_profile"}},
        "job": {"company": "Acme / Corp", "title": "Backend Engineer", "description": "Original evidence"},
        "fit_summary": {"gaps": [{"gap_id": "gap_1"}]},
        "recommendation": "APPLY", "recommendation_reason": "Strong evidence",
        "cv_content": [{"unit_id": "u1", "text": "Built systems"}],
        "cover_letter_content": [],
        "review_record": {"exclusions": [{"domain_item_id": "u2"}]},
    }


def test_writes_safe_legacy_path_with_complete_audit_sections(tmp_path):
    path = write_application_pack_projection(
        _pack(), company="Acme / Corp", title="Backend Engineer", documents_root=tmp_path,
    )
    assert path == tmp_path / "applications" / "acme_corp_backend_engineer" / "application_pack.md"
    text = path.read_text(encoding="utf-8")
    for heading in ("Source Artifacts", "Job Posting Evidence", "Fit Summary", "Review and Exclusion Audit"):
        assert heading in text
    assert "Original evidence" in text


def test_never_overwrites_pack_or_existing_posting_and_never_invents_latex(tmp_path):
    folder = tmp_path / "applications" / "acme_corp_backend_engineer"
    folder.mkdir(parents=True)
    posting = folder / "job_posting.md"
    posting.write_text("existing", encoding="utf-8")
    first = write_application_pack_projection(_pack(), company="Acme / Corp", title="Backend Engineer", documents_root=tmp_path)
    first_text = first.read_text(encoding="utf-8")
    second = write_application_pack_projection(_pack(), company="Acme / Corp", title="Backend Engineer", documents_root=tmp_path)
    assert second != first
    assert first.read_text(encoding="utf-8") == first_text
    assert posting.read_text(encoding="utf-8") == "existing"
    assert not list(folder.glob("*.tex"))


def test_exact_artifact_projection_is_idempotent(tmp_path):
    first = write_application_pack_projection(
        _pack(), company="Acme", title="Backend Engineer", documents_root=tmp_path,
        projection_id="art_exact",
    )
    second = write_application_pack_projection(
        _pack(), company="Acme", title="Backend Engineer", documents_root=tmp_path,
        projection_id="art_exact",
    )
    assert second == first
    assert "application-pack-artifact: art_exact" in first.read_text(encoding="utf-8")
    assert len(list(first.parent.glob("application_pack*.md"))) == 1


def test_v1_projection_adds_exactly_one_embedded_candidate_audit_section(tmp_path):
    pack = _pack()
    pack["schema_version"] = "application-pack.v1"
    pack["candidate_snapshot"] = {
        "profile_schema_version": "candidate-profile-evidence-snapshot.v0",
        "identity": {
            "name": {
                "value": "Ada Lovelace",
                "profile_evidence_ids": ["clm_0000000000000001"],
            }
        },
        "contact": {"email": {"value": "private@example.com"}},
    }
    path = write_application_pack_projection(
        pack,
        company="Acme",
        title="Backend Engineer",
        documents_root=tmp_path,
        projection_id="art_v1_exact",
    )
    text = path.read_text(encoding="utf-8")
    assert text.count("## Candidate Snapshot") == 1
    assert '"value": "Ada Lovelace"' in text
    assert "private@example.com" in text
    assert "private@example.com" not in str(path)


def test_archive_projection_source_has_no_live_profile_lookup_import():
    import webapp.services.archive_projection as module

    source = Path(module.__file__).read_text(encoding="utf-8")
    for forbidden in (
        "profile_snapshot", "get_current_artifact", "get_artifact", "persistence"
    ):
        assert forbidden not in source

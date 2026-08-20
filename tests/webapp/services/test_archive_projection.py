from webapp.services.archive_projection import write_application_pack_projection


def _pack():
    return {
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

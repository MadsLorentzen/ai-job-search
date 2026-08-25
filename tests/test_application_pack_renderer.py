from __future__ import annotations

import ast
import copy
import json
import time
from io import BytesIO
from pathlib import Path

import pytest
from docx import Document

from product.application_pack_contract import ApplicationPackContractError
from product.application_pack_renderer import (
    RendererError,
    render_application_pack,
    render_cover_letter_document,
    render_cv_document,
)


_FIXTURES = Path(__file__).parent / "fixtures" / "application_pack"


def _pack(
    *,
    company: str = "Acme Corp",
    title: str = "Backend Engineer",
    cv_content: list[dict] | None = None,
    cover_letter_content: list[dict] | None = None,
) -> dict:
    return {
        "schema_version": "application-pack.v0",
        "job": {"company": company, "title": title, "location": "London"},
        "cv_content": (
            cv_content
            if cv_content is not None
            else [
                {
                    "unit_id": "cv_summary_1",
                    "unit_type": "cv_summary_line",
                    "text": "Backend engineer with 8 years building distributed systems.",
                    "status": "READY",
                    "profile_evidence_ids": ["claim_1"],
                },
                {
                    "unit_id": "cv_bullet_1",
                    "unit_type": "cv_bullet",
                    "text": "Led migration of payments service to Kubernetes.",
                    "status": "READY",
                    "profile_evidence_ids": ["claim_2"],
                },
                {
                    "unit_id": "cv_bullet_2",
                    "unit_type": "cv_bullet",
                    "text": "Reduced API latency by 40% through caching redesign.",
                    "status": "READY",
                    "profile_evidence_ids": ["claim_3"],
                },
            ]
        ),
        "cover_letter_content": (
            cover_letter_content
            if cover_letter_content is not None
            else [
                {
                    "unit_id": "cover_1",
                    "unit_type": "cover_letter_paragraph",
                    "text": "I am writing to apply for the Backend Engineer role at Acme Corp.",
                    "status": "READY",
                    "profile_evidence_ids": ["claim_2"],
                },
                {
                    "unit_id": "cover_2",
                    "unit_type": "cover_letter_paragraph",
                    "text": "My experience leading platform migrations aligns closely with your needs.",
                    "status": "READY",
                    "profile_evidence_ids": ["claim_2"],
                },
            ]
        ),
    }


def _paragraph_texts(document_bytes: bytes) -> list[str]:
    document = Document(BytesIO(document_bytes))
    return [paragraph.text for paragraph in document.paragraphs]


def test_v0_baseline_renderer_bytes_are_frozen_from_a7faadd():
    pack = json.loads(
        (_FIXTURES / "v0_renderer_baseline.json").read_text(encoding="utf-8")
    )

    rendered = render_application_pack(
        pack, source_pack_id="art_v0_baseline"
    )

    assert rendered.source_pack_id == "art_v0_baseline"
    assert rendered.renderer_version == "application-pack-renderer.v1"
    assert rendered.file("cv").filename == "Acme_Corp_Backend_Engineer_CV.docx"
    assert len(rendered.file("cv").content) == 36_857
    assert rendered.file("cv").content_hash == (
        "sha256:91c3ca63b2d9d16bb1d2e9ef0d40a7825e92874b6521b0824bf52b88dd6e541d"
    )
    assert rendered.file("cover_letter").filename == (
        "Acme_Corp_Backend_Engineer_Cover_Letter.docx"
    )
    assert len(rendered.file("cover_letter").content) == 36_713
    assert rendered.file("cover_letter").content_hash == (
        "sha256:2f9f45802ac9e983afd6a8af0858f5e9ab3dda58c7e96a7ccf207678e82c3159"
    )


def test_v1_baseline_renderer_bytes_are_frozen_from_9f99898():
    pack = json.loads((_FIXTURES / "v1_valid.json").read_text(encoding="utf-8"))

    rendered = render_application_pack(
        pack, source_pack_id="art_v1_manual_editing_baseline"
    )

    assert rendered.renderer_version == "application-pack-renderer.v2"
    assert len(rendered.file("cv").content) == 36_733
    assert rendered.file("cv").content_hash == (
        "sha256:ee9f915b0eaadf9eda5ac758016c44e0017ae7c180e4859d3812fb2241f0d19e"
    )
    assert len(rendered.file("cover_letter").content) == 36_668
    assert rendered.file("cover_letter").content_hash == (
        "sha256:9e69eb343b4be43317644b7ffd8a6a0029253bd57714bfbbf7acdc97851aaa7e"
    )


@pytest.mark.parametrize("schema_version", [None, "application-pack.v9"])
def test_renderer_rejects_absent_or_unknown_schema_version(schema_version):
    pack = _pack()
    if schema_version is None:
        pack.pop("schema_version")
    else:
        pack["schema_version"] = schema_version
    with pytest.raises(
        RendererError, match="^unsupported application pack schema version$"
    ):
        render_application_pack(pack, source_pack_id="art_unknown")


def _value(text: str, evidence_id: str = "clm_0000000000000001"):
    return {"value": text, "profile_evidence_ids": [evidence_id]}


def _rich_v1_pack():
    pack = json.loads((_FIXTURES / "v1_valid.json").read_text(encoding="utf-8"))
    candidate = pack["candidate_snapshot"]
    candidate["contact"].update(
        email=_value("ada@example.com"),
        phone=_value("+44 123"),
        linkedin=_value("linkedin.com/in/ada"),
        github=_value("github.com/ada"),
        location=_value("London, UK"),
    )
    candidate["employment"] = [
        {
            "record_id": "rec_0000000000000010",
            "role": _value("Engineer"),
            "employer": _value("Example Ltd"),
            "date_range": _value("2020–2024"),
            "location": _value("London"),
            "details": [_value("Built verified systems.")],
        }
    ]
    candidate["education"] = [
        {
            "record_id": "rec_0000000000000020",
            "qualification": _value("MSc Computing"),
            "institution": _value("Example University"),
            "date_range": _value("2018–2020"),
            "location": None,
            "key_topics": _value("Distributed systems"),
            "details": None,
        }
    ]
    candidate["certifications"] = [
        {"record_id": "rec_0000000000000030", "name": _value("Cloud Professional")}
    ]
    candidate["skills"] = [
        {"record_id": "rec_0000000000000040", "category": "Languages", "value": _value("Python")}
    ]
    candidate["languages"] = [
        {
            "record_id": "rec_0000000000000050",
            "language": _value("English"),
            "proficiency": _value("Fluent"),
            "notes": None,
        }
    ]
    candidate["projects"] = [
        {
            "record_id": "rec_0000000000000060",
            "name": _value("Verified Platform"),
            "description": _value("Auditable application workflow."),
        }
    ]
    candidate["publications"] = [
        {"record_id": "rec_0000000000000070", "value": _value("A Useful Paper")}
    ]
    candidate["awards"] = [
        {"record_id": "rec_0000000000000080", "value": _value("Engineering Award")}
    ]
    return pack


def test_v1_cv_renders_fixed_candidate_and_reviewed_content_sections():
    texts = _paragraph_texts(render_cv_document(_rich_v1_pack()))
    expected = [
        "Ada Lovelace",
        "ada@example.com | +44 123 | linkedin.com/in/ada | github.com/ada | London, UK",
        "Professional Summary",
        "Reviewed summary.",
        "Professional Experience",
        "Engineer | Example Ltd | 2020–2024 | London",
        "Built verified systems.",
        "Tailored Highlights",
        "Reviewed highlight.",
        "Education",
        "MSc Computing | Example University | 2018–2020",
        "Distributed systems",
        "Certifications",
        "Cloud Professional",
        "Skills",
        "Languages: Python",
        "Languages",
        "English | Fluent",
        "Projects",
        "Verified Platform",
        "Auditable application workflow.",
        "Publications",
        "A Useful Paper",
        "Awards",
        "Engineering Award",
    ]
    assert [text for text in texts if text] == expected
    joined = "\n".join(texts)
    assert "clm_" not in joined
    assert texts.index("Built verified systems.") < texts.index("Tailored Highlights")
    assert texts.index("Reviewed highlight.") > texts.index("Tailored Highlights")


def test_v1_cover_letter_uses_embedded_header_subject_and_reviewed_paragraphs_only():
    texts = _paragraph_texts(render_cover_letter_document(_rich_v1_pack()))
    assert texts == [
        "Ada Lovelace",
        "ada@example.com | +44 123 | linkedin.com/in/ada | github.com/ada | London, UK",
        "Re: Backend Engineer - Acme Corp",
        "Reviewed cover-letter paragraph.",
    ]
    assert not any(
        word in "\n".join(texts)
        for word in ("Dear Hiring Manager", "Sincerely", "Yours faithfully")
    )


def test_v1_empty_optional_sections_omit_cleanly_and_report_renderer_v2():
    pack = json.loads((_FIXTURES / "v1_valid.json").read_text(encoding="utf-8"))
    rendered = render_application_pack(pack, source_pack_id="art_v1")
    assert rendered.renderer_version == "application-pack-renderer.v2"
    texts = _paragraph_texts(rendered.file("cv").content)
    assert "Professional Experience" not in texts
    assert "Education" not in texts
    assert "Ada Lovelace" in texts


@pytest.mark.parametrize("kind", ["malformed", "unauthorized"])
def test_invalid_v1_pack_stays_behind_stable_renderer_error(kind):
    pack = _rich_v1_pack()
    if kind == "malformed":
        pack["candidate_snapshot"]["identity"]["name"] = None
    else:
        pack["review_record"]["decisions_consulted"] = [
            decision
            for decision in pack["review_record"]["decisions_consulted"]
            if decision["domain_item_id"] != "cv_summary_1"
        ]
    with pytest.raises(
        RendererError, match="^invalid application pack v1 payload$"
    ) as caught:
        render_application_pack(pack, source_pack_id="art_v1_invalid")
    assert isinstance(caught.value.__cause__, ApplicationPackContractError)
    assert "Ada" not in str(caught.value)


def test_v1_rendering_is_byte_identical_across_wall_clock_gap():
    pack = _rich_v1_pack()
    first = render_application_pack(pack, source_pack_id="art_v1")
    time.sleep(1.2)
    second = render_application_pack(pack, source_pack_id="art_v1")
    assert first.file("cv").content == second.file("cv").content
    assert first.file("cover_letter").content == second.file("cover_letter").content


def test_cv_document_contains_every_approved_unit_text():
    pack = _pack()
    texts = _paragraph_texts(render_cv_document(pack))
    assert "Backend engineer with 8 years building distributed systems." in texts
    assert "Led migration of payments service to Kubernetes." in texts
    assert "Reduced API latency by 40% through caching redesign." in texts


def test_cv_document_headings_present_only_when_units_present():
    pack = _pack()
    texts = _paragraph_texts(render_cv_document(pack))
    assert "Professional Summary" in texts
    assert "Key Experience & Skills" in texts


def test_cv_document_omits_summary_heading_when_no_summary_units():
    pack = _pack(
        cv_content=[
            {
                "unit_id": "cv_bullet_1", "unit_type": "cv_bullet",
                "text": "Only a bullet, no summary line.", "status": "READY",
                "profile_evidence_ids": [],
            },
        ]
    )
    texts = _paragraph_texts(render_cv_document(pack))
    assert "Professional Summary" not in texts
    assert "Key Experience & Skills" in texts


def test_cv_document_does_not_invent_unsupported_sections():
    pack = _pack()
    texts = "\n".join(_paragraph_texts(render_cv_document(pack)))
    for forbidden in ("Education", "Certifications", "Contact", "Professional Experience"):
        assert forbidden not in texts


def test_cover_letter_contains_every_approved_paragraph():
    pack = _pack()
    texts = _paragraph_texts(render_cover_letter_document(pack))
    assert "I am writing to apply for the Backend Engineer role at Acme Corp." in texts
    assert (
        "My experience leading platform migrations aligns closely with your needs."
        in texts
    )


def test_cover_letter_does_not_invent_recipient_or_salutation():
    pack = _pack()
    texts = "\n".join(_paragraph_texts(render_cover_letter_document(pack)))
    for forbidden in ("Dear Hiring Manager", "Dear Sir", "Sincerely", "Yours"):
        assert forbidden not in texts


def test_rendering_is_deterministic_across_repeated_calls():
    pack = _pack()
    first = render_application_pack(pack, source_pack_id="art_1")
    second = render_application_pack(pack, source_pack_id="art_1")
    assert first.file("cv").content == second.file("cv").content
    assert first.file("cover_letter").content == second.file("cover_letter").content
    assert first.file("cv").content_hash == second.file("cv").content_hash


def test_rendering_is_byte_identical_across_a_real_wall_clock_gap():
    """Regression: python-docx stamps ZIP entries with wall-clock time, so
    two renders separated by more than a second used to produce different
    raw bytes even for identical pack content. The renderer must freeze
    that timestamp so content_hash is a genuine raw-byte SHA-256 guarantee,
    not one that only happens to hold when calls land in the same second."""
    pack = _pack()
    first_cv = render_cv_document(pack)
    first_cover_letter = render_cover_letter_document(pack)
    time.sleep(1.2)
    second_cv = render_cv_document(pack)
    second_cover_letter = render_cover_letter_document(pack)
    assert first_cv == second_cv
    assert first_cover_letter == second_cover_letter


def test_rendered_output_traces_to_exact_source_pack_id():
    pack = _pack()
    result = render_application_pack(pack, source_pack_id="art_specific_version")
    assert result.source_pack_id == "art_specific_version"


def test_renderer_does_not_mutate_source_pack():
    pack = _pack()
    before = copy.deepcopy(pack)
    render_application_pack(pack, source_pack_id="art_1")
    assert pack == before


def test_renderer_rejects_missing_source_pack_id():
    with pytest.raises(RendererError):
        render_application_pack(_pack(), source_pack_id="")


def test_filenames_are_derived_from_job_company_and_title():
    pack = _pack(company="Acme Corp", title="Backend Engineer")
    result = render_application_pack(pack, source_pack_id="art_1")
    assert result.file("cv").filename == "Acme_Corp_Backend_Engineer_CV.docx"
    assert (
        result.file("cover_letter").filename
        == "Acme_Corp_Backend_Engineer_Cover_Letter.docx"
    )


def test_filenames_sanitize_unsafe_characters():
    pack = _pack(company="Acme / Corp: Global?", title="Senior Engineer*<Backend>")
    result = render_application_pack(pack, source_pack_id="art_1")
    for forbidden in '<>:"/\\|?*':
        assert forbidden not in result.file("cv").filename
        assert forbidden not in result.file("cover_letter").filename


def test_filenames_stay_reasonably_short_for_long_company_and_title():
    pack = _pack(company="A" * 200, title="B" * 200)
    result = render_application_pack(pack, source_pack_id="art_1")
    assert len(result.file("cv").filename) < 200
    assert len(result.file("cover_letter").filename) < 200


def test_unicode_company_and_title_render_without_error():
    pack = _pack(company="Société Générale", title="Ingénieur Système")
    result = render_application_pack(pack, source_pack_id="art_1")
    assert result.file("cv").filename.endswith("_CV.docx")
    texts = _paragraph_texts(result.file("cv").content)
    assert any("Société Générale" in text or "Ingénieur" in text for text in texts)


def test_punctuation_in_bullet_text_is_preserved_verbatim():
    text = "Managed R&D team's roadmap for the /billing API — cut costs by 15%."
    pack = _pack(
        cv_content=[
            {
                "unit_id": "cv_bullet_1", "unit_type": "cv_bullet", "text": text,
                "status": "READY", "profile_evidence_ids": [],
            },
        ]
    )
    texts = _paragraph_texts(render_cv_document(pack))
    assert text in texts


def test_long_bullet_text_is_rendered_in_full():
    long_text = "Delivered a resilient platform migration. " * 20
    pack = _pack(
        cv_content=[
            {
                "unit_id": "cv_bullet_1", "unit_type": "cv_bullet", "text": long_text,
                "status": "READY", "profile_evidence_ids": [],
            },
        ]
    )
    texts = _paragraph_texts(render_cv_document(pack))
    assert long_text in texts


def test_multi_paragraph_cover_letter_preserves_paragraph_boundaries():
    paragraphs = [
        {
            "unit_id": f"cover_{i}", "unit_type": "cover_letter_paragraph",
            "text": f"Paragraph number {i} of the cover letter.",
            "status": "READY", "profile_evidence_ids": [],
        }
        for i in range(1, 5)
    ]
    pack = _pack(cover_letter_content=paragraphs)
    texts = _paragraph_texts(render_cover_letter_document(pack))
    for i in range(1, 5):
        assert f"Paragraph number {i} of the cover letter." in texts


def test_empty_optional_sections_do_not_crash_rendering():
    pack = _pack(cv_content=[], cover_letter_content=[])
    result = render_application_pack(pack, source_pack_id="art_1")
    assert result.file("cv").content
    assert result.file("cover_letter").content


def test_content_hash_changes_when_pack_content_differs():
    pack_a = _pack()
    pack_b = _pack(
        cv_content=[
            {
                "unit_id": "cv_bullet_1", "unit_type": "cv_bullet",
                "text": "A completely different bullet.", "status": "READY",
                "profile_evidence_ids": [],
            },
        ]
    )
    result_a = render_application_pack(pack_a, source_pack_id="art_1")
    result_b = render_application_pack(pack_b, source_pack_id="art_1")
    assert result_a.file("cv").content_hash != result_b.file("cv").content_hash


def test_renderer_reflects_only_units_in_pack_order():
    pack = _pack(
        cv_content=[
            {
                "unit_id": "cv_bullet_2", "unit_type": "cv_bullet", "text": "Second bullet.",
                "status": "READY", "profile_evidence_ids": [],
            },
            {
                "unit_id": "cv_bullet_1", "unit_type": "cv_bullet", "text": "First bullet.",
                "status": "READY", "profile_evidence_ids": [],
            },
        ]
    )
    texts = _paragraph_texts(render_cv_document(pack))
    assert texts.index("Second bullet.") < texts.index("First bullet.")


def test_renderer_does_not_leak_internal_ids_or_evidence_ids():
    pack = _pack()
    texts = "\n".join(
        _paragraph_texts(render_cv_document(pack))
        + _paragraph_texts(render_cover_letter_document(pack))
    )
    assert "claim_1" not in texts
    assert "cv_summary_1" not in texts
    assert "profile_evidence_ids" not in texts


def test_renderer_never_imports_llm_provider_modules():
    import product.application_pack_renderer as module_under_test

    source = module_under_test.__file__
    with open(source, encoding="utf-8") as handle:
        contents = handle.read()
    for forbidden in ("openai", "application_intelligence", "job_fit", "profile_snapshot"):
        assert forbidden not in contents


def test_renderer_and_contract_import_graph_stays_upstream_independent():
    import product.application_pack_contract as contract_module
    import product.application_pack_renderer as renderer_module

    forbidden_prefixes = (
        "webapp",
        "product.profile_snapshot",
        "product.job_fit",
        "product.application_intelligence",
    )
    for module in (renderer_module, contract_module):
        tree = ast.parse(Path(module.__file__).read_text(encoding="utf-8"))
        imports = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imports.append(node.module)
        assert not any(
            imported == prefix or imported.startswith(prefix + ".")
            for imported in imports
            for prefix in forbidden_prefixes
        )
        assert not any("provider" in imported for imported in imports)


def test_historical_pack_renders_from_its_own_exact_contents_not_a_current_substitute():
    old_pack = _pack(company="Old Co", title="Old Role")
    new_pack = _pack(company="New Co", title="New Role")

    old_result = render_application_pack(old_pack, source_pack_id="art_old")
    new_result = render_application_pack(new_pack, source_pack_id="art_new")

    assert old_result.file("cv").filename.startswith("Old_Co_Old_Role")
    assert new_result.file("cv").filename.startswith("New_Co_New_Role")
    assert old_result.source_pack_id == "art_old"
    assert new_result.source_pack_id == "art_new"

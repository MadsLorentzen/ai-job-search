from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from product.application_pack_contract import (
    ApplicationPackContractError,
    build_candidate_snapshot,
    validate_application_pack_v1,
)


_FIXTURES = Path(__file__).parent / "fixtures" / "application_pack"


def _claim(
    number: int,
    category: str,
    field: str,
    value,
    *,
    record: int = 1,
    concept: int | None = None,
    file: str = "profile.md",
    line: int | None = None,
    placeholder: bool = False,
):
    return {
        "id": f"clm_{number:016x}",
        "record_id": f"rec_{record:016x}",
        "concept_id": f"cpt_{(concept if concept is not None else number):016x}",
        "category": category,
        "field": field,
        "value": value,
        "source": {
            "file": file,
            "section": None,
            "line_start": line if line is not None else number,
            "line_end": line if line is not None else number,
        },
        "placeholder": placeholder,
        "confidence": "high",
        "extraction_status": "explicit",
    }


def _artifact(claims, *, conflicts=None, schema_version="candidate-profile-evidence-snapshot.v0"):
    return {
        "id": "art_profile_exact",
        "artifact_type": "profile_snapshot",
        "content_id": "content_profile_exact",
        "payload": {
            "schema_version": schema_version,
            "claims": claims,
            "conflicts": conflicts or [],
        },
    }


def _name_claim(number=1, value="Ada Lovelace", **kwargs):
    return _claim(number, "identity", "name", value, record=1, concept=1, **kwargs)


def test_candidate_snapshot_maps_every_closed_presentation_category():
    claims = [
        _name_claim(),
        _claim(2, "contact", "email", "ada@example.com", record=2),
        _claim(3, "contact", "phone", "+44 123", record=3),
        _claim(4, "contact", "linkedin", "linkedin.com/in/ada", record=4),
        _claim(5, "contact", "github", "github.com/ada", record=5),
        _claim(6, "location", "location", "London, UK", record=6),
        _claim(10, "employment", "job_title", "Engineer", record=10),
        _claim(11, "employment", "employer", "Example Ltd", record=10),
        _claim(12, "employment", "date_range", "2020–2024", record=10),
        _claim(13, "employment", "location", "London", record=10),
        _claim(14, "employment", "responsibility_or_achievement", "Built systems.", record=10),
        _claim(20, "education", "qualification", "MSc Computing", record=20),
        _claim(21, "education", "institution", "Example University", record=20),
        _claim(22, "education", "date_range", "2018–2020", record=20),
        _claim(23, "education", "location", "Oxford", record=20),
        _claim(24, "education", "key_topics", "Distributed systems", record=20),
        _claim(25, "education", "details", "Distinction", record=20),
        _claim(30, "certifications", "certification", "Cloud Professional", record=30),
        _claim(40, "skills", "languages", "Python", record=40),
        _claim(50, "languages", "language", "English", record=50),
        _claim(51, "languages", "proficiency", "Fluent", record=50),
        _claim(52, "languages", "notes", "Professional use", record=50),
        _claim(60, "projects", "name", "Verified Platform", record=60),
        _claim(61, "projects", "description", "Built an auditable system.", record=60),
        _claim(70, "publications", "publication", "A Useful Paper", record=70),
        _claim(80, "awards", "award", "Engineering Award", record=80),
    ]

    snapshot = build_candidate_snapshot(_artifact(claims))

    assert snapshot["profile_schema_version"] == "candidate-profile-evidence-snapshot.v0"
    assert snapshot["identity"]["name"]["value"] == "Ada Lovelace"
    assert snapshot["contact"]["location"]["value"] == "London, UK"
    assert snapshot["employment"][0]["role"]["value"] == "Engineer"
    assert snapshot["employment"][0]["details"][0]["value"] == "Built systems."
    assert snapshot["education"][0]["details"]["value"] == "Distinction"
    assert snapshot["certifications"][0]["name"]["value"] == "Cloud Professional"
    assert snapshot["skills"][0]["category"] == "languages"
    assert snapshot["skills"][0]["value"]["value"] == "Python"
    assert snapshot["languages"][0]["notes"]["value"] == "Professional use"
    assert snapshot["projects"][0]["description"]["value"] == "Built an auditable system."
    assert snapshot["publications"][0]["value"]["value"] == "A Useful Paper"
    assert snapshot["awards"][0]["value"]["value"] == "Engineering Award"


def test_missing_contact_methods_and_optional_sections_are_explicitly_sparse():
    snapshot = build_candidate_snapshot(_artifact([_name_claim()]))

    assert snapshot["contact"] == {
        "email": None,
        "phone": None,
        "linkedin": None,
        "github": None,
        "location": None,
    }
    for category in (
        "employment", "education", "certifications", "skills", "languages",
        "projects", "publications", "awards",
    ):
        assert snapshot[category] == []


def test_equivalent_values_collapse_with_earliest_literal_and_all_sorted_ids():
    claims = [
        _name_claim(2, " ADA   LOVELACE ", file="z.md", line=20),
        _name_claim(1, "Ada Lovelace", file="a.md", line=10),
        _claim(4, "skills", "platforms", "Cloud — Native", record=4, concept=4, file="z.md"),
        _claim(3, "skills", "platforms", " cloud - native ", record=4, concept=4, file="a.md"),
    ]

    snapshot = build_candidate_snapshot(_artifact(claims))

    assert snapshot["identity"]["name"] == {
        "value": "Ada Lovelace",
        "profile_evidence_ids": ["clm_0000000000000001", "clm_0000000000000002"],
    }
    assert snapshot["skills"][0]["value"] == {
        "value": " cloud - native ",
        "profile_evidence_ids": ["clm_0000000000000003", "clm_0000000000000004"],
    }


def test_distinct_normalized_safe_names_fail_without_source_winner_selection():
    with pytest.raises(ApplicationPackContractError, match="candidate name"):
        build_candidate_snapshot(
            _artifact([_name_claim(), _name_claim(2, "Grace Hopper")])
        )


def test_distinct_normalized_values_for_one_safe_concept_fail():
    claims = [
        _name_claim(),
        _claim(2, "contact", "email", "one@example.com", record=2, concept=2),
        _claim(3, "contact", "email", "two@example.com", record=2, concept=2),
    ]
    with pytest.raises(ApplicationPackContractError, match="distinct normalized"):
        build_candidate_snapshot(_artifact(claims))


def test_placeholder_and_conflicted_concepts_never_enter_candidate_snapshot():
    claims = [
        _name_claim(),
        _claim(2, "contact", "phone", "[PHONE]", record=2, placeholder=True),
        _claim(3, "skills", "tools", "Unsafe tool", record=3, concept=3),
    ]
    snapshot = build_candidate_snapshot(
        _artifact(claims, conflicts=[{"concept_id": "cpt_0000000000000003"}])
    )
    assert snapshot["contact"]["phone"] is None
    assert snapshot["skills"] == []


def test_records_and_employment_details_use_deterministic_source_order():
    claims = [
        _name_claim(),
        _claim(2, "employment", "job_title", "Later Role", record=2, file="z.md", line=2),
        _claim(3, "employment", "responsibility_or_achievement", "Second detail", record=2, file="z.md", line=30),
        _claim(4, "employment", "responsibility_or_achievement", "First detail", record=2, file="z.md", line=20),
        _claim(5, "employment", "job_title", "Earlier Role", record=5, file="a.md", line=50),
    ]
    snapshot = build_candidate_snapshot(_artifact(claims))
    assert [row["role"]["value"] for row in snapshot["employment"]] == [
        "Earlier Role", "Later Role",
    ]
    assert [item["value"] for item in snapshot["employment"][1]["details"]] == [
        "First detail", "Second detail",
    ]


def test_unsupported_profile_schema_version_is_rejected():
    with pytest.raises(ApplicationPackContractError, match="unsupported profile"):
        build_candidate_snapshot(
            _artifact([_name_claim()], schema_version="candidate-profile-evidence-snapshot.v9")
        )


def test_builder_does_not_mutate_source_artifact():
    artifact = _artifact([_name_claim()])
    before = copy.deepcopy(artifact)
    build_candidate_snapshot(artifact)
    assert artifact == before


def _valid_v1_pack():
    return json.loads((_FIXTURES / "v1_valid.json").read_text(encoding="utf-8"))


def _matching_profile_artifact(*, include_employment=False):
    claims = [_name_claim()]
    if include_employment:
        claims.extend(
            [
                _claim(10, "employment", "job_title", "Engineer", record=10),
                _claim(11, "employment", "employer", "Example Ltd", record=10),
            ]
        )
    return _artifact(claims)


def test_valid_v1_pack_passes_render_and_construction_modes():
    pack = _valid_v1_pack()
    validate_application_pack_v1(pack)
    validate_application_pack_v1(
        pack, source_profile_artifact=_matching_profile_artifact()
    )


@pytest.mark.parametrize(
    "mutation",
    [
        lambda pack: pack.update(schema_version="application-pack.v9"),
        lambda pack: pack.update(unexpected=True),
        lambda pack: pack["candidate_snapshot"].update(unexpected=True),
        lambda pack: pack["candidate_snapshot"].update(profile_schema_version="profile.v9"),
        lambda pack: pack["candidate_snapshot"]["identity"].update(name=None),
        lambda pack: pack["candidate_snapshot"]["identity"]["name"].update(extra=True),
        lambda pack: pack["candidate_snapshot"]["identity"]["name"].update(
            profile_evidence_ids=[]
        ),
        lambda pack: pack["candidate_snapshot"]["identity"]["name"].update(
            profile_evidence_ids=["clm_0000000000000002", "clm_0000000000000001"]
        ),
        lambda pack: pack["source_artifacts"]["profile_snapshot"].update(extra=True),
    ],
)
def test_structurally_malformed_v1_pack_is_rejected_in_both_modes(mutation):
    pack = _valid_v1_pack()
    mutation(pack)
    with pytest.raises(ApplicationPackContractError):
        validate_application_pack_v1(pack)
    with pytest.raises(ApplicationPackContractError):
        validate_application_pack_v1(
            pack, source_profile_artifact=_matching_profile_artifact()
        )


@pytest.mark.parametrize(
    "decision_mutation",
    [
        lambda decisions: decisions.pop(0),
        lambda decisions: decisions[0].update(source_artifact_id="art_ai_old"),
        lambda decisions: decisions[0].update(disposition="omit_from_positioning"),
        lambda decisions: decisions.append(copy.deepcopy(decisions[0])),
    ],
)
def test_every_rendered_ai_unit_requires_exactly_one_acknowledgement(decision_mutation):
    pack = _valid_v1_pack()
    decision_mutation(pack["review_record"]["decisions_consulted"])
    with pytest.raises(ApplicationPackContractError, match="authorization"):
        validate_application_pack_v1(pack)


def test_acknowledgement_cannot_coexist_with_a_contradictory_matching_decision():
    pack = _valid_v1_pack()
    contradiction = copy.deepcopy(pack["review_record"]["decisions_consulted"][0])
    contradiction["id"] = "rev_contradiction"
    contradiction["disposition"] = "omit_from_positioning"
    pack["review_record"]["decisions_consulted"].append(contradiction)
    with pytest.raises(ApplicationPackContractError, match="authorization"):
        validate_application_pack_v1(pack)


def test_duplicate_rendered_unit_ids_are_rejected():
    pack = _valid_v1_pack()
    pack["cover_letter_content"][0]["unit_id"] = "cv_summary_1"
    with pytest.raises(ApplicationPackContractError, match="duplicate"):
        validate_application_pack_v1(pack)


def test_construction_mode_requires_exact_complete_candidate_projection():
    source = _matching_profile_artifact(include_employment=True)
    complete = _valid_v1_pack()
    complete["candidate_snapshot"] = build_candidate_snapshot(source)
    validate_application_pack_v1(complete, source_profile_artifact=source)

    mutations = []
    omitted_record = copy.deepcopy(complete)
    omitted_record["candidate_snapshot"]["employment"] = []
    mutations.append(omitted_record)
    omitted_field = copy.deepcopy(complete)
    omitted_field["candidate_snapshot"]["employment"][0]["employer"] = None
    mutations.append(omitted_field)
    fabricated = copy.deepcopy(complete)
    fabricated["candidate_snapshot"]["employment"].append(
        copy.deepcopy(fabricated["candidate_snapshot"]["employment"][0])
    )
    fabricated["candidate_snapshot"]["employment"][1]["record_id"] = "rec_ffffffffffffffff"
    mutations.append(fabricated)

    for pack in mutations:
        validate_application_pack_v1(pack)
        with pytest.raises(ApplicationPackContractError, match="exact projection"):
            validate_application_pack_v1(pack, source_profile_artifact=source)


def test_construction_mode_rejects_reordered_deterministic_output():
    source = _artifact(
        [
            _name_claim(),
            _claim(10, "employment", "job_title", "First", record=10, file="a.md"),
            _claim(20, "employment", "job_title", "Second", record=20, file="b.md"),
        ]
    )
    pack = _valid_v1_pack()
    pack["candidate_snapshot"] = build_candidate_snapshot(source)
    pack["candidate_snapshot"]["employment"].reverse()
    validate_application_pack_v1(pack)
    with pytest.raises(ApplicationPackContractError, match="exact projection"):
        validate_application_pack_v1(pack, source_profile_artifact=source)


def test_render_mode_is_structural_not_profile_referential_validation():
    pack = _valid_v1_pack()
    pack["candidate_snapshot"]["identity"]["name"]["profile_evidence_ids"] = [
        "clm_ffffffffffffffff"
    ]
    validate_application_pack_v1(pack)
    with pytest.raises(ApplicationPackContractError, match="exact projection"):
        validate_application_pack_v1(
            pack, source_profile_artifact=_matching_profile_artifact()
        )


def test_construction_mode_checks_exact_source_reference():
    pack = _valid_v1_pack()
    source = _matching_profile_artifact()
    source["content_id"] = "different_content"
    with pytest.raises(ApplicationPackContractError, match="reference mismatch"):
        validate_application_pack_v1(pack, source_profile_artifact=source)


@pytest.mark.parametrize("mutation", ["literal", "corroboration"])
def test_construction_mode_rejects_literal_or_corroborating_id_drift(mutation):
    source = _artifact(
        [
            _name_claim(1, "Ada Lovelace", file="a.md"),
            _name_claim(2, " ADA  LOVELACE ", file="b.md"),
        ]
    )
    pack = _valid_v1_pack()
    pack["candidate_snapshot"] = build_candidate_snapshot(source)
    if mutation == "literal":
        pack["candidate_snapshot"]["identity"]["name"]["value"] = "A. Lovelace"
    else:
        pack["candidate_snapshot"]["identity"]["name"]["profile_evidence_ids"].pop()
    validate_application_pack_v1(pack)
    with pytest.raises(ApplicationPackContractError, match="exact projection"):
        validate_application_pack_v1(pack, source_profile_artifact=source)

from __future__ import annotations

from copy import deepcopy

from webapp.application_material import (
    application_material_completion,
    normalized_word_tokens,
)


def _words(count: int, prefix: str) -> str:
    return " ".join(f"{prefix}{index}" for index in range(count))


def _unit(unit_id: str, unit_type: str, words: int, *, status: str = "READY") -> dict:
    return {
        "unit_id": unit_id,
        "unit_type": unit_type,
        "text": _words(words, unit_id),
        "status": status,
        "profile_evidence_ids": [f"clm_{unit_id}"],
    }


def _ready_pack() -> dict:
    cv_content = [
        _unit("cv_bullet", "cv_bullet", 10),
        _unit("cv_summary", "cv_summary_line", 10, status="NEEDS_REVIEW"),
    ]
    cover_letter_content = [
        _unit("cover_paragraph", "cover_letter_paragraph", 40),
    ]
    return {
        "cv_content": cv_content,
        "cover_letter_content": cover_letter_content,
        "review_record": {
            "decisions_consulted": [
                {
                    "review_item_type": "content_unit",
                    "domain_item_id": unit["unit_id"],
                    "disposition": "acknowledged_and_proceed",
                }
                for unit in cv_content + cover_letter_content
            ]
        },
    }


def test_normalized_words_use_nfkc_unicode_whitespace_and_edge_punctuation():
    text = "  Ｐｌａｎ\u2003delivery…  ‘end-to-end’  !!!  co-ordinate  "

    assert normalized_word_tokens(text) == [
        "Plan", "delivery", "end-to-end", "co-ordinate",
    ]


def test_exact_v1_boundaries_are_ready():
    completion = application_material_completion(_ready_pack())

    assert completion == {
        "status": "READY",
        "issues": [],
        "qualifying_cv_unit_count": 2,
        "cv_word_count": 20,
        "qualifying_cover_letter_paragraph_count": 1,
        "cover_letter_word_count": 40,
    }


def test_threshold_failures_have_stable_reason_order():
    pack = _ready_pack()
    pack["cv_content"] = [
        _unit("summary_only", "cv_summary_line", 19),
    ]
    pack["cover_letter_content"] = [
        _unit("positioning", "positioning_statement", 39),
    ]
    pack["review_record"]["decisions_consulted"] = [
        {
            "review_item_type": "content_unit",
            "domain_item_id": "summary_only",
            "disposition": "acknowledged_and_proceed",
        },
        {
            "review_item_type": "content_unit",
            "domain_item_id": "positioning",
            "disposition": "acknowledged_and_proceed",
        },
    ]

    assert application_material_completion(pack) == {
        "status": "INCOMPLETE",
        "issues": [
            "insufficient_cv_units",
            "missing_cv_bullet",
            "insufficient_cv_words",
            "insufficient_cover_letter_paragraphs",
            "insufficient_cover_letter_words",
        ],
        "qualifying_cv_unit_count": 1,
        "cv_word_count": 19,
        "qualifying_cover_letter_paragraph_count": 0,
        "cover_letter_word_count": 0,
    }


def test_unacknowledged_wrongly_typed_blank_and_invalid_status_units_do_not_qualify():
    pack = _ready_pack()
    pack["cv_content"].extend([
        _unit("unacknowledged", "cv_bullet", 50),
        _unit("wrong_collection", "cover_letter_paragraph", 50),
        {**_unit("blank", "cv_bullet", 1), "text": " … !!! "},
        _unit("invalid_status", "cv_bullet", 50, status="UNAVAILABLE"),
    ])

    completion = application_material_completion(pack)

    assert completion["status"] == "READY"
    assert completion["qualifying_cv_unit_count"] == 2
    assert completion["cv_word_count"] == 20


def test_each_substantive_boundary_is_independently_required():
    cases = []

    one_cv = _ready_pack()
    one_cv["cv_content"] = one_cv["cv_content"][:1]
    cases.append((one_cv, "insufficient_cv_units"))

    no_bullet = _ready_pack()
    no_bullet["cv_content"][0]["unit_type"] = "cv_summary_line"
    cases.append((no_bullet, "missing_cv_bullet"))

    short_cv = _ready_pack()
    short_cv["cv_content"][0]["text"] = _words(9, "short")
    cases.append((short_cv, "insufficient_cv_words"))

    no_cover = _ready_pack()
    no_cover["cover_letter_content"] = []
    cases.append((no_cover, "insufficient_cover_letter_paragraphs"))

    short_cover = _ready_pack()
    short_cover["cover_letter_content"][0]["text"] = _words(39, "short")
    cases.append((short_cover, "insufficient_cover_letter_words"))

    for pack, expected_issue in cases:
        completion = application_material_completion(deepcopy(pack))
        assert completion["status"] == "INCOMPLETE"
        assert expected_issue in completion["issues"]

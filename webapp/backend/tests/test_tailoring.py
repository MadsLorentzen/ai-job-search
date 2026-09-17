import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import models
from app.services.tailoring import MAX_TOTAL_BULLETS, apply_synonym_swaps, select_bullets


def make_role(id_, sort_order, bullet_specs):
    role = models.ExperienceEntry(
        id=id_, title=f"Role {id_}", company="Co", location="", start_date="2020", end_date="2021",
        sort_order=sort_order,
    )
    role.bullets = [
        models.BulletLibraryEntry(id=id_ * 100 + i, experience_id=id_, text=text, keywords=keywords, sort_order=i)
        for i, (text, keywords) in enumerate(bullet_specs)
    ]
    return role


def test_select_bullets_guarantees_min_one_per_role():
    # Neither role's bullets match any keyword -- both should still get 1.
    role_a = make_role(1, 0, [("Did a thing", ""), ("Did another thing", "")])
    role_b = make_role(2, 1, [("Did a third thing", "")])
    selected = select_bullets([role_a, role_b], matched_keywords=["SQL"])
    assert len(selected[role_a.id]) >= 1
    assert len(selected[role_b.id]) >= 1


def test_select_bullets_prefers_higher_relevance():
    role = make_role(
        1, 0,
        [
            ("Irrelevant bullet", ""),
            ("Used HubSpot and Salesforce for CRM", "HubSpot, Salesforce"),
            ("Also irrelevant", ""),
        ],
    )
    selected = select_bullets([role], matched_keywords=["HubSpot", "Salesforce"])
    texts = [b.text for b in selected[role.id]]
    assert "Used HubSpot and Salesforce for CRM" in texts


def test_select_bullets_respects_total_budget():
    # 10 roles x 5 bullets = 50 candidates, well over MAX_TOTAL_BULLETS.
    roles = [make_role(i, i, [(f"Bullet {i}-{j}", "") for j in range(5)]) for i in range(10)]
    selected = select_bullets(roles, matched_keywords=[])
    total = sum(len(v) for v in selected.values())
    assert total <= MAX_TOTAL_BULLETS


def test_select_bullets_preserves_narrative_order_within_role():
    role = make_role(
        1, 0,
        [
            ("First, uses HubSpot", "HubSpot"),
            ("Second, no keywords", ""),
            ("Third, uses HubSpot too", "HubSpot"),
        ],
    )
    selected = select_bullets([role], matched_keywords=["HubSpot"])
    texts = [b.text for b in selected[role.id]]
    # both HubSpot bullets should be selected, and still in original order
    assert texts.index("First, uses HubSpot") < texts.index("Third, uses HubSpot too")


def _skill(skill, synonyms):
    return models.SkillBankEntry(skill=skill, tier="strong", synonyms=synonyms)


def test_synonym_swap_applies_when_matched_and_synonym_present():
    text = apply_synonym_swaps(
        "Ran campaigns using marketing automation tools",
        matched_keywords=["HubSpot"],
        skills=[_skill("HubSpot", "marketing automation tools, marketing automation")],
    )
    assert "HubSpot" in text
    assert "marketing automation tools" not in text


def test_synonym_swap_skips_when_skill_not_matched_in_jd():
    original = "Ran campaigns using marketing automation tools"
    text = apply_synonym_swaps(
        original,
        matched_keywords=[],  # HubSpot was NOT detected in this JD
        skills=[_skill("HubSpot", "marketing automation tools")],
    )
    assert text == original


def test_synonym_swap_skips_when_canonical_already_present():
    original = "Used HubSpot for marketing automation tools reporting"
    text = apply_synonym_swaps(
        original,
        matched_keywords=["HubSpot"],
        skills=[_skill("HubSpot", "marketing automation tools")],
    )
    # canonical term already present -- must not double up or mangle the text
    assert text == original

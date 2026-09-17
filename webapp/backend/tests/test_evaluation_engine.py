import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.evaluation_engine import BEHAVIORAL_NEUTRAL_SCORE, score_behavioral


def test_score_behavioral_no_rating_stays_neutral_and_unassessed():
    score, assessed, note = score_behavioral(None, "")
    assert score == BEHAVIORAL_NEUTRAL_SCORE
    assert assessed is False
    assert "not independently assessed" in note.lower()


def test_score_behavioral_uses_real_rating():
    score, assessed, note = score_behavioral(4.0, "indeed")
    assert score == 80.0  # 4/5 * 100
    assert assessed is True
    assert "indeed" in note.lower()
    assert "4.0/5" in note


def test_score_behavioral_perfect_rating():
    score, assessed, _ = score_behavioral(5.0, "indeed")
    assert score == 100.0
    assert assessed is True


def test_score_behavioral_zero_rating():
    score, assessed, _ = score_behavioral(0.0, "indeed")
    assert score == 0.0
    assert assessed is True


def test_score_behavioral_clamps_out_of_range_values():
    # defensive against a bad upstream value outside the expected 0-5 scale
    score_high, _, _ = score_behavioral(7.0, "indeed")
    assert score_high == 100.0
    score_low, _, _ = score_behavioral(-2.0, "indeed")
    assert score_low == 0.0


def test_score_behavioral_missing_source_still_notes_unspecified():
    _, assessed, note = score_behavioral(3.5, "")
    assert assessed is True
    assert "unspecified source" in note.lower()

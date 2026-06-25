"""
Tests for ApplyCapEvaluator.

Run: python3 -m pytest .claude/skills/apply-cap/test_apply_cap.py -v
"""

from __future__ import annotations

import csv
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Bootstrap: make the skill importable regardless of cwd
# ---------------------------------------------------------------------------

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from apply_cap import (
    ApplyCapEvaluator,
    CapStatus,
    DedupeResult,
    CSV_FIELDS,
    _normalize_role,
    _week_bounds,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

CONFIG_PATH = Path(__file__).resolve().parent / "config.toml"


@pytest.fixture()
def tmp_evaluator(tmp_path: Path) -> ApplyCapEvaluator:
    """Evaluator wired to a temp directory; fresh CSV each test."""
    (tmp_path / "state").mkdir()
    return ApplyCapEvaluator(config_path=CONFIG_PATH, repo_root=tmp_path)


def _write_rows(csv_path: Path, rows: list[dict]) -> None:
    """Write rows to the CSV (create with header if needed)."""
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def _make_row(
    company: str,
    role_raw: str,
    days_ago: int = 0,
    status: str = "pending",
) -> dict:
    ts = (datetime.now() - timedelta(days=days_ago)).isoformat(timespec="seconds")
    return {
        "timestamp": ts,
        "company": company,
        "role_normalized": _normalize_role(role_raw),
        "role_raw": role_raw,
        "location": "Remote",
        "source": "test",
        "status": status,
        "notes": "",
    }


# ---------------------------------------------------------------------------
# Helpers / unit tests
# ---------------------------------------------------------------------------


def test_normalize_role_lowercases_and_strips_punct() -> None:
    assert _normalize_role("Senior  DevOps Engineer!") == "senior devops engineer"


def test_week_bounds_monday() -> None:
    monday = date(2026, 6, 22)
    lo, hi = _week_bounds(monday)
    assert lo == monday
    assert hi == date(2026, 6, 28)


def test_week_bounds_midweek() -> None:
    wednesday = date(2026, 6, 24)
    lo, hi = _week_bounds(wednesday)
    assert lo == date(2026, 6, 22)
    assert hi == date(2026, 6, 28)


# ---------------------------------------------------------------------------
# check_caps — daily
# ---------------------------------------------------------------------------


def test_fifth_attempt_ok(tmp_evaluator: ApplyCapEvaluator, tmp_path: Path) -> None:
    """Four prior attempts today → 5th attempt (cumulative) is OK."""
    csv_path = tmp_path / "state" / "applications.csv"
    rows = [_make_row("Co", "Engineer", days_ago=0) for _ in range(4)]
    _write_rows(csv_path, rows)

    status, daily, weekly = tmp_evaluator.check_caps(date.today())
    assert status == CapStatus.OK
    assert daily == 4


def test_sixth_attempt_daily_hit(
    tmp_evaluator: ApplyCapEvaluator, tmp_path: Path
) -> None:
    """5 attempts already logged today → next check is DAILY_HIT."""
    csv_path = tmp_path / "state" / "applications.csv"
    rows = [_make_row("Co", "Engineer", days_ago=0) for _ in range(5)]
    _write_rows(csv_path, rows)

    status, daily, weekly = tmp_evaluator.check_caps(date.today())
    assert status == CapStatus.DAILY_HIT
    assert daily == 5


# ---------------------------------------------------------------------------
# check_caps — weekly
# ---------------------------------------------------------------------------


def test_weekly_cap_hit_before_daily_fills(
    tmp_evaluator: ApplyCapEvaluator, tmp_path: Path
) -> None:
    """15 attempts spread across the week → WEEKLY_HIT even with daily room.

    Uses a pinned Thursday so the test is day-of-week independent.
    Mon/Tue/Wed each get 5 attempts (15 total); 'today' is Thursday with 0.
    """
    # Pin to a known Thursday so there are always 3 prior days this week.
    thursday = date(2026, 6, 25)
    monday = thursday - timedelta(days=3)  # 2026-06-22

    csv_path = tmp_path / "state" / "applications.csv"
    rows = []
    for day_offset in range(3):  # Mon, Tue, Wed
        day = monday + timedelta(days=day_offset)
        for _ in range(5):
            ts = datetime(day.year, day.month, day.day, 10, 0, 0).isoformat(
                timespec="seconds"
            )
            rows.append(
                {
                    "timestamp": ts,
                    "company": "Acme",
                    "role_normalized": _normalize_role("Engineer"),
                    "role_raw": "Engineer",
                    "location": "Remote",
                    "source": "test",
                    "status": "pending",
                    "notes": "",
                }
            )
    assert len(rows) == 15
    _write_rows(csv_path, rows)

    status, daily, weekly = tmp_evaluator.check_caps(thursday)
    assert status == CapStatus.WEEKLY_HIT
    assert weekly == 15
    assert daily == 0  # no attempts on Thursday itself


def test_weekly_cap_resets_next_week(
    tmp_evaluator: ApplyCapEvaluator, tmp_path: Path
) -> None:
    """15 attempts last week don't count toward this week's cap."""
    today = date.today()
    last_monday = today - timedelta(days=today.weekday() + 7)

    csv_path = tmp_path / "state" / "applications.csv"
    rows = []
    for i in range(15):
        day = last_monday + timedelta(days=i % 5)
        ts = datetime(day.year, day.month, day.day, 9, 0, 0).isoformat(
            timespec="seconds"
        )
        rows.append(
            {
                "timestamp": ts,
                "company": "OldCo",
                "role_normalized": _normalize_role("PM"),
                "role_raw": "PM",
                "location": "Remote",
                "source": "test",
                "status": "pending",
                "notes": "",
            }
        )
    _write_rows(csv_path, rows)

    status, daily, weekly = tmp_evaluator.check_caps(today)
    assert status == CapStatus.OK
    assert weekly == 0


# ---------------------------------------------------------------------------
# check_caps — cap resets at midnight local
# ---------------------------------------------------------------------------


def test_cap_resets_at_midnight(
    tmp_evaluator: ApplyCapEvaluator, tmp_path: Path
) -> None:
    """5 attempts yesterday do not count against today's daily cap."""
    csv_path = tmp_path / "state" / "applications.csv"
    yesterday = date.today() - timedelta(days=1)
    rows = [_make_row("Co", "Engineer", days_ago=1) for _ in range(5)]
    _write_rows(csv_path, rows)

    status, daily, _ = tmp_evaluator.check_caps(date.today())
    assert status == CapStatus.OK
    assert daily == 0


# ---------------------------------------------------------------------------
# check_dedupe
# ---------------------------------------------------------------------------


def test_same_role_within_window_is_duplicate(
    tmp_evaluator: ApplyCapEvaluator, tmp_path: Path
) -> None:
    csv_path = tmp_path / "state" / "applications.csv"
    rows = [_make_row("Palantir", "Software Engineer", days_ago=7)]
    _write_rows(csv_path, rows)

    result, dup_date = tmp_evaluator.check_dedupe("Palantir", "Software Engineer")
    assert result == DedupeResult.DUPLICATE_WITHIN_WINDOW
    assert dup_date is not None


def test_same_role_outside_window_is_outside(
    tmp_evaluator: ApplyCapEvaluator, tmp_path: Path
) -> None:
    csv_path = tmp_path / "state" / "applications.csv"
    rows = [_make_row("Palantir", "Software Engineer", days_ago=15)]
    _write_rows(csv_path, rows)

    result, dup_date = tmp_evaluator.check_dedupe("Palantir", "Software Engineer")
    assert result == DedupeResult.DUPLICATE_OUTSIDE_WINDOW
    assert dup_date is not None


def test_different_company_is_new(
    tmp_evaluator: ApplyCapEvaluator, tmp_path: Path
) -> None:
    csv_path = tmp_path / "state" / "applications.csv"
    rows = [_make_row("Palantir", "Software Engineer", days_ago=3)]
    _write_rows(csv_path, rows)

    result, _ = tmp_evaluator.check_dedupe("Leidos", "Software Engineer")
    assert result == DedupeResult.NEW


def test_different_role_same_company_is_new(
    tmp_evaluator: ApplyCapEvaluator, tmp_path: Path
) -> None:
    csv_path = tmp_path / "state" / "applications.csv"
    rows = [_make_row("Palantir", "Software Engineer", days_ago=3)]
    _write_rows(csv_path, rows)

    result, _ = tmp_evaluator.check_dedupe("Palantir", "Senior Data Scientist")
    assert result == DedupeResult.NEW


def test_dedupe_case_insensitive_company(
    tmp_evaluator: ApplyCapEvaluator, tmp_path: Path
) -> None:
    csv_path = tmp_path / "state" / "applications.csv"
    rows = [_make_row("PALANTIR", "Software Engineer", days_ago=3)]
    _write_rows(csv_path, rows)

    result, _ = tmp_evaluator.check_dedupe("palantir", "software engineer")
    assert result == DedupeResult.DUPLICATE_WITHIN_WINDOW


# ---------------------------------------------------------------------------
# Empty state
# ---------------------------------------------------------------------------


def test_empty_state_file_is_ok(
    tmp_evaluator: ApplyCapEvaluator, tmp_path: Path
) -> None:
    """CSV exists with only a header row."""
    csv_path = tmp_path / "state" / "applications.csv"
    _write_rows(csv_path, [])

    status, daily, weekly = tmp_evaluator.check_caps(date.today())
    assert status == CapStatus.OK
    assert daily == 0
    assert weekly == 0


def test_missing_state_file_is_ok(tmp_evaluator: ApplyCapEvaluator) -> None:
    """CSV doesn't exist at all — evaluator handles gracefully."""
    status, daily, weekly = tmp_evaluator.check_caps(date.today())
    assert status == CapStatus.OK
    assert daily == 0


# ---------------------------------------------------------------------------
# record_attempt
# ---------------------------------------------------------------------------


def test_record_attempt_creates_csv_with_header(
    tmp_evaluator: ApplyCapEvaluator, tmp_path: Path
) -> None:
    tmp_evaluator.record_attempt(
        "Acme", "DevOps Engineer", location="Remote", source="LinkedIn"
    )

    csv_path = tmp_path / "state" / "applications.csv"
    assert csv_path.exists()
    with csv_path.open() as fh:
        reader = csv.DictReader(fh)
        rows = list(reader)
    assert len(rows) == 1
    assert rows[0]["company"] == "Acme"
    assert rows[0]["role_normalized"] == "devops engineer"
    assert rows[0]["status"] == "pending"


# ---------------------------------------------------------------------------
# force_override
# ---------------------------------------------------------------------------


def test_force_override_writes_audit_line(
    tmp_evaluator: ApplyCapEvaluator, tmp_path: Path
) -> None:
    tmp_evaluator.force_override(
        company="Booz Allen",
        role_raw="AI Engineer",
        reason="Role re-opened after 10 days; hiring manager confirmed OK to reapply",
    )

    log_path = tmp_path / "state" / "overrides.log"
    assert log_path.exists()
    content = log_path.read_text()
    assert "OVERRIDE" in content
    assert "Booz Allen" in content
    assert "AI Engineer" in content
    assert "hiring manager" in content


def test_force_override_sets_status_in_csv(
    tmp_evaluator: ApplyCapEvaluator, tmp_path: Path
) -> None:
    tmp_evaluator.force_override(
        company="Booz Allen",
        role_raw="AI Engineer",
        reason="Test",
    )

    csv_path = tmp_path / "state" / "applications.csv"
    with csv_path.open() as fh:
        reader = csv.DictReader(fh)
        rows = list(reader)
    assert rows[0]["status"] == "force_override"


def test_force_override_requires_reason(tmp_evaluator: ApplyCapEvaluator) -> None:
    with pytest.raises(ValueError, match="reason"):
        tmp_evaluator.force_override("Acme", "Engineer", reason="")


# ---------------------------------------------------------------------------
# evaluate() — integration
# ---------------------------------------------------------------------------


def test_evaluate_ok_new_role(tmp_evaluator: ApplyCapEvaluator) -> None:
    result = tmp_evaluator.evaluate("NewCo", "Product Manager")
    assert result.permitted is True
    assert result.cap_status == CapStatus.OK
    assert result.dedupe_result == DedupeResult.NEW


def test_evaluate_blocked_on_daily_hit(
    tmp_evaluator: ApplyCapEvaluator, tmp_path: Path
) -> None:
    csv_path = tmp_path / "state" / "applications.csv"
    rows = [_make_row("Co", f"Role {i}", days_ago=0) for i in range(5)]
    _write_rows(csv_path, rows)

    result = tmp_evaluator.evaluate("NewCo", "New Role")
    assert result.permitted is False
    assert result.cap_status == CapStatus.DAILY_HIT


def test_evaluate_force_permits_despite_block(
    tmp_evaluator: ApplyCapEvaluator, tmp_path: Path
) -> None:
    csv_path = tmp_path / "state" / "applications.csv"
    rows = [_make_row("Co", f"Role {i}", days_ago=0) for i in range(5)]
    _write_rows(csv_path, rows)

    result = tmp_evaluator.evaluate("NewCo", "New Role", force=True)
    assert result.permitted is True
    assert result.force_active is True

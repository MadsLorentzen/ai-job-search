"""
Apply cap and dedupe enforcement for the /apply skill.

Stdlib only — no third-party imports.
"""

from __future__ import annotations

import csv
import re
import tomllib
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import Enum, auto
from pathlib import Path


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class CapStatus(Enum):
    OK = auto()
    DAILY_HIT = auto()
    WEEKLY_HIT = auto()


class DedupeResult(Enum):
    NEW = auto()
    DUPLICATE_WITHIN_WINDOW = auto()
    DUPLICATE_OUTSIDE_WINDOW = auto()


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------


@dataclass
class CapCheckResult:
    cap_status: CapStatus
    dedupe_result: DedupeResult
    daily_used: int
    daily_cap: int
    weekly_used: int
    weekly_cap: int
    permitted: bool
    force_active: bool = False
    duplicate_date: date | None = None

    @property
    def daily_remaining(self) -> int:
        return max(0, self.daily_cap - self.daily_used)

    @property
    def weekly_remaining(self) -> int:
        return max(0, self.weekly_cap - self.weekly_used)


# ---------------------------------------------------------------------------
# CSV field constants
# ---------------------------------------------------------------------------

CSV_FIELDS = [
    "timestamp",
    "company",
    "role_normalized",
    "role_raw",
    "location",
    "source",
    "status",
    "notes",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _normalize_role(role: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    lowered = role.lower()
    no_punct = re.sub(r"[^\w\s]", "", lowered)
    return re.sub(r"\s+", " ", no_punct).strip()


def _week_bounds(today: date) -> tuple[date, date]:
    """Return (monday, sunday) of the ISO week containing *today*."""
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday


def _load_rows(csv_path: Path) -> list[dict]:
    """Load all rows from the applications CSV; return [] if missing or empty."""
    if not csv_path.exists():
        return []
    with csv_path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        return list(reader)


def _ensure_csv(csv_path: Path) -> None:
    """Create the CSV with headers if it does not exist."""
    if csv_path.exists():
        return
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
        writer.writeheader()


# ---------------------------------------------------------------------------
# Main class
# ---------------------------------------------------------------------------


class ApplyCapEvaluator:
    """
    Enforces daily/weekly application caps and a per-role dedupe window.

    All state lives in a flat CSV file; no database required.
    """

    def __init__(
        self, config_path: Path | None = None, repo_root: Path | None = None
    ) -> None:
        if repo_root is None:
            # Walk up from this file to find the repo root (contains .claude/)
            repo_root = Path(__file__).resolve().parent.parent.parent.parent

        if config_path is None:
            config_path = Path(__file__).resolve().parent / "config.toml"

        with config_path.open("rb") as fh:
            cfg = tomllib.load(fh)

        self._daily_cap: int = cfg["caps"]["daily_cap"]
        self._weekly_cap: int = cfg["caps"]["weekly_cap"]
        self._dedupe_window_days: int = cfg["dedupe"]["dedupe_window_days"]
        self._csv_path: Path = repo_root / cfg["state"]["applications_csv"]
        self._log_path: Path = repo_root / cfg["state"]["overrides_log"]

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def check_caps(self, today: date | None = None) -> tuple[CapStatus, int, int]:
        """
        Return (CapStatus, daily_used, weekly_used) for *today*.

        Weekly cap is checked first so WEEKLY_HIT takes precedence.
        """
        if today is None:
            today = date.today()

        rows = _load_rows(self._csv_path)
        monday, sunday = _week_bounds(today)

        daily_used = 0
        weekly_used = 0

        for row in rows:
            ts_str = row.get("timestamp", "")
            if not ts_str:
                continue
            try:
                row_date = datetime.fromisoformat(ts_str).date()
            except ValueError:
                continue

            if monday <= row_date <= sunday:
                weekly_used += 1
            if row_date == today:
                daily_used += 1

        if weekly_used >= self._weekly_cap:
            return CapStatus.WEEKLY_HIT, daily_used, weekly_used
        if daily_used >= self._daily_cap:
            return CapStatus.DAILY_HIT, daily_used, weekly_used
        return CapStatus.OK, daily_used, weekly_used

    def check_dedupe(self, company: str, role: str) -> tuple[DedupeResult, date | None]:
        """
        Return (DedupeResult, matched_date_or_None) for the given company+role.

        Matching is case-insensitive on company and normalized on role.
        """
        rows = _load_rows(self._csv_path)
        target_role = _normalize_role(role)
        target_company = company.strip().lower()
        cutoff = date.today() - timedelta(days=self._dedupe_window_days)

        best: tuple[DedupeResult, date | None] = (DedupeResult.NEW, None)

        for row in rows:
            if row.get("company", "").strip().lower() != target_company:
                continue
            if row.get("role_normalized", "").strip() != target_role:
                continue

            ts_str = row.get("timestamp", "")
            try:
                row_date = datetime.fromisoformat(ts_str).date()
            except ValueError:
                continue

            if row_date >= cutoff:
                # Within window — strongest match, return immediately
                return DedupeResult.DUPLICATE_WITHIN_WINDOW, row_date

            # Outside window — keep searching for an in-window match
            if best[0] == DedupeResult.NEW:
                best = (DedupeResult.DUPLICATE_OUTSIDE_WINDOW, row_date)

        return best

    def record_attempt(
        self,
        company: str,
        role_raw: str,
        location: str = "",
        source: str = "",
        status: str = "pending",
        notes: str = "",
    ) -> None:
        """Append one attempt row to the CSV."""
        _ensure_csv(self._csv_path)
        role_norm = _normalize_role(role_raw)
        ts = datetime.now().isoformat(timespec="seconds")
        row = {
            "timestamp": ts,
            "company": company.strip(),
            "role_normalized": role_norm,
            "role_raw": role_raw.strip(),
            "location": location.strip(),
            "source": source.strip(),
            "status": status.strip() or "pending",
            "notes": notes.strip(),
        }
        with self._csv_path.open("a", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
            # Write header only if file was just created (size == 0 after open("a"))
            if self._csv_path.stat().st_size == 0:
                writer.writeheader()
            writer.writerow(row)

    def force_override(
        self,
        company: str,
        role_raw: str,
        reason: str,
        location: str = "",
        source: str = "",
        notes: str = "",
    ) -> None:
        """
        Record a force-override attempt: writes CSV row + audit log line.

        Caller is responsible for having already verified --force flag and
        supplying a non-empty reason.
        """
        if not reason or not reason.strip():
            raise ValueError("force_override requires a non-empty reason")

        # Write the attempt row with status=force_override
        self.record_attempt(
            company=company,
            role_raw=role_raw,
            location=location,
            source=source,
            status="force_override",
            notes=notes,
        )

        # Append to overrides audit log
        self._log_path.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().isoformat(timespec="seconds")
        role_norm = _normalize_role(role_raw)
        audit_line = (
            f"{ts} | OVERRIDE"
            f" | company={company.strip()}"
            f" | role={role_raw.strip()}"
            f" | role_normalized={role_norm}"
            f" | reason={reason.strip()}\n"
        )
        with self._log_path.open("a", encoding="utf-8") as fh:
            fh.write(audit_line)

    def evaluate(
        self,
        company: str,
        role_raw: str,
        today: date | None = None,
        force: bool = False,
        force_reason: str = "",
    ) -> CapCheckResult:
        """
        Full evaluation: caps + dedupe → CapCheckResult.

        Does NOT write state — call record_attempt() or force_override() after
        confirming with the user.
        """
        if today is None:
            today = date.today()

        cap_status, daily_used, weekly_used = self.check_caps(today)
        dedupe_result, dup_date = self.check_dedupe(company, role_raw)

        cap_blocked = cap_status in (CapStatus.DAILY_HIT, CapStatus.WEEKLY_HIT)
        dedupe_blocked = dedupe_result == DedupeResult.DUPLICATE_WITHIN_WINDOW

        if force:
            permitted = True
        else:
            permitted = not cap_blocked and not dedupe_blocked

        return CapCheckResult(
            cap_status=cap_status,
            dedupe_result=dedupe_result,
            daily_used=daily_used,
            daily_cap=self._daily_cap,
            weekly_used=weekly_used,
            weekly_cap=self._weekly_cap,
            permitted=permitted,
            force_active=force,
            duplicate_date=dup_date,
        )

"""Durable storage for discovered jobs, plus a discovery-run ledger.

This module is the missing writer. ``app/orchestrator/rank.py:15`` reads
``job_scraper/seen_jobs.json``, but nothing in the repository has ever written
it: the slash-command runtime that used to own that file was deleted during the
migration to Python. Until a store existed, every discovered job existed only
as a local variable inside a scraper and vanished when the process exited.

Files, all under a gitignored ``data/`` directory:

``data/jobs.jsonl``
    Append-only event log of canonical job records. A later sighting of the
    same URL appends a new line rather than rewriting an old one, so history is
    never silently replaced. :func:`JobStore.load_jobs` folds the log back to
    one canonical record per job, taking the most recent line.

``data/seen.json``
    The identity index, rewritten atomically. Maps normalized URL keys to job
    ids, tracks fingerprints, and holds source provenance.

``data/runs.jsonl``
    Append-only ledger of discovery runs. Records whether each source
    succeeded, returned nothing, or failed - the three are recorded distinctly
    so "the site had no jobs" is never confused with "we could not reach the
    site".

``data/rejected.jsonl``
    Records too incomplete to store, with a reason. A malformed listing is
    quarantined, never dropped and never fatal.

Deduplication policy
-------------------
Automatic merging happens on **exact normalized URL match only**. A
``company::title`` fingerprint is computed and used to *flag* likely
cross-source duplicates as ``possible_duplicate``, but a fingerprint match
never merges records in this phase. Merging on a fingerprint alone would risk
collapsing two genuinely different roles that share a company and title, and
that error is not recoverable once written. Never merges on title alone.

Guarantees
----------
* Nothing here deletes a stored job. Expiry is out of scope.
* Writes are atomic (temporary file plus ``os.replace``), matching the pattern
  in :mod:`app.state.journal`.
* A corrupt ``seen.json`` raises rather than being overwritten.
* No network, no model calls, no credentials, no personal documents.

Only job-listing fields are persisted. CVs, cookies, browser profiles and API
keys must never be written under ``data/``.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.jobs.models import Job


RECORD_VERSION = 1
SEEN_VERSION = 1

#: Query parameters that identify the referrer, not the vacancy.
TRACKING_PARAMS = frozenset({"gclid", "fbclid", "ref", "source", "campaign", "via"})

#: Legal-entity suffixes removed when fingerprinting a company name. Kept
#: deliberately short: an over-eager list would collapse distinct employers.
LEGAL_SUFFIXES = frozenset({
    "inc", "incorporated", "llc", "llp", "ltd", "limited", "plc", "corp",
    "corporation", "co", "company", "gmbh", "ag", "bv", "nv", "sa", "sas",
    "srl", "spa", "oy", "ab", "as", "aps", "kfs", "ehf",
    "a/s", "ivs", "aps", "is", "ps", "ks",
})

_REQUIRED_FIELDS = ("title", "company", "url")


class StoreCorruptError(RuntimeError):
    """Raised when ``seen.json`` cannot be parsed. Never overwrite on this."""


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _populated(value: Any) -> bool:
    return value is not None and value != "" and value != [] and value != {}


def normalize_url(url: str) -> str:
    """Return a stable key for a vacancy URL.

    Lowercases scheme and host (both case-insensitive per RFC 3986), keeps the
    path as-is (paths *are* case-sensitive), drops the fragment and any
    trailing slash, removes tracking parameters, and sorts what remains so
    ``?a=1&b=2`` and ``?b=2&a=1`` collapse to one key.
    """
    raw = (url or "").strip()
    if not raw:
        return ""
    parts = urlsplit(raw)
    query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key.casefold() not in TRACKING_PARAMS and not key.casefold().startswith("utm_")
    ]
    path = parts.path.rstrip("/")
    return urlunsplit(
        (
            parts.scheme.casefold(),
            parts.netloc.casefold(),
            path,
            urlencode(sorted(query)),
            "",
        )
    )


def _normalize_name(value: str) -> str:
    """Lowercase, drop legal suffixes, and collapse punctuation and spacing."""
    text = (value or "").casefold()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    tokens = [token for token in text.split() if token]
    while tokens and tokens[-1] in LEGAL_SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


def fingerprint(company: str, title: str) -> str:
    """Return a ``company::title`` key used only to *flag* likely duplicates."""
    return f"{_normalize_name(company)}::{_normalize_name(title)}"


def _derive_job_id(record: Mapping[str, Any], url_key: str) -> str:
    for key in ("job_id", "id"):
        value = record.get(key)
        if value:
            return str(value)
    seed = url_key or fingerprint(str(record.get("company", "")), str(record.get("title", "")))
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]


def _job_fields(record: Mapping[str, Any]) -> Dict[str, Any]:
    """Project a raw record onto the canonical ``Job`` field set."""
    known = Job.__dataclass_fields__
    return {key: value for key, value in record.items() if key in known}


@dataclass
class SourceOutcome:
    """The result of one source in one run.

    ``ok`` is false only when the source actually failed. A source that
    returned nothing without erroring is ``ok=True, fetched=0`` - deliberately
    distinct, because collapsing the two is what made "why did I get zero
    jobs?" unanswerable.
    """

    name: str
    ok: bool = True
    fetched: int = 0
    stored: int = 0
    updated: int = 0
    rejected: int = 0
    error: Optional[str] = None
    duration_ms: int = 0


@dataclass
class RunRecord:
    """One discovery run across every source."""

    run_id: str
    started_at: str = field(default_factory=_utcnow)
    finished_at: str = field(default_factory=_utcnow)
    sources: List[SourceOutcome] = field(default_factory=list)

    @property
    def total_fetched(self) -> int:
        return sum(source.fetched for source in self.sources)

    @property
    def total_stored(self) -> int:
        return sum(source.stored for source in self.sources)

    @property
    def total_updated(self) -> int:
        return sum(source.updated for source in self.sources)

    @property
    def total_rejected(self) -> int:
        return sum(source.rejected for source in self.sources)

    @property
    def all_failed(self) -> bool:
        return bool(self.sources) and all(not source.ok for source in self.sources)

    @property
    def partially_failed(self) -> bool:
        return any(not source.ok for source in self.sources) and not self.all_failed

    def exit_code(self) -> int:
        """Non-zero only when every source failed."""
        return 2 if self.all_failed else 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "run_id": self.run_id,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "duration_ms": 0,
            "exit_code": self.exit_code(),
            "all_failed": self.all_failed,
            "partially_failed": self.partially_failed,
            "totals": {
                "fetched": self.total_fetched,
                "stored": self.total_stored,
                "updated": self.total_updated,
                "rejected": self.total_rejected,
            },
            "sources": [asdict(source) for source in self.sources],
        }


@dataclass
class StoreResult:
    """What one :meth:`JobStore.store` call did."""

    stored: int = 0
    updated: int = 0
    rejected: int = 0
    possible_duplicates: int = 0

    def as_outcome(self, name: str, fetched: int, duration_ms: int = 0) -> SourceOutcome:
        return SourceOutcome(
            name=name,
            ok=True,
            fetched=fetched,
            stored=self.stored,
            updated=self.updated,
            rejected=self.rejected,
            error=None,
            duration_ms=duration_ms,
        )


class JobStore:
    """Durable, append-only storage for discovered jobs."""

    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.jobs_path = self.data_dir / "jobs.jsonl"
        self.seen_path = self.data_dir / "seen.json"
        self.runs_path = self.data_dir / "runs.jsonl"
        self.rejected_path = self.data_dir / "rejected.jsonl"

    # ------------------------------------------------------------------
    # primitives
    # ------------------------------------------------------------------

    def _atomic_write(self, target: Path, content: str) -> None:
        """Write via a temporary file plus ``os.replace``.

        Mirrors :meth:`app.state.journal.TransactionalJournal._atomic_write`. An
        interruption leaves the previous file intact and removes the temporary.
        """
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f".{target.name}.tmp")
        try:
            with temporary.open("w", encoding="utf-8", newline="") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, target)
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise

    def _append(self, target: Path, payload: Mapping[str, Any]) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8", newline="") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())

    @staticmethod
    def _read_jsonl(path: Path) -> List[Dict[str, Any]]:
        if not path.exists():
            return []
        records: List[Dict[str, Any]] = []
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    # A truncated final line from an interrupted append is
                    # skipped rather than aborting the read.
                    continue
        return records

    # ------------------------------------------------------------------
    # seen index
    # ------------------------------------------------------------------

    def load_seen(self) -> Dict[str, Any]:
        if not self.seen_path.exists():
            return {
                "version": SEEN_VERSION,
                "url_keys": {},
                "fingerprints": {},
                "jobs": {},
            }
        raw = self.seen_path.read_text(encoding="utf-8")
        if not raw.strip():
            return {"version": SEEN_VERSION, "url_keys": {}, "fingerprints": {}, "jobs": {}}
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise StoreCorruptError(
                f"{self.seen_path} is corrupt ({exc.msg}); refusing to overwrite it. "
                "Move it aside to start a new index."
            ) from exc
        if not isinstance(data, dict):
            raise StoreCorruptError(f"{self.seen_path} is corrupt: expected a JSON object")
        data.setdefault("version", SEEN_VERSION)
        for key in ("url_keys", "fingerprints", "jobs"):
            if not isinstance(data.get(key), dict):
                raise StoreCorruptError(f"{self.seen_path} is corrupt: '{key}' must be an object")
        return data

    def _write_seen(self, seen: Mapping[str, Any]) -> None:
        self._atomic_write(self.seen_path, json.dumps(seen, indent=2, sort_keys=True) + "\n")

    # ------------------------------------------------------------------
    # reading
    # ------------------------------------------------------------------

    def load_jobs(self) -> List[Dict[str, Any]]:
        """Fold the append-only log into one canonical record per job.

        The last line for a given ``job_id`` wins, because a re-sighting of the
        same URL appends an updated record rather than editing the original.
        """
        canonical: Dict[str, Dict[str, Any]] = {}
        for record in self._read_jsonl(self.jobs_path):
            job_id = record.get("job_id")
            if job_id:
                canonical[job_id] = record
        return list(canonical.values())

    def load_rejected(self) -> List[Dict[str, Any]]:
        return self._read_jsonl(self.rejected_path)

    def load_runs(self) -> List[Dict[str, Any]]:
        return self._read_jsonl(self.runs_path)

    # ------------------------------------------------------------------
    # writing
    # ------------------------------------------------------------------

    @staticmethod
    def _merge_payload(existing: Mapping[str, Any], incoming: Mapping[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
        """Keep the more complete value per field; never blank a populated field.

        Returns the merged payload and the names of fields where both sides
        held a non-empty but different value, so the conflict is recorded
        rather than silently resolved.
        """
        merged: Dict[str, Any] = {}
        conflicts: List[str] = []
        for key in Job.__dataclass_fields__:
            old = existing.get(key)
            new = incoming.get(key)
            if _populated(old):
                merged[key] = old
                if _populated(new) and new != old:
                    conflicts.append(key)
            else:
                merged[key] = new
        return merged, conflicts

    @staticmethod
    def _merge_sources(
        existing: Sequence[Mapping[str, Any]], incoming: Mapping[str, Any]
    ) -> List[Dict[str, Any]]:
        """Union source provenance. Later sightings add; they never replace.

        Keyed on ``(source, url)`` rather than url alone, so two different
        sources reporting the same vacancy URL are both preserved - that is the
        whole point of keeping provenance.
        """
        def key_of(entry: Mapping[str, Any]) -> str:
            return f"{entry.get('source', '')}|{entry.get('url', '')}"

        merged: Dict[str, Dict[str, Any]] = {key_of(entry): dict(entry) for entry in existing}
        key = key_of(incoming)
        if key in merged:
            previous = merged[key]
            merged[key] = {**previous, "last_seen": incoming.get("last_seen", previous.get("last_seen"))}
        else:
            merged[key] = dict(incoming)
        return list(merged.values())

    def store(
        self,
        records: Iterable[Mapping[str, Any]],
        *,
        source: str,
        observed_at: Optional[str] = None,
    ) -> StoreResult:
        """Persist ``records`` discovered from ``source``.

        Records too incomplete to store are quarantined in
        ``data/rejected.jsonl`` with a reason; they never raise and never stop
        the run. Re-seeing a URL appends an updated record preserving
        ``first_seen`` and unioning sources. A fingerprint match only sets
        ``possible_duplicate`` - it never merges.

        Write ordering is deliberate: the append-only log is written *before*
        the index. If the index write then fails, the log holds a record the
        index does not know about - recoverable, because the index is derived
        and can be rebuilt from the log. The reverse order would leave the
        index pointing at a record that does not exist.
        """
        seen = self.load_seen()
        result = StoreResult()
        moment = observed_at or _utcnow()

        for raw in records:
            if not isinstance(raw, Mapping):
                self._quarantine(raw, reason="record is not a mapping", source=source, observed_at=moment)
                result.rejected += 1
                continue

            missing = [
                field_name
                for field_name in _REQUIRED_FIELDS
                if not str(raw.get(field_name) or "").strip()
            ]
            if missing:
                self._quarantine(
                    raw,
                    reason=f"missing required field(s): {', '.join(missing)}",
                    source=source,
                    observed_at=moment,
                )
                result.rejected += 1
                continue

            url_key = normalize_url(str(raw["url"]))
            if not url_key:
                self._quarantine(
                    raw, reason="url could not be normalized", source=source, observed_at=moment
                )
                result.rejected += 1
                continue

            job_id = _derive_job_id(raw, url_key)
            print_fingerprint = fingerprint(str(raw["company"]), str(raw["title"]))
            provenance = {
                "source": source,
                "url": str(raw["url"]),
                "first_seen": moment,
                "last_seen": moment,
            }

            existing_id = seen["url_keys"].get(url_key)
            if existing_id and existing_id in seen["jobs"]:
                previous = seen["jobs"][existing_id]
                payload, conflicts = self._merge_payload(previous.get("job", {}), _job_fields(raw))
                sources = self._merge_sources(previous.get("sources", []), provenance)
                record = {
                    "record_version": RECORD_VERSION,
                    "job_id": existing_id,
                    "identity": {
                        "url_key": url_key,
                        "fingerprint": print_fingerprint,
                    },
                    "first_seen": previous.get("first_seen", moment),
                    "last_seen": moment,
                    "updated_at": moment,
                    "was_updated": True,
                    "update_count": int(previous.get("update_count", 0)) + 1,
                    "field_conflicts": conflicts,
                    "possible_duplicate": False,
                    "duplicate_of": [],
                    "sources": sources,
                    "job": payload,
                }
                result.updated += 1
            else:
                duplicates = [
                    other
                    for other in seen["fingerprints"].get(print_fingerprint, [])
                    if other != job_id
                ]
                record = {
                    "record_version": RECORD_VERSION,
                    "job_id": job_id,
                    "identity": {
                        "url_key": url_key,
                        "fingerprint": print_fingerprint,
                    },
                    "first_seen": moment,
                    "last_seen": moment,
                    "updated_at": None,
                    "was_updated": False,
                    "update_count": 0,
                    "field_conflicts": [],
                    "possible_duplicate": bool(duplicates),
                    "duplicate_of": duplicates,
                    "sources": [provenance],
                    "job": _job_fields(raw),
                }
                result.stored += 1
                if duplicates:
                    result.possible_duplicates += 1

            self._append(self.jobs_path, record)

            seen["jobs"][record["job_id"]] = {
                "first_seen": record["first_seen"],
                "last_seen": record["last_seen"],
                "update_count": record["update_count"],
                "possible_duplicate": record["possible_duplicate"],
                "duplicate_of": record["duplicate_of"],
                "sources": record["sources"],
                "job": record["job"],
            }
            seen["url_keys"][url_key] = record["job_id"]
            seen["fingerprints"].setdefault(print_fingerprint, [])
            if record["job_id"] not in seen["fingerprints"][print_fingerprint]:
                seen["fingerprints"][print_fingerprint].append(record["job_id"])

        if result.stored or result.updated:
            self._write_seen(seen)
        return result

    def _quarantine(
        self, raw: Any, *, reason: str, source: str, observed_at: str
    ) -> None:
        self._append(
            self.rejected_path,
            {
                "rejected_at": observed_at,
                "source": source,
                "reason": reason,
                "record": raw if isinstance(raw, (dict, list)) else repr(raw),
            },
        )

    def record_run(self, run: RunRecord) -> Dict[str, Any]:
        """Append one discovery run to ``data/runs.jsonl``."""
        payload = run.to_dict()
        self._append(self.runs_path, payload)
        return payload

    def failed_source(
        self, name: str, error: BaseException | str, *, duration_ms: int = 0
    ) -> SourceOutcome:
        """Build a failure outcome, distinct from a zero-result source."""
        message = f"{type(error).__name__}: {error}" if isinstance(error, BaseException) else str(error)
        return SourceOutcome(
            name=name,
            ok=False,
            fetched=0,
            stored=0,
            updated=0,
            rejected=0,
            error=message,
            duration_ms=duration_ms,
        )

    def ensure_dir(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)


def empty_run(run_id: str) -> RunRecord:
    """A run with no sources yet - valid, and recorded as such."""
    return RunRecord(run_id=run_id)

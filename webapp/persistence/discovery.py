from __future__ import annotations

import json
import sqlite3
import unicodedata
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from product.job_ingestion import validate_job_source_record


USER_STATUSES = {"new", "saved", "dismissed", "expired"}
ALL_STATUSES = USER_STATUSES | {"promoted"}


class DiscoveryLifecycleError(ValueError):
    pass


class DiscoveryIdentityConflictError(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalized_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()


def _canonical_url(value: str) -> str:
    parsed = urlsplit(unicodedata.normalize("NFKC", value.strip()))
    scheme = parsed.scheme.casefold()
    hostname = (parsed.hostname or "").casefold()
    port = parsed.port
    if port is not None and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
        hostname = f"{hostname}:{port}"
    path = parsed.path.rstrip("/") or "/"
    return urlunsplit((scheme, hostname, path, parsed.query, ""))


def discovery_identity_keys(record: dict[str, Any]) -> list[tuple[str, str]]:
    keys: list[tuple[str, str]] = []
    if record.get("source_record_id"):
        keys.append(
            (
                "source_record",
                "source:" + _normalized_text(record["source"]) + ":" + _normalized_text(record["source_record_id"]),
            )
        )
    if record.get("source_url"):
        keys.append(("canonical_url", "url:" + _canonical_url(record["source_url"])))
    fallback = "\x1f".join(
        _normalized_text(record.get(field, ""))
        for field in ("company", "title", "location")
    )
    keys.append(("normalized_fallback", "fallback:" + fallback))
    return keys


def _candidate_id_for_keys(
    conn: sqlite3.Connection, keys: list[tuple[str, str]]
) -> str | None:
    placeholders = ",".join("?" for _ in keys)
    rows = conn.execute(
        f"SELECT DISTINCT candidate_id FROM discovery_candidate_keys WHERE identity_key IN ({placeholders})",
        tuple(value for _, value in keys),
    ).fetchall()
    ids = {row["candidate_id"] for row in rows}
    if len(ids) > 1:
        raise DiscoveryIdentityConflictError(
            "source identities resolve to different discovery candidates"
        )
    return next(iter(ids), None)


def ingest_discovery_record(
    conn: sqlite3.Connection,
    source_record: dict[str, Any],
    *,
    run_id: str | None = None,
) -> dict[str, Any]:
    validate_job_source_record(source_record)
    keys = discovery_identity_keys(source_record)
    candidate_id = _candidate_id_for_keys(conn, keys)
    now = _now()
    if candidate_id is None:
        candidate_id = f"disc_{uuid.uuid4().hex[:20]}"
        conn.execute(
            "INSERT INTO discovery_candidates "
            "(id, company, title, location, lifecycle_status, canonical_occurrence_id, "
            "promoted_workspace_id, first_seen_at, last_seen_at, updated_at) "
            "VALUES (?, ?, ?, ?, 'new', NULL, NULL, ?, ?, ?)",
            (
                candidate_id,
                source_record["company"],
                source_record["title"],
                source_record.get("location"),
                source_record["captured_at"],
                source_record["captured_at"],
                now,
            ),
        )
    occurrence_id = f"occ_{uuid.uuid4().hex[:20]}"
    conn.execute(
        "INSERT INTO discovery_occurrences "
        "(id, candidate_id, run_id, source, source_record_id, source_url, source_record_json, "
        "captured_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            occurrence_id,
            candidate_id,
            run_id,
            source_record["source"],
            source_record.get("source_record_id"),
            source_record.get("source_url"),
            json.dumps(source_record, ensure_ascii=False, sort_keys=True),
            source_record["captured_at"],
            now,
        ),
    )
    for key_type, identity_key in keys:
        try:
            conn.execute(
                "INSERT INTO discovery_candidate_keys (identity_key, candidate_id, key_type) VALUES (?, ?, ?)",
                (identity_key, candidate_id, key_type),
            )
        except sqlite3.IntegrityError:
            owner = conn.execute(
                "SELECT candidate_id FROM discovery_candidate_keys WHERE identity_key = ?",
                (identity_key,),
            ).fetchone()
            if owner is None or owner["candidate_id"] != candidate_id:
                conn.rollback()
                raise DiscoveryIdentityConflictError(
                    "a source identity was concurrently assigned to another candidate"
                )
    current = conn.execute(
        "SELECT canonical_occurrence_id FROM discovery_candidates WHERE id = ?", (candidate_id,)
    ).fetchone()
    if current["canonical_occurrence_id"] is None or _occurrence_quality(source_record) >= _canonical_quality(conn, current["canonical_occurrence_id"]):
        canonical_occurrence_id = occurrence_id
    else:
        canonical_occurrence_id = current["canonical_occurrence_id"]
    conn.execute(
        "UPDATE discovery_candidates SET last_seen_at = ?, updated_at = ?, canonical_occurrence_id = ? WHERE id = ?",
        (source_record["captured_at"], now, canonical_occurrence_id, candidate_id),
    )
    conn.commit()
    return {"candidate": get_discovery_candidate(conn, candidate_id), "occurrence_id": occurrence_id}


def _occurrence_quality(record: dict[str, Any]) -> tuple[int, int]:
    prose = record.get("raw_text") or record.get("description") or ""
    structured = sum(len(record.get(field, [])) for field in (
        "requirements", "responsibilities", "language_requirements",
        "eligibility_requirements", "logistics_requirements",
    ))
    return (structured, len(prose))


def _canonical_quality(conn: sqlite3.Connection, occurrence_id: str) -> tuple[int, int]:
    row = conn.execute(
        "SELECT source_record_json FROM discovery_occurrences WHERE id = ?", (occurrence_id,)
    ).fetchone()
    return _occurrence_quality(json.loads(row["source_record_json"])) if row else (-1, -1)


def get_discovery_candidate(
    conn: sqlite3.Connection, candidate_id: str
) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT c.*, COUNT(o.id) AS occurrence_count "
        "FROM discovery_candidates c LEFT JOIN discovery_occurrences o ON o.candidate_id = c.id "
        "WHERE c.id = ? GROUP BY c.id",
        (candidate_id,),
    ).fetchone()
    if row is None:
        return None
    output = dict(row)
    occurrence = conn.execute(
        "SELECT source_record_json FROM discovery_occurrences WHERE id = ?",
        (output["canonical_occurrence_id"],),
    ).fetchone()
    output["canonical_source_record"] = json.loads(occurrence["source_record_json"])
    return output


def list_discovery_candidates(
    conn: sqlite3.Connection, *, lifecycle_status: str | None = None
) -> list[dict[str, Any]]:
    if lifecycle_status is not None and lifecycle_status not in ALL_STATUSES:
        raise DiscoveryLifecycleError(f"unsupported lifecycle status {lifecycle_status!r}")
    if lifecycle_status is None:
        rows = conn.execute(
            "SELECT id FROM discovery_candidates ORDER BY updated_at DESC, id DESC"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id FROM discovery_candidates WHERE lifecycle_status = ? ORDER BY updated_at DESC, id DESC",
            (lifecycle_status,),
        ).fetchall()
    return [get_discovery_candidate(conn, row["id"]) for row in rows]


def set_discovery_candidate_status(
    conn: sqlite3.Connection, candidate_id: str, status: str
) -> dict[str, Any]:
    if status == "promoted":
        raise DiscoveryLifecycleError("promoted status is assigned only by the promotion service")
    if status not in USER_STATUSES:
        raise DiscoveryLifecycleError(f"unsupported lifecycle status {status!r}")
    candidate = get_discovery_candidate(conn, candidate_id)
    if candidate is None:
        raise DiscoveryLifecycleError(f"unknown discovery candidate {candidate_id!r}")
    if candidate["lifecycle_status"] == "promoted":
        raise DiscoveryLifecycleError("a promoted candidate is terminal")
    if status == "new" and candidate["lifecycle_status"] not in {"dismissed", "expired", "new"}:
        raise DiscoveryLifecycleError("only dismissed or expired candidates may be resurfaced")
    conn.execute(
        "UPDATE discovery_candidates SET lifecycle_status = ?, updated_at = ? WHERE id = ?",
        (status, _now(), candidate_id),
    )
    conn.commit()
    return get_discovery_candidate(conn, candidate_id)


def create_discovery_run(
    conn: sqlite3.Connection,
    *,
    user_profile_version_id: str,
    user_profile_content_id: str,
    request: dict[str, Any],
) -> dict[str, Any]:
    run_id = f"dsrun_{uuid.uuid4().hex[:20]}"
    now = _now()
    conn.execute(
        "INSERT INTO discovery_runs "
        "(id, user_profile_version_id, user_profile_content_id, request_json, source_status_json, "
        "status, created_at, completed_at) VALUES (?, ?, ?, ?, '{}', 'running', ?, NULL)",
        (
            run_id,
            user_profile_version_id,
            user_profile_content_id,
            json.dumps(request, ensure_ascii=False, sort_keys=True),
            now,
        ),
    )
    conn.commit()
    return get_discovery_run(conn, run_id)


def complete_discovery_run(
    conn: sqlite3.Connection,
    run_id: str,
    *,
    source_status: dict[str, Any],
    status: str,
) -> dict[str, Any]:
    if status not in {"completed", "partial", "failed"}:
        raise ValueError("discovery run status must be completed, partial, or failed")
    conn.execute(
        "UPDATE discovery_runs SET source_status_json = ?, status = ?, completed_at = ? WHERE id = ?",
        (json.dumps(source_status, ensure_ascii=False, sort_keys=True), status, _now(), run_id),
    )
    if conn.total_changes == 0:
        raise ValueError(f"unknown discovery run {run_id!r}")
    conn.commit()
    return get_discovery_run(conn, run_id)


def get_discovery_run(conn: sqlite3.Connection, run_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM discovery_runs WHERE id = ?", (run_id,)).fetchone()
    if row is None:
        return None
    output = dict(row)
    output["request"] = json.loads(output.pop("request_json"))
    output["source_status"] = json.loads(output.pop("source_status_json"))
    return output


def get_latest_discovery_run(conn: sqlite3.Connection) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT id FROM discovery_runs ORDER BY created_at DESC, id DESC LIMIT 1"
    ).fetchone()
    return get_discovery_run(conn, row["id"]) if row else None


def save_discovery_fit(
    conn: sqlite3.Connection,
    *,
    candidate_id: str,
    occurrence_id: str,
    request: dict[str, Any],
    result: dict[str, Any],
    fingerprints: dict[str, str],
) -> dict[str, Any]:
    fit_id = f"dsfit_{uuid.uuid4().hex[:20]}"
    conn.execute(
        "INSERT INTO discovery_fit_results "
        "(id, candidate_id, occurrence_id, request_json, result_json, fingerprints_json, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            fit_id,
            candidate_id,
            occurrence_id,
            json.dumps(request, ensure_ascii=False, sort_keys=True),
            json.dumps(result, ensure_ascii=False, sort_keys=True),
            json.dumps(fingerprints, ensure_ascii=False, sort_keys=True),
            _now(),
        ),
    )
    conn.execute(
        "INSERT INTO current_discovery_fits (candidate_id, fit_id) VALUES (?, ?) "
        "ON CONFLICT(candidate_id) DO UPDATE SET fit_id=excluded.fit_id",
        (candidate_id, fit_id),
    )
    conn.commit()
    return get_current_discovery_fit(conn, candidate_id)


def get_current_discovery_fit(
    conn: sqlite3.Connection, candidate_id: str
) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT f.* FROM current_discovery_fits c JOIN discovery_fit_results f ON f.id = c.fit_id "
        "WHERE c.candidate_id = ?",
        (candidate_id,),
    ).fetchone()
    if row is None:
        return None
    output = dict(row)
    for field in ("request", "result", "fingerprints"):
        output[field] = json.loads(output.pop(f"{field}_json"))
    return output

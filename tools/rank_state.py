#!/usr/bin/env python3
"""State helper for /rank: select candidates and write results back.

/rank reads the whole of seen_jobs.json into the model's context to filter it
by eye (Step 1), then re-emits the whole file to record scores (Step 4). That
cost is paid on every run regardless of how many jobs are actually scored, and
it grows for the life of the workspace, since seen_jobs.json is append-only by
design and most stored entries are `skipped`.

This moves the state-file traffic into code. Four subcommands:

  candidates   select the eligible entries for this run and project only the
               fields a scoring agent needs
  sweep        rule 6's expiry pass over entries this run did not re-score -
               a stored-date comparison, no fetch, no agent
  apply        write scoring results back to seen_jobs.json and print the
               ranked/vetoed/expired rows Step 5's report is built from
  shortlist    the apply-ready queue: ranked, live, untracked jobs ordered by
               rank_score/rank_verdict (never the stale scraper fit), each
               classified by apply_status and profile-staleness

Selection and projection follow Step 1's existing rules exactly (status
filter, tracker exclusion, focus filter, `--limit`/`--all`); the write-back
follows Step 4's existing rules exactly (the `location` -> `location_verdict`
legacy migration, the deadline null-is-not-a-correction rule, verbatim
strengths/gaps persistence, idempotent skip of already-ranked entries); the
sweep follows rule 6 exactly (defensive date parsing, an absent deadline left
alone, `--all` making a retired entry revivable).

The apply-ready queue (shortlist) closes the gap where a finished ranking left
only scattered state behind: each entry carries an `apply_status`
(ready / needs-clarification / hold / expired) derived from stored gate data,
and a `stale_profile` flag when its stored profile hash no longer matches the
current candidate profile - so a profile change invalidates old scores instead
of letting them masquerade as current.

Nothing here fetches a posting or judges a fit. Scoring stays with the model;
this only removes the state file from the conversation.

Usage:
  python3 tools/rank_state.py candidates [--all] [--focus TEXT] [--limit N]
  python3 tools/rank_state.py sweep [--write] [--exclude KEY,KEY]
  python3 tools/rank_state.py apply --results results.json [--profile-hash HEX] [--dry-run]
  python3 tools/rank_state.py shortlist [--top N] [--min-score N] [--json]

All subcommands print JSON on stdout. Exit 0 on success, 1 on a usage or
state error, or on `apply` when any result could not be written.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "job_scraper" / "seen_jobs.json"
TRACKER = ROOT / "job_search_tracker.csv"
PROFILE = ROOT / ".claude" / "skills" / "job-application-assistant" / "01-candidate-profile.md"

# 04-job-evaluation.md
WEIGHTS = {"technical": 0.30, "experience": 0.25, "behavioral": 0.15, "career": 0.30}
BANDS = ((75, "Strong Fit"), (60, "Good Fit"), (45, "Moderate Fit"), (30, "Weak Fit"), (0, "Poor Fit"))

DEFAULT_LIMIT = 10
DEFAULT_TOP = 5
URGENT_DAYS = 7
STALE_DAYS = 30
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def load_state(path: Path) -> tuple[dict, dict]:
    """Return (document, seen-map). The map is mutated in place by callers."""
    if not path.is_file():
        sys.exit(f"{path} not found - run /scrape first")
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        sys.exit(f"{path} is not valid JSON: {exc}")
    seen = doc.get("seen") if isinstance(doc, dict) and "seen" in doc else doc
    if not isinstance(seen, dict):
        sys.exit(f"{path}: expected an object of job entries")
    return doc, seen


def save_state(path: Path, doc: dict) -> None:
    """Atomic replace: a half-written seen_jobs.json loses the scrape history."""
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".seen_jobs.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def parse_iso(value) -> date | None:
    """Rule 6's defensive-parse rule: anything that is not YYYY-MM-DD is treated
    exactly like an absent value - never compared, never guessed at."""
    if not isinstance(value, str) or not ISO.match(value.strip()):
        return None
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        return None


def norm(text) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text or "").lower())


def profile_hash() -> str:
    """SHA-256 of the canonical candidate profile, for rank-run stamping.

    Improvement #6: ranking results are valid only against the profile they
    were scored with. `apply` records this hash per entry; `shortlist` flags
    entries whose stored hash no longer matches. A missing profile file yields
    a stable digest of the empty string rather than an error - ranking is a
    triage step and must not hard-fail on a missing optional file.
    """
    try:
        data = PROFILE.read_bytes()
    except OSError:
        data = b""
    return hashlib.sha256(data).hexdigest()[:16]


def tracker_pairs(path: Path) -> set[tuple[str, str]]:
    """company+role pairs already in the tracker - out of scope for ranking."""
    if not path.is_file():
        return set()
    import csv

    pairs = set()
    with path.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            company, role = norm(row.get("company")), norm(row.get("role"))
            if company:
                pairs.add((company, role))
    return pairs


def entry_location_verdict(entry: dict) -> str | None:
    """location_verdict, falling back to a legacy verdict stored under `location`
    (Step 4: "an entry ranked before this rename may carry a legacy PASS/FAIL/
    FLAG string in `location`")."""
    verdict = entry.get("location_verdict")
    if verdict:
        return verdict
    legacy = entry.get("location")
    return legacy if legacy in ("PASS", "FAIL", "FLAG") else None


def cmd_candidates(args) -> int:
    _, seen = load_state(args.state)
    excluded = tracker_pairs(args.tracker)

    selected, skipped_tracker = [], 0
    for key, entry in seen.items():
        status = entry.get("status")
        if args.all:
            if status == "skipped":
                continue
        elif status != "new":
            continue
        if (norm(entry.get("company")), norm(entry.get("title"))) in excluded:
            skipped_tracker += 1
            continue
        if args.focus:
            haystack = " ".join(
                [str(entry.get("title") or ""), str(entry.get("company") or "")]
                + [str(b) for b in entry.get("strengths") or []]
                + [str(b) for b in entry.get("gaps") or []]
            ).lower()
            if args.focus.lower() not in haystack:
                continue
        selected.append(
            {
                "key": key,
                "title": entry.get("title"),
                "company": entry.get("company"),
                "url": entry.get("url"),
                "portal": entry.get("portal"),
                "deadline": entry.get("deadline"),
                "posted_date": entry.get("posted_date"),
            }
        )

    eligible = len(selected)
    if args.limit > 0:
        selected = selected[: args.limit]
    print(
        json.dumps(
            {
                "eligible": eligible,
                "selected": selected,
                "deferred": max(0, eligible - len(selected)),
                "excluded_by_tracker": skipped_tracker,
                "total_entries": len(seen),
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    return 0


def cmd_sweep(args) -> int:
    doc, seen = load_state(args.state)
    today = args.today
    exclude = {k for k in (args.exclude or "").split(",") if k}

    expired, closing, unparseable, checked = [], [], [], 0
    for key, entry in seen.items():
        if entry.get("status") != "ranked" or key in exclude:
            continue
        checked += 1
        raw = entry.get("deadline")
        if raw in (None, ""):
            continue
        parsed = parse_iso(raw)
        if parsed is None:
            unparseable.append({"key": key, "portal": entry.get("portal"), "deadline": raw})
            continue
        row = {
            "key": key,
            "title": entry.get("title"),
            "company": entry.get("company"),
            "url": entry.get("url"),
            "deadline": raw,
        }
        if parsed < today:
            expired.append(row)
        elif (parsed - today).days <= URGENT_DAYS:
            closing.append(row)

    if args.write and expired:
        for row in expired:
            seen[row["key"]]["status"] = "expired"
        save_state(args.state, doc)

    print(
        json.dumps(
            {
                "swept": checked,
                "newly_expired": expired,
                "closing_soon": sorted(closing, key=lambda r: r["deadline"]),
                "unparseable_deadlines": unparseable,
                "written": bool(args.write and expired),
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    return 0


def overall_score(scores: dict) -> int:
    total = 0.0
    for dim, weight in WEIGHTS.items():
        value = scores.get(dim)
        if not isinstance(value, (int, float)):
            raise ValueError(f"missing or non-numeric score '{dim}'")
        total += float(value) * weight
    return int(total + 0.5)


def band(score: int) -> str:
    for floor, name in BANDS:
        if score >= floor:
            return name
    return "Poor Fit"


def cmd_apply(args) -> int:
    doc, seen = load_state(args.state)
    today = args.today
    try:
        results = json.loads(Path(args.results).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        sys.exit(f"cannot read results file {args.results}: {exc}")
    if isinstance(results, dict):
        results = results.get("results", [])
    if not isinstance(results, list):
        sys.exit("results file must be a JSON array of scoring objects")

    rows, expired, errors = [], [], []
    for result in results:
        key = result.get("key")
        entry = seen.get(key)
        if entry is None:
            errors.append({"key": key, "error": "no such key in seen_jobs.json"})
            continue

        if result.get("status") == "expired":
            entry["status"] = "expired"
            expired.append(
                {"key": key, "title": entry.get("title"), "company": entry.get("company"), "url": entry.get("url")}
            )
            continue

        try:
            score = overall_score(result.get("scores") or {})
        except ValueError as exc:
            errors.append({"key": key, "error": str(exc)})
            continue

        legacy = entry_location_verdict(entry)
        if entry.get("location") in ("PASS", "FAIL", "FLAG"):
            entry.pop("location", None)  # legacy verdict, never a place
        entry["status"] = "ranked"
        entry["rank_score"] = score
        entry["rank_verdict"] = band(score)
        entry["rank_date"] = today.isoformat()
        entry["profile_hash"] = args.profile_hash or profile_hash()
        entry["location_verdict"] = result.get("location_verdict") or legacy or "PASS"
        entry["language_gate"] = result.get("language_gate") or "PASS"
        if entry["language_gate"] == "PASS":
            entry.pop("language_note", None)
        else:
            entry["language_note"] = result.get("language_note")
        # Absence is not a correction: a fetch that degraded to a listing page
        # returns no deadline, and blanking a stored one would erase a real
        # date and make the entry immortal to rule 6's sweep.
        if result.get("deadline"):
            entry["deadline"] = result["deadline"]
        for field in ("strengths", "gaps"):
            value = result.get(field)
            if isinstance(value, list):
                entry[field] = [str(b) for b in value][:3]

        parsed = parse_iso(entry.get("deadline"))
        rows.append(
            {
                "key": key,
                "title": entry.get("title"),
                "company": entry.get("company"),
                "location": entry.get("location"),
                "url": entry.get("url"),
                "score": score,
                "verdict": entry["rank_verdict"],
                "location_verdict": entry["location_verdict"],
                "language_gate": entry["language_gate"],
                "language_note": entry.get("language_note"),
                "deadline": entry.get("deadline"),
                "posted_date": entry.get("posted_date"),
                "urgent": bool(parsed and today <= parsed <= today + timedelta(days=URGENT_DAYS)),
                "strengths": entry.get("strengths", []),
                "gaps": entry.get("gaps", []),
            }
        )

    if not args.dry_run:
        save_state(args.state, doc)

    rows.sort(key=lambda r: (r["score"], r["urgent"]), reverse=True)
    veto = lambda r: r["location_verdict"] == "FAIL" or r["language_gate"] == "FAIL"
    vetoed = [r for r in rows if veto(r)]
    ranked = [r for r in rows if not veto(r)]
    print(
        json.dumps(
            {
                "ranked": ranked,
                "vetoed": vetoed,
                "expired": expired,
                "errors": errors,
                "written": not args.dry_run,
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    return 1 if errors else 0


def classify_apply_status(entry: dict, today: date) -> tuple[str, list[str]]:
    """Improvement #2: the apply gate. Returns (status, reasons).

    ready               - no blocking signals; safe to send to /apply
    needs-clarification - compensable gaps the user must answer before applying
                          (salary range absent, work-authorization unknown,
                          seniority unclear, language above declared level)
    hold                - a hard blocker (location or language FAIL veto)
    expired             - past its stored deadline or already expired
    """
    reasons: list[str] = []

    if entry.get("status") == "expired":
        return "expired", ["status is expired"]
    parsed = parse_iso(entry.get("deadline"))
    if parsed is not None and parsed < today:
        return "expired", [f"deadline {entry.get('deadline')} has passed"]

    if entry_location_verdict(entry) == "FAIL":
        reasons.append("location_verdict FAIL")
    if entry.get("language_gate") == "FAIL":
        reasons.append(f"language_gate FAIL: {entry.get('language_note') or 'requirement not declared'}")
    if reasons:
        return "hold", reasons

    if entry_location_verdict(entry) == "FLAG":
        reasons.append("location FLAG - confirm logistics")
    if entry.get("language_gate") == "FLAG":
        reasons.append(f"language FLAG - {entry.get('language_note') or 'requirement above declared level'}")
    if entry.get("salary_range") in (None, "", "undisclosed"):
        reasons.append("no salary range stored - confirm compensation before applying")
    if not entry.get("work_authorization"):
        reasons.append("work-authorization requirement unknown - confirm before applying")
    posted = parse_iso(entry.get("posted_date"))
    if posted is None:
        posted_raw = entry.get("posted_date")
        if posted_raw not in (None, ""):
            reasons.append(f"posted_date {posted_raw!r} unparseable - verify posting age")
    elif (today - posted).days > STALE_DAYS:
        reasons.append(f"posted {(today - posted).days} days ago - verify the role is still open")

    return ("needs-clarification" if reasons else "ready"), reasons


def cmd_shortlist(args) -> int:
    """The apply-ready queue /rank's Step 5 was missing (improvement #1).

    Reads only stored state: no fetch, no agent. Ranked entries only, ordered
    by rank_score descending. Never surfaces the scraper's `fit` field - the
    rank_score/rank_verdict pair written by `apply` is the only score that
    counts here, so scraper-level fit can no longer sit ambiguously next to a
    later 59/"Moderate Fit".
    """
    doc, seen = load_state(args.state)
    excluded = tracker_pairs(args.tracker)
    current_hash = profile_hash()

    items, untracked_skipped = [], 0
    for key, entry in seen.items():
        if entry.get("status") != "ranked":
            continue
        if (norm(entry.get("company")), norm(entry.get("title"))) in excluded:
            untracked_skipped += 1
            continue
        status, reasons = classify_apply_status(entry, args.today)
        stale = entry.get("profile_hash") not in (None, current_hash)
        items.append(
            {
                "key": key,
                "title": entry.get("title"),
                "company": entry.get("company"),
                "url": entry.get("url"),
                "portal": entry.get("portal"),
                "rank_score": entry.get("rank_score"),
                "rank_verdict": entry.get("rank_verdict"),
                "rank_date": entry.get("rank_date"),
                "apply_status": status,
                "reasons": reasons,
                "stale_profile": stale,
                "location_verdict": entry_location_verdict(entry),
                "language_gate": entry.get("language_gate"),
                "language_note": entry.get("language_note"),
                "deadline": entry.get("deadline"),
                "posted_date": entry.get("posted_date"),
                "strengths": entry.get("strengths", []),
                "gaps": entry.get("gaps", []),
            }
        )

    min_score = args.min_score if args.min_score is not None else 0
    items = [i for i in items if isinstance(i["rank_score"], (int, float)) and i["rank_score"] >= min_score]
    items.sort(key=lambda i: (i["rank_score"], i.get("deadline") is not None), reverse=True)
    if args.top is not None and args.top >= 0:
        items = items[: args.top]

    print(
        json.dumps(
            {
                "shortlist": items,
                "generated_for_profile": current_hash,
                "stale_profile_count": sum(1 for i in items if i["stale_profile"]),
                "excluded_by_tracker": untracked_skipped,
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    return 0


def main() -> int:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--state", type=Path, default=STATE)
    common.add_argument("--today", type=date.fromisoformat, default=date.today())

    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="command", required=True)

    cand = sub.add_parser("candidates", parents=[common], help="select the entries to score")
    cand.add_argument("--tracker", type=Path, default=TRACKER)
    cand.add_argument("--all", action="store_true", help="include every non-skipped status")
    cand.add_argument("--focus", help="substring filter over title, company and stored fit notes")
    cand.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="0 for no cap")
    cand.set_defaults(func=cmd_candidates)

    sweep = sub.add_parser("sweep", parents=[common], help="rule 6's expiry pass, no fetch")
    sweep.add_argument("--write", action="store_true", help="persist the expiries")
    sweep.add_argument("--exclude", help="comma-separated keys re-scored this run")
    sweep.set_defaults(func=cmd_sweep)

    app = sub.add_parser("apply", parents=[common], help="write scoring results back and print the ranking")
    app.add_argument("--results", required=True, help="JSON array from the scoring agents")
    app.add_argument("--profile-hash", help="override the profile hash stamped onto ranked entries")
    app.add_argument("--dry-run", action="store_true")
    app.set_defaults(func=cmd_apply)

    short = sub.add_parser("shortlist", parents=[common], help="apply-ready queue from stored rank state")
    short.add_argument("--tracker", type=Path, default=TRACKER)
    short.add_argument("--top", type=int, default=DEFAULT_TOP, help="0 for no cap")
    short.add_argument("--min-score", type=int, default=0, help="drop entries below this rank_score")
    short.set_defaults(func=cmd_shortlist)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
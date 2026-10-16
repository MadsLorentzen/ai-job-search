#!/usr/bin/env python3
"""Write job_scraper/seen_jobs.json out as a spreadsheet the user can open in Excel.

seen_jobs.json stays the source of truth: /scrape dedups against it, /rank and
/outreach read and write it through their tools, and its nested fields
(contacts, strengths, gaps) do not fit a flat table. This export is a read-only
view of it - one row per job, newest first - in the same CSV shape as
job_search_tracker.csv, so jobs can be filtered and searched by hand.

The file is regenerated in full on every run, so edits made to it in Excel are
overwritten. Record decisions through /rank, /apply and /outcome instead.

Usage:
  python3 tools/export_seen_jobs.py                     # defaults below
  python3 tools/export_seen_jobs.py --state job_scraper/seen_jobs.json \
      --out job_scraper/scraped_jobs.csv

Written as UTF-8 with a byte-order mark, so Excel shows accented company names
correctly when the file is double-clicked. Exit 0 on success; exit 2 when the
state file is missing or unreadable.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import tempfile

COLUMNS = [
    "first_seen", "posted_date", "deadline", "company", "title", "location",
    "fit", "status", "rank_score", "rank_verdict", "contact", "portal", "source",
    "url", "key",
]
FIT_ORDER = {"high": 0, "medium": 1, "low": 2}


def contact_cell(contacts) -> str:
    """'Jane Doe (Recruiter) jane@x.com; careers@x.com' - one cell, no line breaks."""
    if not isinstance(contacts, list):
        return ""
    parts = []
    for c in contacts:
        if not isinstance(c, dict):
            continue
        bits = [c.get("name") or "", f"({c['role']})" if c.get("role") else "", c.get("email") or ""]
        text = " ".join(b for b in bits if b).strip()
        if text:
            parts.append(text)
    return "; ".join(parts)


def rows(seen: dict) -> list[dict]:
    out = []
    for key, e in seen.items():
        if not isinstance(e, dict):
            continue
        row = {col: e.get(col) for col in COLUMNS}
        row["key"] = key
        row["contact"] = contact_cell(e.get("contacts"))
        out.append({k: ("" if v is None else str(v)).replace("\r", " ").replace("\n", " ")
                    for k, v in row.items()})
    # Newest first; within a day, best fit first, then company A-Z.
    out.sort(key=lambda r: (r["company"].lower(), r["title"].lower()))
    out.sort(key=lambda r: FIT_ORDER.get(r["fit"].lower(), 3))
    out.sort(key=lambda r: r["first_seen"], reverse=True)
    return out


def export(state_path: str, out_path: str) -> int:
    with open(state_path, encoding="utf-8") as fh:
        data = json.load(fh)
    seen = data.get("seen", {}) if isinstance(data, dict) else {}
    table = rows(seen)
    out_dir = os.path.dirname(os.path.abspath(out_path))
    os.makedirs(out_dir, exist_ok=True)
    # Atomic replace: a half-written file never sits where Excel might open it.
    fd, tmp = tempfile.mkstemp(dir=out_dir, suffix=".csv.tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=COLUMNS)
            w.writeheader()
            w.writerows(table)
        os.replace(tmp, out_path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    return len(table)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--state", default="job_scraper/seen_jobs.json")
    ap.add_argument("--out", default="job_scraper/scraped_jobs.csv")
    args = ap.parse_args(argv)
    try:
        n = export(args.state, args.out)
    except (OSError, ValueError) as exc:
        print(f"export_seen_jobs: {exc}", file=sys.stderr)
        return 2
    print(f"Wrote {n} jobs to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

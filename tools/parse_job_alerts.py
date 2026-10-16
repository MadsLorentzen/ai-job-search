#!/usr/bin/env python3
"""Turn job-alert emails (LinkedIn, Indeed) into job records for /scrape.

The user's LinkedIn and Indeed saved-search alerts arrive in Gmail. LinkedIn's
own matching sees jobs our searches miss, so `/scrape` reads those emails
through the Gmail connector (`get_thread`, PLAIN_TEXT format), saves the
responses as JSON, and runs this parser on them.

Recognised senders:
  jobalerts-noreply@linkedin.com   saved-search digests (several jobs each)
  jobs-noreply@linkedin.com        "jobs picked for you", "X is hiring"
  donotreply@match.indeed.com      Indeed "your background could be a match"
  alert@indeed.com / *@indeed.com  Indeed saved-search alerts

Skipped: application-status emails ("your application was sent/viewed"),
newsletters, and anything else without a job block.

Each record: source, title, company, location, linkedin_id (LinkedIn only),
url (a clean public posting URL for LinkedIn; null for Indeed, whose links are
tracking redirects that are never fetched), email_date, message_id, alert.

Usage:
  python3 tools/parse_job_alerts.py <gmail-json> [<gmail-json> ...] [--seen state.json]
Input files hold one get_thread/get_message response, or a list of them.
`--seen` skips message ids already processed and appends the new ones.
Prints {"jobs": [...], "messages": n, "skipped": n}. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

LI_JOB = re.compile(r"linkedin\.com/(?:comm/)?jobs/view/(\d{6,})")
SKIP_SUBJECT = re.compile(r"application was (sent|viewed)|your application|newsletter|profile views|connections", re.I)
NOISE_LINE = re.compile(
    r"^(\d+ (company|school) alum(ni)?|fast growing|actively recruiting|apply with resume.*|easy apply|promoted|"
    r"be an early applicant|\d+ connections?|your profile matches.*|top applicant|work setting:.*|"
    r"€[\d,.k–\-\s/a-z]+|\$[\d,.k–\-\s/a-z]+)$", re.I)


def messages_from(obj) -> list[dict]:
    """Accept a thread, a message, or a list of either."""
    if isinstance(obj, list):
        return [m for o in obj for m in messages_from(o)]
    if not isinstance(obj, dict):
        return []
    if "messages" in obj:
        return [m for m in obj["messages"] if isinstance(m, dict)]
    if "plaintextBody" in obj or "plaintext_body" in obj:
        return [obj]
    return []


def body_of(m: dict) -> str:
    return m.get("plaintextBody") or m.get("plaintext_body") or ""


def clean_lines(block: str) -> list[str]:
    out = []
    for line in block.splitlines():
        line = line.strip()
        if not line or line.startswith("View job:") or line.startswith("http") or line.startswith("-----"):
            continue
        if NOISE_LINE.match(line):
            continue
        out.append(line)
    return out


def parse_linkedin(m: dict) -> list[dict]:
    body = body_of(m)
    alert = None
    am = re.search(r"Your job alert for (.+?)\n", body)
    if am:
        alert = am.group(1).strip()
    jobs = []
    # Each job card ends with its "View job:" link; the lines before it (after
    # the previous card's separator) are title, company, location, badges.
    parts = re.split(r"\n-{10,}\n", body)
    for part in parts:
        idm = LI_JOB.search(part)
        if not idm:
            continue
        head = part[: part.find("View job:")] if "View job:" in part else part[: idm.start()]
        lines = clean_lines(head)
        # drop alert headers that sit above the first card
        lines = [l for l in lines if not re.match(r"(Your job alert for|\d+ new jobs? match|Hi |Mohit|See your latest|View jobs in)", l)]
        if len(lines) < 2:
            continue
        title, company = lines[0], lines[1]
        location = lines[2] if len(lines) > 2 else None
        jid = idm.group(1)
        jobs.append({"source": "linkedin-alert", "title": title, "company": company, "location": location,
                     "linkedin_id": jid, "url": f"https://www.linkedin.com/jobs/view/{jid}/",
                     "alert": alert})
    return jobs


def parse_indeed(m: dict) -> list[dict]:
    body = body_of(m)
    # Match emails: "...match for this <Title> role...\n\n<Title>\n<Company>\n<Location>\n"
    lines = clean_lines(body.split("View job:")[0]) if "View job:" in body else []
    lines = [l for l in lines if not re.match(r"(Hi |It looks like|Please submit)", l)]
    if len(lines) >= 2:
        return [{"source": "indeed-alert", "title": lines[0], "company": lines[1],
                 "location": lines[2] if len(lines) > 2 else None, "linkedin_id": None, "url": None, "alert": None}]
    sm = re.match(r"(.+?) @ (.+)$", m.get("subject", ""))
    if sm:
        return [{"source": "indeed-alert", "title": sm.group(1).strip(), "company": sm.group(2).strip(),
                 "location": None, "linkedin_id": None, "url": None, "alert": None}]
    return []


def parse_message(m: dict) -> list[dict]:
    sender = (m.get("sender") or "").lower()
    if SKIP_SUBJECT.search(m.get("subject") or ""):
        return []
    if "linkedin.com" in sender and "newsletter" not in sender:
        jobs = parse_linkedin(m)
    elif "indeed.com" in sender:
        jobs = parse_indeed(m)
    else:
        return []
    for j in jobs:
        j["email_date"] = (m.get("date") or "")[:10] or None
        j["message_id"] = m.get("id")
    return jobs


def dedupe(jobs: list[dict]) -> list[dict]:
    seen, out = set(), []
    for j in jobs:
        key = j["linkedin_id"] or (j["company"].lower(), j["title"].lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(j)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("files", nargs="+")
    ap.add_argument("--seen", help="JSON state file of processed Gmail message ids")
    a = ap.parse_args(argv)
    state_path = Path(a.seen) if a.seen else None
    done = set(json.loads(state_path.read_text()).get("processed", [])) if state_path and state_path.exists() else set()
    msgs = []
    for f in a.files:
        try:
            msgs += messages_from(json.loads(Path(f).read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError) as e:
            print(json.dumps({"error": f"{f}: {e}"}), file=sys.stderr)
            return 2
    fresh = [m for m in msgs if m.get("id") not in done]
    jobs = dedupe([j for m in fresh for j in parse_message(m)])
    if state_path:
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps({"processed": sorted(done | {m.get("id") for m in fresh if m.get("id")})}, indent=1))
    print(json.dumps({"jobs": jobs, "messages": len(fresh), "skipped": len(msgs) - len(fresh)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

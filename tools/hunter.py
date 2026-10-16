#!/usr/bin/env python3
"""Find and verify recruiter email addresses with the Hunter.io API.

`/outreach daily` uses this to find recruiters at a target company when no
address is published in the posting or on the employer's site. Every address
it returns carries Hunter's confidence score, its sources (pages where Hunter
saw it published, if any) and a verification status, so the caller can tell a
published address from a pattern-based guess and decide what is safe to send.

  domain   recruiting/HR people at a company domain   (1 credit per email found)
  find     one named person's address at a domain      (1 credit if found)
  verify   check an address is deliverable             (0.5 credit)
  account  credits used / available this month         (free)

Prints JSON. The key comes only from HUNTER_API_KEY (never a flag, never a
file in the repo). Exit 0 on success, 1 on an API error, 2 on bad input or a
missing key. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.hunter.io/v2"
# Words in a job title that mark someone who hires. Domain search filters by
# Hunter's own department labels first; this keeps people whose title says so.
RECRUITING_TITLE = re.compile(
    r"recruit|talent|acquisition|resourcing|people partner|hr business partner|human resources|hiring", re.I)


class HunterError(Exception):
    def __init__(self, msg: str, code: str = "API_ERROR"):
        super().__init__(msg)
        self.code = code


def key(env=os.environ) -> str:
    k = (env.get("HUNTER_API_KEY") or "").strip()
    if not k:
        raise HunterError("set HUNTER_API_KEY (export it in ~/.zshenv)", "MISSING_CREDENTIALS")
    return k


def call(path: str, params: dict, api_key: str) -> dict:
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v not in (None, "")})
    req = urllib.request.Request(f"{BASE}/{path}?{q}", headers={"X-API-KEY": api_key, "User-Agent": "ai-job-search-hunter/1.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                if r.status == 202:  # verification still running: poll the same call
                    time.sleep(3)
                    continue
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:300]
            if e.code == 429 and attempt < 3:
                time.sleep(2 ** attempt)
                continue
            if e.code in (401, 403):
                raise HunterError(f"Hunter rejected the key (HTTP {e.code})", "BAD_CREDENTIALS")
            if e.code == 402 or "usage" in body.lower():
                raise HunterError("Hunter credits used up for this month", "QUOTA_EXCEEDED")
            raise HunterError(f"HTTP {e.code}: {body}")
    raise HunterError("Hunter did not finish verifying in time", "TIMEOUT")


def normalise(e: dict, company: str | None = None, domain: str | None = None) -> dict:
    """One Hunter email record -> the contact shape /outreach stores."""
    name = " ".join(x for x in (e.get("first_name"), e.get("last_name")) if x) or None
    sources = [s.get("uri") for s in (e.get("sources") or []) if s.get("uri")]
    return {
        "email": (e.get("value") or e.get("email") or "").lower() or None,
        "name": name,
        "position": e.get("position"),
        "company": company or e.get("company"),
        "domain": domain or e.get("domain"),
        "type": e.get("type"),                        # personal | generic
        "confidence": e.get("confidence", e.get("score")),
        "published": bool(sources),                   # seen on a public page, not only inferred
        "sources": sources[:3],
        "verification": (e.get("verification") or {}).get("status"),
        "found_via": "hunter",
    }


def is_recruiter(c: dict) -> bool:
    return bool(c.get("position") and RECRUITING_TITLE.search(c["position"]))


def domain_search(domain: str, api_key: str, limit: int = 5) -> list[dict]:
    """HR-department people at a domain, recruiters first. `limit` caps credits."""
    d = call("domain-search", {"domain": domain, "department": "hr", "type": "personal", "limit": limit}, api_key)
    data = d.get("data") or {}
    out = [normalise(e, data.get("organization"), data.get("domain")) for e in data.get("emails") or []]
    return sorted(out, key=lambda c: (not is_recruiter(c), -(c["confidence"] or 0)))


def find(domain: str, full_name: str, api_key: str) -> dict | None:
    d = (call("email-finder", {"domain": domain, "full_name": full_name}, api_key).get("data") or {})
    return normalise(d, d.get("company"), d.get("domain")) if d.get("email") else None


def verify(email: str, api_key: str) -> str:
    """valid | invalid | accept_all | webmail | disposable | unknown"""
    return (call("email-verifier", {"email": email}, api_key).get("data") or {}).get("status") or "unknown"


def account(api_key: str) -> dict:
    d = call("account", {}, api_key).get("data") or {}
    req = d.get("requests") or {}
    credits = req.get("credits") or {}
    return {"plan": d.get("plan_name"), "credits_used": credits.get("used"), "credits_available": credits.get("available"),
            "reset_date": d.get("reset_date")}


def sendable(c: dict) -> bool:
    """Our rule for what /outreach may email: verified deliverable, or published
    on a public page with high confidence. Pattern guesses that did not verify
    are never sent - a bounce costs sender reputation for every later email."""
    if c.get("verification") == "valid":
        return True
    return bool(c.get("published") and (c.get("confidence") or 0) >= 90 and c.get("verification") in ("accept_all", None))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("domain"); p.add_argument("domain"); p.add_argument("--limit", type=int, default=5)
    p = sub.add_parser("find"); p.add_argument("domain"); p.add_argument("full_name")
    p = sub.add_parser("verify"); p.add_argument("email")
    sub.add_parser("account")
    a = ap.parse_args(argv)
    try:
        k = key()
        if a.cmd == "domain":
            if not re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", a.domain.lower()) or not 1 <= a.limit <= 20:
                raise HunterError("give a bare domain like example.ie and --limit 1-20", "BAD_ARG")
            res = domain_search(a.domain.lower(), k, a.limit)
            for c in res:
                c["sendable"] = sendable(c)
            out = {"contacts": res}
        elif a.cmd == "find":
            c = find(a.domain.lower(), a.full_name, k)
            if c:
                c["sendable"] = sendable(c)
            out = {"contact": c}
        elif a.cmd == "verify":
            out = {"email": a.email.lower(), "status": verify(a.email, k)}
        else:
            out = account(k)
    except HunterError as e:
        print(json.dumps({"error": str(e), "code": e.code}), file=sys.stderr)
        return 2 if e.code in ("MISSING_CREDENTIALS", "BAD_ARG") else 1
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
apply-queue pre-flight
======================

Offline triage for the auto-apply workflow. Reads every `ready_to_apply` entry
(source of truth: job_scraper/seen_jobs.json + browser_finds.json), then for each:

  1. MATERIALS  - resolves the tailored CV + cover-letter PDFs (from the vault
                  note's "Application materials" links, falling back to the
                  cv/main_<slug>.pdf naming convention) and checks they exist
                  and are non-empty.
  2. ATS        - classifies the application host into auto / blocked / unknown.
                  Greenhouse, Lever, Ashby -> AUTO (no login wall, scriptable).
                  Workday, iCIMS, Taleo, SuccessFactors, Brassring -> BLOCKED
                  (account creation / login required - cannot be automated).
  3. REFERRAL   - cross-checks the company against ALL captured referral data
                  (referrals.json companies[] + tier3 coach counts +
                  tier3_only_matches, referral_paths_2hop.json,
                  strong_connections.json). If a path exists the entry is held
                  for a referral-first approach. If NO local data exists it is
                  flagged UNVERIFIED, because the coach dashboard snapshot is
                  explicitly partial (login-gated at
                  referrals.upwardproductmanagement.com).

Each entry lands in exactly one bucket:

  AUTO          - materials present, scriptable ATS, no referral to chase
                  -> safe to auto-submit.
  REFERRAL_HOLD - a referral path exists (or is plausibly on the coach
                  dashboard) -> route to referral first, do NOT auto-apply.
  BLOCKED       - account-walled ATS -> human must apply.
  NEEDS_FIX     - materials missing / not compiled -> compile before applying.

NOTE: free-text essay questions and CAPTCHAs can only be detected on the live
form, so that check happens at apply time, not here. This script is the offline
gate; the live gate runs when each form is opened.

Usage:
    python3 tools/apply-queue/preflight.py            # human-readable table
    python3 tools/apply-queue/preflight.py --json     # machine-readable manifest
    python3 tools/apply-queue/preflight.py --exclude Plaid Substack
"""
import argparse
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SEEN = os.path.join(REPO, "job_scraper", "seen_jobs.json")
BROWSER = os.path.join(REPO, "job_scraper", "browser_finds.json")
REFERRALS = os.path.join(REPO, "job_scraper", "referrals.json")
TWOHOP = os.path.join(REPO, "job_scraper", "referral_paths_2hop.json")
STRONG = os.path.join(REPO, "job_scraper", "strong_connections.json")
VAULT_RTA = os.path.join(REPO, "vault", "Job Pipeline", "04 Ready to Apply")

AUTO_HOSTS = {
    "greenhouse.io": "Greenhouse",
    "job-boards.greenhouse.io": "Greenhouse",
    "boards.greenhouse.io": "Greenhouse",
    "lever.co": "Lever",
    "jobs.lever.co": "Lever",
    "ashbyhq.com": "Ashby",
    "jobs.ashbyhq.com": "Ashby",
}
BLOCKED_HOSTS = {
    "myworkdayjobs.com": "Workday",
    "workday.com": "Workday",
    "icims.com": "iCIMS",
    "taleo.net": "Taleo",
    "successfactors.com": "SuccessFactors",
    "brassring.com": "Brassring",
    "smartrecruiters.com": "SmartRecruiters",
}


def load(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default if default is not None else {}


def ready_entries():
    """Return list of ready_to_apply dicts from the JSON sources of truth."""
    out = []
    seen = load(SEEN, {}).get("seen", {})
    items = seen.values() if isinstance(seen, dict) else seen
    for it in items:
        if isinstance(it, dict) and it.get("status") == "ready_to_apply":
            out.append(it)
    bf = load(BROWSER, {})

    def walk(x):
        if isinstance(x, dict):
            if x.get("status") == "ready_to_apply":
                out.append(x)
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(bf)
    # de-dupe by url
    seen_urls, dedup = set(), []
    for e in out:
        u = e.get("url")
        if u in seen_urls:
            continue
        seen_urls.add(u)
        dedup.append(e)
    return dedup


def host_of(url):
    m = re.match(r"https?://([^/]+)/?", url or "")
    return (m.group(1).lower() if m else "")


def classify_ats(url):
    h = host_of(url)
    for suffix, name in AUTO_HOSTS.items():
        if h == suffix or h.endswith("." + suffix) or h.endswith(suffix):
            return "auto", name
    for suffix, name in BLOCKED_HOSTS.items():
        if h.endswith(suffix):
            return "blocked", name
    return "unknown", h or "?"


def vault_note_for(company, title):
    """Find the matching vault note and return its raw text, or ''."""
    if not os.path.isdir(VAULT_RTA):
        return ""
    cl = (company or "").lower()
    tl = (title or "").lower()[:25]
    best = ""
    for fn in os.listdir(VAULT_RTA):
        if not fn.endswith(".md"):
            continue
        fl = fn.lower()
        if cl and cl.split()[0] in fl:
            txt = open(os.path.join(VAULT_RTA, fn)).read()
            if tl and tl.split(",")[0] in txt.lower():
                return txt
            best = best or txt
    return best


def materials_from_note(note):
    """Extract cv + cover .pdf repo-relative paths from a vault note."""
    cv = cover = None
    for m in re.finditer(r"\(\.\./\.\./\.\./([^)]+\.pdf)\)", note):
        p = m.group(1)
        if p.startswith("cv/") and not cv:
            cv = p
        elif p.startswith("cover_letters/") and not cover:
            cover = p
    return cv, cover


def slugify(company):
    return re.sub(r"[^a-z0-9]+", "", (company or "").lower())


def check_materials(entry):
    note = vault_note_for(entry.get("company"), entry.get("title"))
    cv, cover = materials_from_note(note)
    if not cv:
        cv = "cv/main_%s.pdf" % slugify(entry.get("company"))
    reasons = []
    cv_abs = os.path.join(REPO, cv) if cv else None
    cover_abs = os.path.join(REPO, cover) if cover else None
    cv_ok = bool(cv_abs and os.path.exists(cv_abs) and os.path.getsize(cv_abs) > 1000)
    cover_ok = bool(cover_abs and os.path.exists(cover_abs) and os.path.getsize(cover_abs) > 1000)
    if not cv_ok:
        reasons.append("CV PDF missing/empty (%s)" % cv)
    if not cover_ok:
        reasons.append("cover letter PDF missing/empty (%s)" % (cover or "not linked"))
    return cv if cv_ok else None, cover if cover_ok else None, (cv_ok and cover_ok), reasons


# ---- referral cross-check --------------------------------------------------

def _collect_company_signals(company):
    """Return dict of referral signals for a company across all sources."""
    cl = (company or "").lower()

    def match(name):
        n = (name or "").lower()
        return bool(n) and (cl in n or n in cl or cl.split()[0] == n.split()[0]) if n else False

    sig = {
        "direct": 0, "brokers": 0, "strong": 0, "two_hop": 0,
        "coach": None, "coach_note": "", "found_in": [],
    }

    ref = load(REFERRALS, {})
    for c in ref.get("companies", []):
        if match(c.get("company") or c.get("name")):
            sig["found_in"].append("referrals.companies")
            sig["direct"] = max(sig["direct"], int(c.get("tier2_direct_count") or c.get("direct_count") or 0))
            sig["brokers"] = max(sig["brokers"], int(c.get("tier2_broker_count") or c.get("brokers_count") or 0))
            t3 = c.get("tier3_coach_dashboard")
            if isinstance(t3, dict):
                sig["coach"] = t3.get("connections")
                sig["coach_note"] = t3.get("note", "")
    for name, cnt in ref.get("tier3_only_matches", {}).items():
        if name.startswith("_"):
            continue
        if match(name):
            sig["found_in"].append("referrals.tier3_only_matches")
            try:
                sig["coach"] = int(cnt)
            except (TypeError, ValueError):
                pass

    two = load(TWOHOP, {})
    txt2 = json.dumps(two).lower()
    if cl and cl in txt2:
        sig["two_hop"] = 1
        sig["found_in"].append("referral_paths_2hop")

    strong = load(STRONG, {})
    txt3 = json.dumps(strong).lower()
    if cl and cl in txt3:
        sig["strong"] = 1
        sig["found_in"].append("strong_connections")

    return sig


def referral_status(company):
    s = _collect_company_signals(company)
    has = (s["direct"] or s["brokers"] or s["strong"] or s["two_hop"]
           or (isinstance(s["coach"], int) and s["coach"] > 0))
    if has:
        bits = []
        if s["direct"]:
            bits.append("%d direct" % s["direct"])
        if s["brokers"]:
            bits.append("%d broker" % s["brokers"])
        if s["strong"]:
            bits.append("strong-connection")
        if s["two_hop"]:
            bits.append("2-hop path")
        if isinstance(s["coach"], int) and s["coach"] > 0:
            bits.append("%d coach" % s["coach"])
        return "HAS_REFERRAL", ", ".join(bits)
    if not s["found_in"]:
        return "UNVERIFIED", "no captured referral data - check coach dashboard (login)"
    return "NONE", "checked, no path found"


def bucket(entry):
    cv, cover, mats_ok, mat_reasons = check_materials(entry)
    ats_kind, ats_name = classify_ats(entry.get("url"))
    ref_state, ref_detail = referral_status(entry.get("company"))

    reasons = list(mat_reasons)
    if not mats_ok:
        b = "NEEDS_FIX"
    elif ref_state == "HAS_REFERRAL":
        b = "REFERRAL_HOLD"
        reasons.append("referral path exists: " + ref_detail)
    elif ats_kind == "blocked":
        b = "BLOCKED"
        reasons.append("%s requires account/login - cannot automate" % ats_name)
    elif ats_kind == "unknown":
        b = "NEEDS_FIX"
        reasons.append("unrecognized ATS host (%s) - apply manually / verify" % ats_name)
    else:
        b = "AUTO"
    if ref_state == "UNVERIFIED" and b == "AUTO":
        reasons.append("referral UNVERIFIED: " + ref_detail)
    return {
        "company": entry.get("company"),
        "role": (entry.get("title") or "").strip(),
        "url": entry.get("url"),
        "ats": ats_name,
        "cv": cv,
        "cover": cover,
        "materials_ok": mats_ok,
        "referral": ref_state,
        "referral_detail": ref_detail,
        "bucket": b,
        "reasons": reasons,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="emit JSON manifest")
    ap.add_argument("--exclude", nargs="*", default=[], help="company names to force-hold")
    args = ap.parse_args()

    excl = {e.lower() for e in args.exclude}
    manifest = []
    for e in ready_entries():
        row = bucket(e)
        if row["company"] and row["company"].lower() in excl:
            row["bucket"] = "REFERRAL_HOLD"
            row["reasons"].append("manually excluded by operator")
        manifest.append(row)

    order = {"AUTO": 0, "NEEDS_FIX": 1, "BLOCKED": 2, "REFERRAL_HOLD": 3}
    manifest.sort(key=lambda r: (order.get(r["bucket"], 9), r["company"] or ""))

    if args.json:
        print(json.dumps(manifest, indent=2))
        return

    counts = {}
    for r in manifest:
        counts[r["bucket"]] = counts.get(r["bucket"], 0) + 1
    print("apply-queue pre-flight  -  %d ready_to_apply entries" % len(manifest))
    print("buckets: " + ", ".join("%s=%d" % (k, v) for k, v in sorted(counts.items())))
    print("=" * 78)
    for r in manifest:
        print("[%s] %s - %s" % (r["bucket"], r["company"], r["role"]))
        print("    ATS: %-12s  materials: %s  referral: %s (%s)" % (
            r["ats"], "OK" if r["materials_ok"] else "MISSING",
            r["referral"], r["referral_detail"]))
        for reason in r["reasons"]:
            print("    - " + reason)
    print("=" * 78)
    autos = [r["company"] for r in manifest if r["bucket"] == "AUTO"]
    print("AUTO-submittable: " + (", ".join(autos) if autos else "(none)"))


if __name__ == "__main__":
    main()

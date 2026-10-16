#!/usr/bin/env python3
"""Canonical dedup key for a job posting, and an audit for existing state.

`/scrape` Step 4 keys every seen_jobs.json entry by company+title. The rule was
prose only ("<url_or_company_title_key>"), so each run slugified in its own way
and the state file accumulated two distinct failures:

  * Keys carrying characters that break things downstream. `/apply` and
    `/outcome` derive an archive folder name from the same company+role pair,
    and documents/README.md's subfolder rule exists because a "/" splits that
    path across directories. Real examples found in a live workspace:
    "deloitte_junior-cybersecurity-analyst-(ot/iot)",
    "neverhack-estonia_penetration-tester-/-red-teamer",
    "ops-consulting,-llc_malware-analyst".

  * The same job stored twice under different keys, because one run truncated
    the title at a different point than the next. "deloitte_cyber-intelligence-
    center-security-analy" and "deloitte_cyber-intelligence-center-security-
    analyst-at" are one posting, one URL, two entries - and dedup is the whole
    point of the file.

Both are fixed by making the key a pure, deterministic function of the posting.
Truncation is length-capped *and* disambiguated by a hash of the full slug, so a
long title always produces the same key and two different long titles never
collide.

A title that slugifies to nothing (a posting written in a non-Latin script) has
no usable key half at all and would collide with other such postings. Those fall
back to the portal's numeric id from the URL. A title or company that slugifies
to *less* than it says is the same problem one step on: whenever the ASCII fold
drops letters the surviving fragment is only a readable prefix and the identity
comes from the same fallback. Common Latin letters without an NFKD decomposition are folded explicitly
first and retain a hash identity; other lost letters are hash-disambiguated.

Usage:
  python3 tools/job_key.py --company "Acme Corp" --title "SOC Analyst (L2)"
  python3 tools/job_key.py --audit job_scraper/seen_jobs.json
  python3 tools/job_key.py --audit job_scraper/seen_jobs.json --migrate

Migration is explicit and creates an adjacent .bak copy before rewriting drifted
keys; collisions block migration without changing the source file. Exit 0 when a
key is produced, or when an audit finds nothing. Exit 1 when an audit finds
violations.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "job_scraper" / "seen_jobs.json"

COMPANY_MAX = 40
TITLE_MAX = 60
HASH_LEN = 6

# Anything outside this set becomes a separator. Deliberately strict: "/" and
# "," are the characters that actually caused damage, and an allowlist cannot
# be surprised by the next punctuation mark a job board invents.
_NON_SLUG = re.compile(r"[^a-z0-9]+")
_JOB_ID = re.compile(r"(\d{6,})")
_LATIN_FOLD = str.maketrans({
    "Æ": "AE", "æ": "ae", "Ø": "O", "ø": "o", "ß": "ss", "ẞ": "SS",
    "Ð": "D", "ð": "d", "Þ": "Th", "þ": "th", "Ł": "L", "ł": "l",
    "Đ": "D", "đ": "d", "Ħ": "H", "ħ": "h", "ı": "i", "Ŋ": "N",
    "ŋ": "n", "Œ": "OE", "œ": "oe", "Ŧ": "T", "ŧ": "t",
})


def slugify(text: str) -> str:
    """Lowercase ASCII slug, folding common Latin letters before NFKD."""
    if not text:
        return ""
    folded = str(text).translate(_LATIN_FOLD)
    decomposed = unicodedata.normalize("NFKD", folded)
    ascii_only = decomposed.encode("ascii", "ignore").decode("ascii")
    return _NON_SLUG.sub("-", ascii_only.lower()).strip("-")


def _lost_letters(text: str) -> bool:
    """True when folding could collapse this name with a different identity."""
    if not text:
        return False
    text = str(text)
    # Keep a readable transliteration, but also use the identity fallback so a
    # folded name cannot collide with an otherwise-identical ASCII name.
    if any(ch in _LATIN_FOLD for ch in text):
        return True
    for ch in unicodedata.normalize("NFKD", text):
        if ord(ch) >= 128 and ch.isalpha():
            return True
    return False


def _cap(slug: str, limit: int) -> str:
    """Cap length without making truncation lossy across runs.

    A bare truncation is what produced the duplicate Deloitte entries: two runs
    cut the same title at different points and the file gained a second key for
    one job. Appending a hash of the *full* slug makes the result deterministic
    for a given title and distinct for any other.
    """
    if len(slug) <= limit:
        return slug
    digest = hashlib.sha1(slug.encode("utf-8")).hexdigest()[:HASH_LEN]
    return f"{slug[:limit].rstrip('-')}-{digest}"


def make_key(company: str, title: str, url: str = "") -> str:
    """The canonical seen_jobs.json key for one posting."""
    company_slug = _cap(slugify(company), COMPANY_MAX)
    if not company_slug or _lost_letters(company):
        name = unicodedata.normalize("NFC", str(company or "").strip().casefold())
        # An absent name stays unknown; a non-Latin name still has an identity.
        # A mixed-script name keeps its Latin fragment as a readable prefix, but
        # the identity is the hash: "Сбер AI" and "Яндекс AI" both fold to "ai".
        digest = hashlib.sha1(name.encode("utf-8")).hexdigest()[:HASH_LEN]
        if not name:
            company_slug = "unknown-company"
        else:
            company_slug = f"{company_slug}-{digest}" if company_slug else f"company-{digest}"
    title_slug = _cap(slugify(title), TITLE_MAX)
    if not title_slug or _lost_letters(title):
        # No Latin characters in the title, or not enough of them to identify
        # it: "Программист 1С" and "Аналитик 1С" both fold to "1". The portal's
        # own numeric id is the stable handle; a surviving fragment stays as a
        # readable prefix only. Never emit a bare "company_" prefix.
        fragment = title_slug
        match = _JOB_ID.search(url or "")
        if match:
            title_slug = f"{fragment}-{match.group(1)}" if fragment else match.group(1)
        else:
            basis = slugify(unicodedata.normalize("NFKD", str(title or url or "")))
            # Hash the URL alone when there is one. The URL is the posting's
            # identity; the title is not. Including the title made the key
            # change whenever a portal re-listed the same posting with the
            # title altered, which stores one job twice - the failure this
            # whole helper exists to prevent. Portals whose ids carry no run
            # of six digits never reach the branch above, so for them this
            # hash is the only key half there is: freehire's real slugs look
            # like "inzhener-ooo-chen-hlk3qjfg", and its Cyrillic and Greek
            # titles slugify to nothing. With no URL, the title is all that
            # is left to key on.
            digest_basis = str(url) if url else str(title)
            digest = hashlib.sha1(digest_basis.encode("utf-8")).hexdigest()[:HASH_LEN]
            # A lossy fragment needs the digest to tell two postings apart; an
            # empty title keeps the bare basis (a URL-derived slug, or
            # "untitled-<hash>") exactly as before the fragment rule existed.
            title_slug = f"{fragment}-{digest}" if fragment else (basis or f"untitled-{digest}")
    return f"{company_slug}_{title_slug}"


# A canonical key is "<company-slug>_<title-slug>": lowercase alphanumerics and
# hyphens on either side of exactly one underscore. The underscore is the
# separator, so it is the one character outside the slug alphabet that belongs.
_CANONICAL = re.compile(r"^[a-z0-9][a-z0-9-]*_[a-z0-9][a-z0-9-]*$")


def is_canonical(key: str) -> bool:
    """Structurally safe as a dedup key and as an archive folder name."""
    return bool(key) and bool(_CANONICAL.match(key))


def is_legacy_shape(key: str) -> bool:
    """Old three-part "company_title_location" keys.

    Harmless - they carry no path-breaking character - but they are not what
    make_key produces, so a later run would store the same job under a new key
    and reintroduce a duplicate. Reported apart from real damage so the fix
    stays a decision rather than an automatic rename.
    """
    return bool(key) and key.count("_") > 1 and all(
        re.fullmatch(r"[a-z0-9][a-z0-9-]*", part) for part in key.split("_") if part
    )


def audit(path: Path, migrate: bool = False) -> int:
    try:
        original = path.read_bytes()
        doc = json.loads(original.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        print(f"cannot read {path}: {exc}", file=sys.stderr)
        return 1
    seen = doc.get("seen", doc)
    if not isinstance(seen, dict):
        print(f"{path}: expected an object of job entries", file=sys.stderr)
        return 1

    malformed = [k for k in seen if not is_canonical(k) and not is_legacy_shape(k)]
    legacy = [k for k in seen if is_legacy_shape(k)]
    by_url: dict[str, list[str]] = {}
    for key, entry in seen.items():
        url = (entry.get("url") or "").rstrip("/")
        if url:
            by_url.setdefault(url, []).append(key)
    duplicates = {u: ks for u, ks in by_url.items() if len(ks) > 1}
    # A key that does not match what make_key would produce today is drift, not
    # damage: audit reports it; migration is an explicit, backed-up choice.
    drift = [
        k for k, v in seen.items()
        if is_canonical(k) and k != make_key(v.get("company", ""), v.get("title", ""), v.get("url", ""))
    ]
    report = {
        "entries": len(seen),
        "malformed_keys": malformed,
        "legacy_three_part_keys": legacy,
        "duplicate_urls": duplicates,
        "keys_not_matching_current_rule": len(drift),
    }
    if migrate and drift:
        migrated: dict[str, dict] = {}
        origins: dict[str, str] = {}
        for key, entry in seen.items():
            new_key = make_key(entry.get("company", ""), entry.get("title", ""), entry.get("url", "")) if key in drift else key
            if new_key in origins:
                print(json.dumps({
                    "migration": "blocked",
                    "reason": "multiple entries would map to one key",
                    "keys": [origins[new_key], key],
                    "target": new_key,
                }, ensure_ascii=False), file=sys.stderr)
                return 1
            origins[new_key] = key
            migrated[new_key] = entry

        backup = Path(f"{path}.bak")
        try:
            with backup.open("xb") as backup_file:
                backup_file.write(original)
            backup.chmod(path.stat().st_mode & 0o777)
            if "seen" in doc:
                doc["seen"] = migrated
            else:
                doc = migrated
            fd, temp_name = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as temp_file:
                    json.dump(doc, temp_file, indent=2, ensure_ascii=False)
                    temp_file.write("\n")
                    temp_file.flush()
                    os.fsync(temp_file.fileno())
                os.chmod(temp_name, path.stat().st_mode & 0o777)
                if path.read_bytes() != original:
                    raise OSError("source changed during migration")
                os.replace(temp_name, path)
            except BaseException:
                if os.path.exists(temp_name):
                    os.unlink(temp_name)
                raise
        except OSError as exc:
            print(f"migration failed for {path}: {exc}; source was not replaced; any created backup remains", file=sys.stderr)
            return 1
        report["migration"] = {"changed": len(drift), "backup": str(backup)}
    elif migrate:
        report["migration"] = {"changed": 0, "backup": None}

    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 1 if (malformed or duplicates) else 0


def _force_utf8_output() -> None:
    """Write UTF-8 whatever the host's default encoding is.

    A piped stdout on Windows defaults to the ANSI code page (cp1252 on most
    Western installs), so printing a company, title or file name outside it
    raised UnicodeEncodeError before the workflow saw any output.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)  # absent on a StringIO under test
        if reconfigure:
            reconfigure(encoding="utf-8")


def main() -> int:
    _force_utf8_output()
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--company")
    ap.add_argument("--title")
    ap.add_argument("--url", default="")
    ap.add_argument("--audit", nargs="?", const=str(STATE), metavar="STATE_JSON")
    ap.add_argument("--migrate", action="store_true", help="back up and migrate keys that drift under the current rule")
    args = ap.parse_args()

    if args.migrate and not args.audit:
        ap.error("--migrate requires --audit")
    if args.audit:
        return audit(Path(args.audit), migrate=args.migrate)
    if args.company is None or args.title is None:
        ap.error("give --company and --title, or --audit")
    print(make_key(args.company, args.title, args.url))
    return 0


if __name__ == "__main__":
    sys.exit(main())

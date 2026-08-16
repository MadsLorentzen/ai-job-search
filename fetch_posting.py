#!/usr/bin/env python3
"""
Posting Cache Broker

Caches job posting bodies on disk so a posting is fetched once per lifecycle
and read locally everywhere after (/scrape, /rank, /apply, /outcome).

This tool never fetches. The agent owns fetching (WebFetch -> curl on 403 ->
careers-site escalation); this script owns the deterministic half: cache
lookup, staleness math, safe filenames, read/write, and cleanup.

Usage:
    python fetch_posting.py get --key "<seen_jobs key>" [--max-age-days 7]
    echo "<posting text>" | python fetch_posting.py store --key "<key>"
    python fetch_posting.py store --key "<key>" --file posting.txt
    python fetch_posting.py gc --seen-file job_scraper/seen_jobs.json

Exit codes for `get`:
    0   fresh cached body on stdout
    10  MISS - nothing cached, caller should fetch
    11  STALE - body on stdout after a STALE marker line, caller should re-fetch
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).parent

POSTINGS_DIR = REPO_ROOT / "job_scraper" / "postings"

DEFAULT_MAX_AGE_DAYS = 7

EXIT_MISS = 10
EXIT_STALE = 11

# Suffix `store` writes under before renaming into place. Shared with `gc` so
# the sweep can reach residue from a store that never got to rename.
TEMP_SUFFIX = ".tmp"


def degrade(message, code=0):
    """Print a one-line notice and exit non-fatally.

    Following the salary_lookup.py precedent: this tool is a cache, never a
    hard dependency. When something it needs is unavailable the caller must
    still be able to carry on by fetching, so nothing here is a hard failure.
    """
    print(f"Posting cache unavailable: {message}", file=sys.stderr)
    return code


def sidecar_path(key):
    """Resolve the cache file for a seen_jobs key.

    The key may be a URL or a company+title composite, so the filename is a
    sha1 digest: no URL-unsafe characters, no collisions. The human-readable
    title/company already live in the seen_jobs.json entry.
    """
    # usedforsecurity=False: this is a filename digest, not a security claim,
    # and plain sha1() is refused outright on FIPS-enabled hosts.
    try:
        digest = hashlib.sha1(key.encode("utf-8"), usedforsecurity=False).hexdigest()
    except TypeError:  # Python < 3.9
        digest = hashlib.sha1(key.encode("utf-8")).hexdigest()
    return POSTINGS_DIR / f"{digest}.md"


def parse_sidecar(text):
    """Split a sidecar's stored text into (header dict, body).

    Sidecars carry a small `---` delimited header so `fetch_date` travels with
    the body itself: staleness must survive a file copy, and must stay
    hand-editable for testing. A file without a header at all is treated as
    header-less rather than as an error.

    Returns (None, "") when a header opens but never closes: that file was
    truncated mid-write, and emitting its `key:`/`fetch_date:` lines as if
    they were the posting would hand the caller junk to fall back on.
    """
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return {}, text

    header = {}
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return header, "\n".join(lines[index + 1:])
        field, sep, value = line.partition(":")
        if sep:
            header[field.strip()] = value.strip()

    return None, ""


def age_in_days(fetch_date):
    """Days since `fetch_date` (YYYY-MM-DD). Missing or unparseable -> stale.

    An undatable sidecar is treated as maximally old rather than as an error:
    the caller re-fetches and the entry self-heals on the next store.
    """
    try:
        stamped = date.fromisoformat(fetch_date)
    except (TypeError, ValueError):
        return sys.maxsize
    return (date.today() - stamped).days


def render_sidecar(key, fetch_date, body):
    """Render the on-disk sidecar text for a posting body."""
    return (
        "---\n"
        f"key: {key}\n"
        f"fetch_date: {fetch_date}\n"
        "---\n"
        f"{body.rstrip(chr(10))}\n"
    )


def discard(path):
    """Delete a file, reporting failure rather than raising. True if it is gone."""
    try:
        path.unlink()
    except FileNotFoundError:
        return True
    except NotADirectoryError:
        # A component of the path is not a directory, so the residue cannot
        # exist - the same "nothing to clean up" as FileNotFoundError. Staying
        # quiet matters on the store failure path: the caller that could not
        # write here already reports the real error, and a second notice about
        # an unremovable file that was never created only obscures it.
        return True
    except OSError as exc:
        degrade(f"could not remove {display_path(path)} ({exc}).")
        return False
    return True


def display_path(path):
    """Show the sidecar path relative to the repo root when it lives under it."""
    try:
        return path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def miss():
    """Report a cache miss. Every reason `get` cannot serve a body ends here:
    the caller fetches and stores, which also heals an unusable file."""
    print("MISS")
    return EXIT_MISS


def cmd_get(args):
    """Print the cached body for a key. Returns the process exit code."""
    path = sidecar_path(args.key)
    if not path.exists():
        return miss()

    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        degrade(f"{display_path(path)} is unreadable ({exc}) - treating as a miss.")
        return miss()

    header, body = parse_sidecar(text)
    if header is None:
        degrade(f"{display_path(path)} is truncated - treating as a miss.")
        return miss()

    body = body.rstrip("\n")

    if age_in_days(header.get("fetch_date")) > args.max_age_days:
        print("STALE")
        print(body)
        return EXIT_STALE

    print(body)
    return 0


def cmd_store(args):
    """Write a fetched body to the cache and print its path."""
    if args.file:
        try:
            body = Path(args.file).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            return degrade(f"could not read {args.file} ({exc}) - nothing cached.")
    else:
        body = sys.stdin.read()

    path = sidecar_path(args.key)
    text = render_sidecar(args.key, date.today().isoformat(), body)
    # Write-then-rename: an interrupted write must not leave a truncated body
    # stamped with today's fetch_date, which would read back as fresh.
    pending = path.with_name(f"{path.name}{TEMP_SUFFIX}")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        pending.write_text(text, encoding="utf-8")
        os.replace(pending, path)
    except OSError as exc:
        discard(pending)
        return degrade(f"could not write {display_path(path)} ({exc}) - nothing cached.")

    print(display_path(path))
    return 0


def cmd_gc(args):
    """Delete sidecars whose job is gone from seen_jobs.json or marked expired."""
    if not POSTINGS_DIR.exists():
        print("Posting cache: nothing to clean (no cache directory yet).")
        return 0

    seen_path = Path(args.seen_file) if args.seen_file else POSTINGS_DIR.parent / "seen_jobs.json"
    try:
        seen = json.loads(seen_path.read_text(encoding="utf-8")).get("seen", {})
    except FileNotFoundError:
        return degrade(f"{seen_path} not found - skipping posting-cache cleanup.")
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, AttributeError) as exc:
        return degrade(f"could not read {seen_path} ({exc}) - skipping posting-cache cleanup.")

    keep = {
        sidecar_path(key).name
        for key, entry in seen.items()
        if not (isinstance(entry, dict) and entry.get("status") == "expired")
    }

    # Residue from a store killed between write and rename. `keep` holds only
    # `.md` names, so a temp file never matches it - and gc is the only thing
    # that can ever reach one, since `get` and `store` both address `.md`.
    litter = sorted(POSTINGS_DIR.glob(f"*.md{TEMP_SUFFIX}"))

    removed = 0
    for path in sorted(POSTINGS_DIR.glob("*.md")) + litter:
        # A file we cannot delete (locked, read-only) must not abort the sweep:
        # the rest of the cache still gets cleaned and gc still exits 0.
        if path.name not in keep and discard(path):
            removed += 1

    print(f"Posting cache: removed {removed} orphaned/expired sidecar(s), "
          f"{len(list(POSTINGS_DIR.glob('*.md')))} kept.")
    return 0


def non_negative_days(value):
    """argparse type for a day count. Rejects negatives; 0 means same-day-only."""
    days = int(value)
    if days < 0:
        raise argparse.ArgumentTypeError(f"must be 0 or greater (got {value})")
    return days


def build_parser():
    parser = argparse.ArgumentParser(description="Posting Cache Broker")
    verbs = parser.add_subparsers(dest="verb", required=True)

    get_parser = verbs.add_parser("get", help="Read a cached posting body")
    get_parser.add_argument("--key", required=True, help="seen_jobs.json key (URL or company+title)")
    get_parser.add_argument("--max-age-days", type=non_negative_days, default=DEFAULT_MAX_AGE_DAYS,
                            help=f"Staleness threshold in days (default: {DEFAULT_MAX_AGE_DAYS})")
    get_parser.set_defaults(func=cmd_get)

    store_parser = verbs.add_parser("store", help="Cache a body the agent just fetched")
    store_parser.add_argument("--key", required=True, help="seen_jobs.json key (URL or company+title)")
    store_parser.add_argument("--file", help="Read the body from this file instead of stdin")
    store_parser.set_defaults(func=cmd_store)

    gc_parser = verbs.add_parser("gc", help="Delete orphaned and expired cached postings")
    # Resolved in cmd_gc rather than baked in here, so it always tracks
    # POSTINGS_DIR - the two must never point at different job_scraper roots.
    gc_parser.add_argument("--seen-file", default=None,
                           help="Path to seen_jobs.json (default: alongside the cache directory)")
    gc_parser.set_defaults(func=cmd_gc)

    return parser


def configure_console():
    """Make both output streams survive non-ASCII on a legacy console.

    Posting bodies are Hebrew, Danish, and emoji as often as ASCII. On a
    cp1252 console, printing one raises UnicodeEncodeError - a hard crash in
    the one place this tool must never hard-fail.

    stderr is included for a milder reason: Python already defaults it to
    backslashreplace, so a degrade() notice does not crash, but it renders the
    user-supplied path it interpolates as `\\u05de\\u05d5...` at the human who
    has to act on it.

    Called from the __main__ guard rather than main(): main(argv) is also the
    library entry point the tests drive, and a process-global stream swap is
    not something importing this module should do to its caller.
    """
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    sys.exit(args.func(args))


if __name__ == "__main__":
    configure_console()
    main()

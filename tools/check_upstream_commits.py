#!/usr/bin/env python3
"""Report new upstream commits not yet in the current branch.

Usage: python tools/check_upstream_commits.py [--remote upstream] [--branch master] [--limit 10] [--quiet-if-empty]

Complements check_upstream_updates.py, which only tracks framework_version
markers on the 9 methodology files under .claude/skills/job-application-assistant/.
This script answers a different question: is my fork behind upstream at all,
across tools/, .agents/skills/, tests/, CI, etc.? Fetches the given remote
(bounded by a timeout so a flaky network never hangs the session) and prints
the commit subjects reachable from <remote>/<branch> but not from HEAD.
Report-only: never merges, rebases, or pulls.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FETCH_TIMEOUT_SECONDS = 10


def run_git(args: list[str], timeout: float | None = None) -> tuple[int, str, str]:
    try:
        res = subprocess.run(
            ["git"] + args, cwd=str(ROOT), capture_output=True, text=True, timeout=timeout
        )
        return res.returncode, res.stdout, res.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "timed out"


def main() -> int:
    parser = argparse.ArgumentParser(description="Report new commits on an upstream remote.")
    parser.add_argument("--remote", default="upstream", help="Remote name (default: upstream)")
    parser.add_argument("--branch", default="master", help="Branch on the remote (default: master)")
    parser.add_argument("--limit", type=int, default=10, help="Max commit subjects to print (default: 10)")
    parser.add_argument(
        "--quiet-if-empty", action="store_true", help="Print nothing when there are no new commits"
    )
    parser.add_argument("--no-fetch", action="store_true", help="Skip fetching from remote")
    args = parser.parse_args()

    rc, stdout, _ = run_git(["remote"])
    remotes = stdout.splitlines()
    if args.remote not in remotes:
        if not args.quiet_if_empty:
            print(f"[upstream-check] Remote '{args.remote}' not configured; skipping.")
        return 0

    if not args.no_fetch:
        fetch_rc, _, fetch_err = run_git(
            ["fetch", args.remote, args.branch], timeout=FETCH_TIMEOUT_SECONDS
        )
        if fetch_rc != 0:
            if not args.quiet_if_empty:
                print(f"[upstream-check] Could not fetch '{args.remote}': {fetch_err.strip()}")
            return 0

    ref = f"{args.remote}/{args.branch}"
    rc, _, _ = run_git(["rev-parse", "--verify", ref])
    if rc != 0:
        if not args.quiet_if_empty:
            print(f"[upstream-check] Ref '{ref}' not found after fetch; skipping.")
        return 0

    rc, current_branch, _ = run_git(["rev-parse", "--abbrev-ref", "HEAD"])
    current_branch = current_branch.strip() or "HEAD"

    rc, log_out, _ = run_git(["log", f"HEAD..{ref}", "--oneline", "--no-merges"])
    commits = [line for line in log_out.splitlines() if line.strip()]

    if not commits:
        if not args.quiet_if_empty:
            print(f"[upstream-check] '{current_branch}' is up to date with {ref}.")
        return 0

    print(f"[upstream-check] {len(commits)} new commit(s) on {ref} not yet in '{current_branch}':")
    for line in commits[: args.limit]:
        print(f"  - {line}")
    if len(commits) > args.limit:
        print(f"  ... and {len(commits) - args.limit} more")
    print(f"  (report only, not merged - see `git log HEAD..{ref} --oneline` or `git merge {ref}`)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

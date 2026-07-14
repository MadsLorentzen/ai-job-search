#!/usr/bin/env python3
"""Check for framework updates in the upstream repository.

Usage: python tools/check_upstream_updates.py [--remote <remote-name>] [--branch <branch-name>]

This script:
1. Identifies the upstream remote (defaults to 'upstream', falls back to 'origin').
2. Fetches the latest commits from the upstream remote.
3. Compares the 'framework_version' in your local files under
   .claude/skills/job-application-assistant/ with those in the upstream remote.
4. Alerts you if a file has been updated upstream with a newer version.
"""

from __future__ import annotations
import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL_DIR = ".claude/skills/job-application-assistant"
FRAMEWORK_FILES = [
    "01-candidate-profile.md",
    "02-behavioral-profile.md",
    "03-writing-style.md",
    "04-job-evaluation.md",
    "05-cv-templates.md",
    "06-cover-letter-templates.md",
    "07-interview-prep.md",
    "SKILL.md",
]

def run_git(args: list[str]) -> tuple[int, str, str]:
    res = subprocess.run(["git"] + args, cwd=str(ROOT), capture_output=True, text=True)
    return res.returncode, res.stdout, res.stderr

def get_framework_version_from_text(text: str) -> str | None:
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---", 4)
    if end == -1:
        return None
    for line in text[4:end].splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            if k.strip() == "framework_version":
                return v.strip().strip('"').strip("'")
    return None

def parse_semver(version_str: str) -> tuple[int, int, int]:
    # Clean version string (e.g. remove 'v' prefix)
    match = re.match(r"^v?(\d+)\.(\d+)\.(\d+)", version_str)
    if not match:
        return (0, 0, 0)
    return tuple(int(x) for x in match.groups())

def main() -> int:
    parser = argparse.ArgumentParser(description="Check for framework updates upstream.")
    parser.add_argument("--remote", default="upstream", help="Name of the git remote for upstream (default: upstream)")
    parser.add_argument("--branch", default="master", help="Branch name of the upstream repo (default: master)")
    parser.add_argument("--no-fetch", action="store_true", help="Skip fetching from remote")
    args = parser.parse_args()

    # Verify remote exists
    rc, stdout, _ = run_git(["remote"])
    remotes = stdout.splitlines()
    remote = args.remote
    if remote not in remotes:
        if "origin" in remotes:
            print(f"Warning: Remote '{remote}' not found. Falling back to 'origin'.")
            remote = "origin"
        else:
            print("Error: No git remotes found.")
            return 1

    if not args.no_fetch:
        print(f"Fetching latest from remote '{remote}'...")
        rc, _, stderr = run_git(["fetch", remote])
        if rc != 0:
            print(f"Warning: Failed to fetch from remote '{remote}': {stderr.strip()}")
            print("Proceeding with cached remote tracking branches.")

    ref = f"{remote}/{args.branch}"
    # Verify ref exists
    rc, _, _ = run_git(["rev-parse", "--verify", ref])
    if rc != 0:
        print(f"Error: Ref '{ref}' does not exist. Make sure you fetched and specified the correct branch.")
        return 1

    print(f"Comparing local files against upstream '{ref}'...\n")
    
    updates_available = []
    errors = []

    for filename in FRAMEWORK_FILES:
        local_path = ROOT / SKILL_DIR / filename
        if not local_path.exists():
            print(f"Local file missing: {SKILL_DIR}/{filename}")
            continue

        # Get local version
        local_text = local_path.read_text(encoding="utf-8")
        local_ver = get_framework_version_from_text(local_text)
        
        # Get upstream version
        rc, upstream_text, _ = run_git(["show", f"{ref}:{SKILL_DIR}/{filename}"])
        if rc != 0:
            # File might not exist upstream yet
            continue
            
        upstream_ver = get_framework_version_from_text(upstream_text)
        
        if not local_ver:
            errors.append(f"Local file {filename} is missing 'framework_version' in frontmatter.")
            continue
        if not upstream_ver:
            continue
            
        if parse_semver(upstream_ver) > parse_semver(local_ver):
            updates_available.append({
                "filename": filename,
                "local": local_ver,
                "upstream": upstream_ver,
                "path": f"{SKILL_DIR}/{filename}"
            })

    if errors:
        print("Configuration errors:")
        for err in errors:
            print(f"  - {err}")
        print()

    if updates_available:
        print("[UPDATE] Upstream updates available for framework methodology files:")
        for up in updates_available:
            print(f"  - {up['filename']}: local {up['local']} < upstream {up['upstream']}")
            print(f"    Diff command: git diff {ref} -- {up['path']}")
            print()
        print("Review these changes to see if they fit your personalized fork!")
        return 0
    else:
        print("[OK] All framework files are up to date with upstream!")
        return 0

if __name__ == "__main__":
    sys.exit(main())

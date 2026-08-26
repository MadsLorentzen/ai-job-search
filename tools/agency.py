#!/usr/bin/env python3
"""Agency console: manage client workspaces, credentials, and the toolchain.

This is the entry point packaged as the Windows executable. It deliberately
does NOT run the job-search workflow itself - that is Claude Code, driven by
the command files in .claude/, and wrapping it would mean maintaining a
second copy of logic that already exists. What it does is everything a
consultant needs around that workflow and currently has to do by hand:

    agency doctor                     is this machine able to run the workflow?
    agency key set                    store the Claude key for this user
    agency client init "Jane Doe"     provision an isolated client workspace
    agency client check "Jane Doe"    is this workspace safe to draft from?
    agency client audit "Jane Doe" f  does this draft carry anyone else's identity?
    agency client list                who is on the books

`doctor` is the reason this exists. The setup cliff is real - a LaTeX
distribution, two engines, Bun, and poppler, each with its own Windows
quirks - and a consultant onboarding a machine should get one report naming
exactly what is missing and the command that fixes it, not a stack trace
from lualatex three steps into a client's first application.

Stdlib only. Exit 0 when everything checked is sound, 1 otherwise.
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import credentials  # noqa: E402
import tenancy  # noqa: E402

# Each probe: the executable, what it is for, and how to install it on Windows.
# The remediation strings mirror SETUP.md so a machine fixed from this report
# matches one fixed from the docs.
TOOLCHAIN = (
    (
        "lualatex",
        "compiles the CV (pdflatex breaks on fontawesome5)",
        "install MiKTeX from https://miktex.org/download",
        True,
    ),
    (
        "xelatex",
        "compiles the cover letter (cover.cls needs fontspec)",
        "install MiKTeX from https://miktex.org/download",
        True,
    ),
    (
        "bun",
        "runs the job-portal search CLIs",
        "winget install Oven-sh.Bun",
        True,
    ),
    (
        "pdftotext",
        "ATS check on the compiled CV",
        "choco install poppler",
        False,
    ),
)


def probe(executable):
    """Return the resolved path to `executable`, or None."""
    return shutil.which(executable)


def probe_version(executable):
    """Best-effort one-line version string. Never raises."""
    try:
        result = subprocess.run(
            [executable, "--version"],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    first = (result.stdout or result.stderr or "").strip().splitlines()
    return first[0][:60] if first else ""


def run_doctor(root, store_path=None):
    """Check everything the workflow needs. Returns (lines, ok)."""
    lines = []
    problems = 0

    lines.append("Toolchain")
    for executable, purpose, remedy, required in TOOLCHAIN:
        found = probe(executable)
        if found:
            version = probe_version(executable)
            detail = f" - {version}" if version else ""
            lines.append(f"  [ok]   {executable}{detail}")
        elif required:
            problems += 1
            lines.append(f"  [MISS] {executable} - {purpose}")
            lines.append(f"         fix: {remedy}")
        else:
            lines.append(f"  [warn] {executable} - {purpose} (optional)")
            lines.append(f"         fix: {remedy}")

    lines.append("")
    lines.append("Credentials")
    try:
        key, source = credentials.resolve(store_path)
    except credentials.CredentialError as exc:
        problems += 1
        key, source = None, f"unreadable - {exc}"
    if key:
        lines.append(f"  [ok]   key {credentials.redact(key)} from {source}")
    else:
        problems += 1
        lines.append(f"  [MISS] no Claude API key - {source}")
        lines.append("         fix: agency key set")

    lines.append("")
    lines.append("Clients")
    clients = tenancy.list_clients(root)
    if not clients:
        lines.append("  (none yet - agency client init \"<name>\")")
    for manifest in clients:
        name = manifest["client"]
        if manifest["tokens"] is None:
            problems += 1
            lines.append(f"  [BAD]  {name} - manifest unreadable")
            continue
        issues = tenancy.check_profile(name, root=root)
        if issues:
            problems += 1
            lines.append(f"  [BAD]  {name} - {issues[0]}")
        else:
            lines.append(f"  [ok]   {name}")

    lines.append("")
    lines.append("OK - this machine can run the workflow" if not problems
                 else f"{problems} problem(s) above must be fixed first")
    return lines, problems == 0


def _cmd_doctor(args):
    lines, ok = run_doctor(args.root, args.store)
    print("\n".join(lines))
    return 0 if ok else 1


def _cmd_client_init(args):
    workspace = tenancy.init_client(args.name, args.token or (), root=args.root)
    print(f"workspace ready: {workspace}")
    print(f"next: clone this repo into it, then run /setup inside that checkout")
    return 0


def _cmd_client_check(args):
    problems = tenancy.check_profile(args.name, root=args.root)
    if problems:
        print(f"NOT READY - {args.name} is not safe to draft from:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    print(f"OK - {args.name} is ready to draft from")
    return 0


def _cmd_client_audit(args):
    findings = tenancy.audit_files(args.name, args.files, root=args.root)
    if not findings:
        print(f"OK - no foreign identity in {len(args.files)} file(s)")
        return 0
    print(
        f"CONTAMINATION - {len(findings)} finding(s). Do not send these documents.",
        file=sys.stderr,
    )
    for path, token, owner in findings:
        print(f"  {path}: {token!r} belongs to {owner!r}", file=sys.stderr)
    return 1


def _cmd_client_list(args):
    clients = tenancy.list_clients(args.root)
    if not clients:
        print("no clients yet")
        return 0
    for manifest in clients:
        count = "unreadable" if manifest["tokens"] is None else f"{len(manifest['tokens'])} tokens"
        print(f"  {manifest['client']:<30} {manifest['slug']:<24} {count}")
    return 0


def build_parser():
    parser = argparse.ArgumentParser(
        prog="agency",
        description="Client workspaces, credentials and toolchain for the job-search workflow.",
    )
    parser.add_argument(
        "--root", type=Path, default=tenancy.ROOT,
        help="installation root holding clients/ (default: alongside this program)",
    )
    parser.add_argument("--store", type=Path, help="override the credential store path")
    sub = parser.add_subparsers(dest="command", required=True)

    doctor = sub.add_parser("doctor", help="check this machine can run the workflow")
    doctor.set_defaults(func=_cmd_doctor)

    key = sub.add_parser("key", help="manage the Claude API key for this user")
    key_sub = key.add_subparsers(dest="key_command", required=True)
    key_set = key_sub.add_parser("set", help="store a key (prompts without echo)")
    key_set.add_argument("key", nargs="?")
    key_set.set_defaults(func=lambda a: credentials._cmd_set(
        argparse.Namespace(key=a.key, path=a.store)))
    key_status = key_sub.add_parser("status", help="show where the key resolves from")
    key_status.set_defaults(func=lambda a: credentials._cmd_status(
        argparse.Namespace(path=a.store)))
    key_clear = key_sub.add_parser("clear", help="remove the stored key")
    key_clear.set_defaults(func=lambda a: credentials._cmd_clear(
        argparse.Namespace(path=a.store)))

    client = sub.add_parser("client", help="manage client workspaces")
    client_sub = client.add_subparsers(dest="client_command", required=True)

    init = client_sub.add_parser("init", help="provision an isolated workspace")
    init.add_argument("name")
    init.add_argument("--token", action="append",
                      help="identity token (email, phone, employer). Repeatable.")
    init.set_defaults(func=_cmd_client_init)

    check = client_sub.add_parser("check", help="is this workspace safe to draft from?")
    check.add_argument("name")
    check.set_defaults(func=_cmd_client_check)

    audit = client_sub.add_parser("audit", help="scan drafts for another client's identity")
    audit.add_argument("name")
    audit.add_argument("files", nargs="+")
    audit.set_defaults(func=_cmd_client_audit)

    listing = client_sub.add_parser("list", help="who is on the books")
    listing.set_defaults(func=_cmd_client_list)

    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except (tenancy.TenancyError, credentials.CredentialError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

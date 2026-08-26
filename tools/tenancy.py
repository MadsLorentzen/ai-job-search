#!/usr/bin/env python3
"""Per-client workspace isolation for multi-client (commercial) use.

Run from anywhere:
    python tools/tenancy.py init "<client name>" [--token "<identifier>" ...]
    python tools/tenancy.py check "<client name>"
    python tools/tenancy.py audit "<client name>" <file> [<file> ...]

The stock framework is single-tenant. CLAUDE.md holds one candidate profile
and is loaded as project instructions on every run; the tracker, scraper
state, and documents/ tree all sit at the repo root. Serving several clients
from one installation breaks that assumption, and the worst failure it
enables is not a crash - it is a rendered CV carrying another client's
employer, job title, or contact details. That document reaches a hiring
manager before anyone notices, and it is also an unauthorised disclosure of
one client's personal data to another.

Isolation by directory alone does not prevent this: the leak happens in the
model's context, not on disk, when a profile from a previous run is still
loaded while a new client's document is drafted. So this module does not try
to be a sandbox. It makes the failure detectable before the document ships:

1. `init`  - creates an isolated workspace per client under clients/<slug>/,
   each with its own documents/, cv/, cover_letters/, job_scraper/ and
   tracker, plus a client.json manifest recording the identity tokens that
   belong to that client.
2. `check` - asserts a workspace exists, is intact, and belongs to the client
   the run is for. Call it before drafting, not after.
3. `audit` - scans a generated draft for identity tokens registered to any
   OTHER client in the same installation. This is the cross-contamination
   gate: run it on every draft before the document is compiled or sent.

A token registered to this client is never flagged, so two clients who share
an employer do not produce false positives - only the tokens unique to
someone else do.

Stdlib only. Exit 0 on success, 1 with a failure list otherwise.
"""

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Per-client workspaces live here, one subdirectory per client.
CLIENTS_DIRNAME = "clients"

MANIFEST_NAME = "client.json"

# The per-client tree. Mirrors the single-tenant layout so the existing
# commands work unchanged once their paths are rooted at a workspace.
WORKSPACE_SUBDIRS = (
    "cv",
    "cover_letters",
    "job_scraper",
    "documents/applications",
    "documents/cv",
    "documents/diplomas",
    "documents/linkedin",
    "documents/postings",
    "documents/references",
)

TRACKER_NAME = "job_search_tracker.csv"

TRACKER_HEADER = (
    "date,company,sector,role,role_type,channel,status,contact_person,"
    "fit_rating,notes,cv_file,cover_letter_file,source,deadline"
)

# Where a client's own candidate profile lives inside their workspace. Claude
# Code loads CLAUDE.md as project instructions before any command runs, so in a
# per-client checkout that file *is* the profile; `profile/` covers a layout
# that keeps the skill-file set alongside it instead.
PROFILE_GLOBS = ("CLAUDE.md", "profile/*.md")

# /setup replaces these when it personalises a profile. Their survival means the
# checkout is still the unedited template - running /apply there would draft a CV
# for nobody.
PLACEHOLDER_MARKERS = ("[YOUR_", "[PLACEHOLDER", "[First]", "[Last]")

# A token shorter than this matches too much ordinary prose to be evidence of
# anything. Operators curate tokens themselves, so the floor only has to stop
# obvious noise ("IT", "SAP" as a word fragment, initials).
MIN_TOKEN_LENGTH = 4

# A token with at least this many digits is treated as a phone number and also
# compared digit-only, so "+45 12 34 56 78" matches "+4512345678".
PHONE_DIGIT_THRESHOLD = 7


class TenancyError(Exception):
    """Raised when a workspace is unusable or a check fails."""


# NFKD decomposes an accented letter into base + combining mark, so "é" survives
# as "e". These do not decompose - they are distinct letters - and would be
# dropped entirely, turning "Søren" into "Sren". The framework's home market is
# Danish, so ø/æ/å are the common case, not an edge case.
TRANSLITERATIONS = {
    "ø": "o", "Ø": "O",
    "æ": "ae", "Æ": "AE",
    "å": "a", "Å": "A",
    "ß": "ss",
    "đ": "d", "Đ": "D",
    "ð": "d", "Ð": "D",
    "ł": "l", "Ł": "L",
    "þ": "th", "Þ": "Th",
}


def slugify(name):
    """Fold a client name into a filesystem-safe directory slug.

    Every character outside [a-zA-Z0-9] collapses to a hyphen, so no separator
    or dot survives into the slug and it cannot express a traversal - "../etc"
    folds to "etc", contained rather than escaping. `workspace_path` re-checks
    containment against the resolved clients/ directory as a second fence. A
    name with nothing usable left is rejected outright.
    """
    if not isinstance(name, str):
        raise TenancyError("client name must be a string")

    transliterated = "".join(TRANSLITERATIONS.get(char, char) for char in name)
    normalized = unicodedata.normalize("NFKD", transliterated)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_only).strip("-").lower()

    if not slug:
        raise TenancyError(
            f"client name {name!r} has no usable characters for a directory name"
        )
    # Defence in depth: the regex above cannot produce these, but the slug is
    # about to become a path component and the check is cheap.
    if slug in {".", ".."} or "/" in slug or "\\" in slug:
        raise TenancyError(f"client name {name!r} produces an unsafe slug {slug!r}")

    return slug


def clients_root(root=ROOT):
    return Path(root) / CLIENTS_DIRNAME


def workspace_path(name, root=ROOT):
    """Resolve a client's workspace, refusing anything outside clients/."""
    base = clients_root(root).resolve()
    candidate = (base / slugify(name)).resolve()

    if candidate != base and base not in candidate.parents:
        raise TenancyError(f"workspace for {name!r} would escape {base}")

    return candidate


def normalize_token(token):
    """Lowercase and collapse whitespace so formatting differences still match."""
    return re.sub(r"\s+", " ", str(token).strip().lower())


def digits_of(value):
    return re.sub(r"\D", "", value)


def load_manifest(workspace):
    manifest_file = Path(workspace) / MANIFEST_NAME
    if not manifest_file.is_file():
        raise TenancyError(f"no {MANIFEST_NAME} in {workspace} - run `init` first")

    try:
        data = json.loads(manifest_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise TenancyError(f"{manifest_file} is not valid JSON: {exc}") from exc

    for key in ("client", "slug", "tokens"):
        if key not in data:
            raise TenancyError(f"{manifest_file} is missing the {key!r} key")
    if not isinstance(data["tokens"], list):
        raise TenancyError(f"{manifest_file}: 'tokens' must be a list")

    return data


def init_client(name, tokens=(), root=ROOT):
    """Create (or top up) an isolated workspace for one client.

    Idempotent: re-running adds any missing directories and merges new tokens
    without disturbing work already in the workspace.
    """
    workspace = workspace_path(name, root)
    workspace.mkdir(parents=True, exist_ok=True)

    for subdir in WORKSPACE_SUBDIRS:
        (workspace / subdir).mkdir(parents=True, exist_ok=True)

    tracker = workspace / TRACKER_NAME
    if not tracker.exists():
        tracker.write_text(TRACKER_HEADER + "\n", encoding="utf-8")

    slug = slugify(name)
    existing = []
    manifest_file = workspace / MANIFEST_NAME
    if manifest_file.is_file():
        existing = load_manifest(workspace).get("tokens", [])

    # The client's own name is always an identity token - it is the single
    # most likely thing to leak into someone else's document.
    merged = list(existing)
    for token in [name, *tokens]:
        cleaned = normalize_token(token)
        if len(cleaned) >= MIN_TOKEN_LENGTH and cleaned not in merged:
            merged.append(cleaned)

    manifest_file.write_text(
        json.dumps({"client": name, "slug": slug, "tokens": merged}, indent=2) + "\n",
        encoding="utf-8",
    )

    return workspace


def check_workspace(name, root=ROOT):
    """Assert the workspace for `name` exists, is intact, and is really theirs.

    Returns the manifest. Raises TenancyError with everything that is wrong,
    so a caller sees the full picture in one failure rather than one per run.
    """
    workspace = workspace_path(name, root)
    if not workspace.is_dir():
        raise TenancyError(f"no workspace for {name!r} at {workspace} - run `init`")

    manifest = load_manifest(workspace)

    problems = []
    if manifest["slug"] != slugify(name):
        problems.append(
            f"manifest belongs to {manifest['client']!r} (slug {manifest['slug']!r}), "
            f"not {name!r}"
        )
    for subdir in WORKSPACE_SUBDIRS:
        if not (workspace / subdir).is_dir():
            problems.append(f"missing directory: {subdir}")
    if not (workspace / TRACKER_NAME).is_file():
        problems.append(f"missing tracker: {TRACKER_NAME}")

    if problems:
        raise TenancyError(
            f"workspace {workspace} failed its integrity check:\n  - "
            + "\n  - ".join(problems)
        )

    return manifest


def foreign_tokens(name, root=ROOT):
    """Identity tokens owned by every OTHER client in this installation.

    Tokens this client also owns are removed, so a shared employer or a common
    surname never registers as contamination.
    """
    own = {normalize_token(t) for t in check_workspace(name, root)["tokens"]}
    base = clients_root(root)

    others = {}
    if not base.is_dir():
        return others

    for entry in sorted(base.iterdir()):
        if not entry.is_dir() or entry.name == slugify(name):
            continue
        manifest_file = entry / MANIFEST_NAME
        if not manifest_file.is_file():
            continue
        try:
            manifest = load_manifest(entry)
        except TenancyError:
            # A half-written workspace should not block another client's audit;
            # `check` is where a broken manifest is that client's problem.
            continue
        for token in manifest["tokens"]:
            cleaned = normalize_token(token)
            if len(cleaned) >= MIN_TOKEN_LENGTH and cleaned not in own:
                others.setdefault(cleaned, manifest["client"])

    return others


def find_token(token, text):
    """Is `token` present in `text` as a standalone match?

    Word-like tokens match across any run of non-alphanumerics between their
    parts, because the drafts being audited are LaTeX: moderncv writes a name
    as \\name{Jane}{Doe}, and a plain "jane doe" search would sail straight
    past the exact contamination that matters most. The surrounding lookarounds
    still keep "Ann" out of "Announce".

    Tokens carrying punctuation (emails) are matched literally, and anything
    phone-shaped is also compared digits-only so formatting cannot hide it.
    """
    haystack = normalize_token(text)

    words = re.findall(r"[a-z0-9]+", token)
    if words and re.fullmatch(r"[\w\s]+", token):
        pattern = r"[^a-z0-9]+".join(re.escape(word) for word in words)
        if re.search(rf"(?<![a-z0-9]){pattern}(?![a-z0-9])", haystack):
            return True
    elif token in haystack:
        return True

    token_digits = digits_of(token)
    if len(token_digits) >= PHONE_DIGIT_THRESHOLD:
        return token_digits in digits_of(haystack)

    return False


def audit_text(name, text, root=ROOT):
    """Return [(token, owning client)] for foreign identities found in `text`."""
    return [
        (token, owner)
        for token, owner in sorted(foreign_tokens(name, root).items())
        if find_token(token, text)
    ]


def audit_files(name, paths, root=ROOT):
    """Audit each path. Returns [(path, token, owning client)] for every hit."""
    others = foreign_tokens(name, root)
    findings = []

    for path in paths:
        target = Path(path)
        if not target.is_file():
            raise TenancyError(f"cannot audit {target} - not a file")
        text = target.read_text(encoding="utf-8", errors="replace")
        for token, owner in sorted(others.items()):
            if find_token(token, text):
                findings.append((str(target), token, owner))

    return findings


def profile_files(name, root=ROOT):
    """Every profile document inside this client's workspace."""
    workspace = workspace_path(name, root)
    found = []
    for pattern in PROFILE_GLOBS:
        found.extend(sorted(p for p in workspace.glob(pattern) if p.is_file()))
    return found


def check_profile(name, root=ROOT):
    """Assert the profile in this client's workspace is theirs and is filled in.

    The contamination audit catches another client's identity in a *draft*.
    This catches it one step earlier, in the profile the draft would be built
    from - which is where running a command in the wrong checkout shows up.

    Returns the list of problems; empty means the profile is sound.
    """
    manifest = check_workspace(name, root)
    documents = profile_files(name, root)

    if not documents:
        return [
            f"no profile found in {workspace_path(name, root)} "
            f"(looked for: {', '.join(PROFILE_GLOBS)})"
        ]

    problems = []
    own = [normalize_token(t) for t in manifest["tokens"]]
    foreign = foreign_tokens(name, root)
    identified = False

    for document in documents:
        text = document.read_text(encoding="utf-8", errors="replace")
        label = document.name

        stale = [marker for marker in PLACEHOLDER_MARKERS if marker in text]
        if stale:
            problems.append(
                f"{label}: still holds template placeholders ({', '.join(sorted(set(stale)))}) "
                "- run /setup in this workspace before drafting"
            )

        if any(find_token(token, text) for token in own):
            identified = True

        for token, owner in sorted(foreign.items()):
            if find_token(token, text):
                problems.append(
                    f"{label}: contains {token!r}, which belongs to {owner!r} "
                    "- this looks like the wrong client's checkout"
                )

    if not identified:
        problems.append(
            f"no profile document mentions {manifest['client']!r} or any of their "
            "registered identifiers - the profile may belong to someone else"
        )

    return problems


def _cmd_init(args):
    workspace = init_client(args.client, args.token or (), root=args.root)
    manifest = load_manifest(workspace)
    print(f"workspace ready: {workspace}")
    print(f"identity tokens: {len(manifest['tokens'])}")
    return 0


def _cmd_check(args):
    manifest = check_workspace(args.client, root=args.root)

    problems = check_profile(args.client, root=args.root)
    if problems:
        print(
            f"PROFILE - workspace for {manifest['client']!r} is intact, but its "
            "profile is not ready. Do not draft from it.",
            file=sys.stderr,
        )
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1

    print(f"OK - workspace and profile for {manifest['client']!r} are sound")
    return 0


def _cmd_audit(args):
    findings = audit_files(args.client, args.files, root=args.root)
    if not findings:
        print(f"OK - no foreign identity tokens in {len(args.files)} file(s)")
        return 0

    print(
        f"CONTAMINATION - {len(findings)} foreign identity token(s) found. "
        "Do not send these documents.",
        file=sys.stderr,
    )
    for path, token, owner in findings:
        print(f"  {path}: {token!r} belongs to {owner!r}", file=sys.stderr)
    return 1


def build_parser():
    parser = argparse.ArgumentParser(
        description="Per-client workspace isolation for multi-client use."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=ROOT,
        help="installation root holding clients/ (default: the repo root)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init", help="create or top up a client workspace")
    init.add_argument("client")
    init.add_argument(
        "--token",
        action="append",
        help="identity token to register (email, phone, employer). Repeatable.",
    )
    init.set_defaults(func=_cmd_init)

    check = sub.add_parser("check", help="assert a workspace exists and is theirs")
    check.add_argument("client")
    check.set_defaults(func=_cmd_check)

    audit = sub.add_parser("audit", help="scan drafts for another client's identity")
    audit.add_argument("client")
    audit.add_argument("files", nargs="+")
    audit.set_defaults(func=_cmd_audit)

    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except TenancyError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

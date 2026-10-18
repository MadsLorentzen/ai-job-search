#!/usr/bin/env python3
"""Supply-chain guards for the template's riskiest surfaces.

Run from anywhere: python tools/security_guards.py

This repo ships pre-approved Claude Code permissions and CLI code that every
fork user executes. These guards make the dangerous changes LOUD, not
impossible: a PR that intentionally needs one of them must update the
allowlists in this file in the same diff, so the change is explicit and
reviewable rather than buried.

Checks:
1. .claude/settings.json — every permissions.allow entry must be in the exact
   allowlist below. Catches permission widening (e.g. Bash(*), Bash(curl:*)),
   which would auto-approve commands on every fork. The same file's `hooks`
   key is held to an allowlist too: a hook runs automatically when its event
   fires, with no prompt, so it is strictly more dangerous than a pre-approved
   permission.
2. .gitignore — the personal-data ignore rules must all still be present,
   and no un-allowlisted negation (!pattern) may re-include them. Catches
   weakening that would make future users silently commit their tracker,
   profile exports, or application archives.
3. .agents/**/package.json — no npm/bun lifecycle scripts (preinstall,
   install, postinstall, prepare, prepack) and no trustedDependencies.
   Catches code execution smuggled into `bun install`.
4. Skill and command frontmatter — every `allowed-tools` entry in
   .claude/skills/*/SKILL.md, .agents/skills/*/SKILL.md and
   .claude/commands/*.md must be in ALLOWED_SKILL_TOOLS (a portal skill may
   instead grant exactly its own CLI). Claude Code pre-approves these for the
   turn that invokes the skill, with no prompt, regardless of workspace trust,
   so the frontmatter is a second permission allowlist. Catches bare Bash and
   glob grants. The settings.json `ask` and `deny` lists are also required to
   keep every rule in REQUIRED_ASK_RULES / REQUIRED_DENY_RULES.
5. Agent definitions — every .claude/agents/*.md must declare `tools:` (a
   missing key means every tool) and each entry must be in
   ALLOWED_AGENT_TOOLS, which has no Edit, Write, NotebookEdit or Agent: the
   shipped agents read untrusted postings. `tools:` is tool-name granularity
   (a `Bash(pattern)` entry resolves to plain Bash), so a patterned entry is
   rejected as misleading; settings.json's allow list is what scopes Bash.

Stdlib only. Exit 0 on success, 1 with a failure list otherwise.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
errors: list[str] = []

# The exact permission entries the template ships. A PR that adds or changes
# an entry must add it here too - that is the point: the diff shows both.
ALLOWED_PERMISSIONS = {
    "Skill(job-application-assistant)",
    # Narrowed from the upstream template's blanket Bash(bun run:*), which
    # pre-approved `bun run <any file>`. One entry per shipped portal CLI,
    # matching what each SKILL.md already declares in its allowed-tools.
    # A portal added by /add-portal needs its own entry here and in
    # .claude/settings.json - that review step is the point.
    "Bash(bun run .agents/skills/jobbank-search/cli/src/cli.ts:*)",
    "Bash(bun run .agents/skills/jobdanmark-search/cli/src/cli.ts:*)",
    "Bash(bun run .agents/skills/jobindex-search/cli/src/cli.ts:*)",
    "Bash(bun run .agents/skills/jobnet-search/cli/src/cli.ts:*)",
    "Bash(bun run .agents/skills/linkedin-search/cli/src/cli.ts:*)",
    "Bash(bun run .agents/skills/freehire-search/cli/src/cli.ts:*)",
    "Bash(python salary_lookup.py:*)",
    "Bash(python3 salary_lookup.py:*)",
    "Bash(python tools/rank_state.py:*)",
    "Bash(python3 tools/rank_state.py:*)",
    "Bash(python tools/job_key.py:*)",
    "Bash(python3 tools/job_key.py:*)",
    "Bash(python tools/verify_pdf.py:*)",
    "Bash(python3 tools/verify_pdf.py:*)",
    "Bash(python tools/verify_layout.py:*)",
    "Bash(python3 tools/verify_layout.py:*)",
    "Bash(pdftotext:*)",
    # The browser-header retry in 09-web-research.md. fetch_page.py is GET-only
    # with a fixed argv and refuses to write inside the repo, which is why the
    # grant names the script and not `curl`.
    "Bash(python tools/robots_check.py:*)",
    "Bash(python3 tools/robots_check.py:*)",
    "Bash(python tools/fetch_page.py:*)",
    "Bash(python3 tools/fetch_page.py:*)",
    # The posting integrity gate (/apply Step 0, /rank Step 2, /interview Step 1).
    # Reads a file or stdin, writes only to an explicit --out, never fetches.
    "Bash(python tools/posting_guard.py:*)",
    "Bash(python3 tools/posting_guard.py:*)",
}

# Rules that must stay in .claude/settings.json permissions.ask. An ask rule
# forces a prompt even when an allow rule or a skill's allowed-tools grant
# would otherwise pre-approve the call. These are the files whose content IS
# the permission surface: a session that could edit them silently could widen
# its own grants. Plus the one outbound git action. Extra ask rules are fine;
# removing one of these fails.
REQUIRED_ASK_RULES = [
    "Edit(.claude/settings.json)",
    "Edit(.claude/settings.local.json)",
    "Edit(.claude/skills/*/SKILL.md)",
    # A command's frontmatter may carry allowed-tools too (check 4 reads it).
    "Edit(.claude/commands/*.md)",
    "Edit(.claude/agents/**)",
    "Edit(.github/**)",
    "Edit(tools/security_guards.py)",
    "Bash(git push:*)",
]

# Rules that must stay in .claude/settings.json permissions.deny. A deny rule
# blocks in every permission mode, bypassPermissions included, and overrides
# any allow rule or skill grant. Two groups: shell that uploads data or opens a
# remote shell (nothing in the workflow does either), and reads of credential
# stores (Read denies also cover Bash cat/head/tail/sed on the path). Prefix
# rules are tripwires, not walls: `curl -sS -d` is not caught by `curl -d`.
# SECURITY.md says so. Extra deny rules are fine; removing one of these fails.
REQUIRED_DENY_RULES = [
    "Read(.env)",
    "Read(.env.*)",
    "Read(~/.ssh/**)",
    "Read(~/.aws/**)",
    "Read(~/.gnupg/**)",
    "Bash(curl -d:*)",
    "Bash(curl --data:*)",
    "Bash(curl -F:*)",
    "Bash(curl --form:*)",
    "Bash(curl -T:*)",
    "Bash(curl --upload-file:*)",
    "Bash(curl -X POST:*)",
    "Bash(curl -X PUT:*)",
    "Bash(curl -XPOST:*)",
    "Bash(curl --request POST:*)",
    "Bash(wget --post-data:*)",
    "Bash(wget --post-file:*)",
    "Bash(wget --method=POST:*)",
    "Bash(scp:*)",
    "Bash(sftp:*)",
    "Bash(ssh:*)",
    "Bash(nc:*)",
    "Bash(ncat:*)",
    "Bash(netcat:*)",
]

# Personal-data ignore rules that must never disappear from .gitignore.
REQUIRED_IGNORE_RULES = [
    "salary_data.json",
    # Depth-independent: the job-scraper skill resolves `job_scraper/` relative
    # to its own directory, so the state file lands under .claude/skills/... and
    # a repo-rooted rule silently fails to match it.
    "**/job_scraper/seen_jobs.json",
    "**/job_scraper/notion_sync.json",
    "**/job_scraper/*.md",
    "*_BehavioralReport.pdf",
    "linkedin_Profile.pdf",
    "cv/main_*.*",
    "!cv/main_example.tex",
    # ATS text extractions (/apply step 5d) carry the CV's full text.
    "cv/*.txt",
    "cover_letters/cover_*.*",
    # /apply also recognizes the uppercase Cover_* naming variant.
    "cover_letters/Cover_*.*",
    "documents/cv/**",
    "documents/linkedin/**",
    "documents/diplomas/**",
    "documents/references/**",
    "documents/projects/**",
    "documents/applications/**",
    "documents/postings/**",
    # Belt-and-braces, not the primary guard: nothing writes here.
    # /interview's prep packs land under documents/applications/**, above.
    "documents/interview/**",
    "job_search_tracker.csv",
    "gmail_sync/",
    "reports/",
    "upskill/*.md",
    # Depth-independent twin of the rule above. The upskill *skill* resolves
    # `upskill/` relative to its own directory - the same observed behavior
    # the **/job_scraper rules exist for - so reports can land at
    # .claude/skills/upskill/upskill/*.md where the rooted rule cannot see
    # them. `**/upskill/*.md` would also ignore the skill's own SKILL.md
    # (the directory shares the name), so the report-file prefix is pinned.
    "**/upskill/report-*.md",
    # Not personal data but the same failure mode: /add-portal can generate a
    # skill for a portal that only returns usable content through a paid
    # fetching service, and that skill reads an API token from the environment.
    ".env",
    ".env.*",
    # Company research cache (/apply Step 3, /interview Step 2). Referenced
    # from commands, not a skill, so a plain rooted rule is correct here -
    # unlike the **/-prefixed job_scraper/upskill rules above.
    "company_research/*.json",
    # Machine-local Claude Code user configuration and ad-hoc permissions approvals.
    ".claude/settings.local.json",
]

# Negation (re-include) rules the template legitimately ships. .gitignore is
# order-sensitive: a later `!pattern` re-includes a path an earlier rule
# excluded, so a rule can be physically present in REQUIRED_IGNORE_RULES yet
# no longer ignored (e.g. adding `!salary_data.json`). Set membership on the
# required rules cannot see that. Any negation outside this allowlist is a
# failure - add an intentional one here in the same PR, exactly as with
# ALLOWED_PERMISSIONS, so the widening is explicit and reviewable.
ALLOWED_IGNORE_NEGATIONS = {
    "!cover_letters/OpenFonts/fonts/**",
    "!cv/main_example.tex",
    "!cover_letters/cover_example.tex",
    "!documents/**/.gitkeep",
}

# Hook commands the template legitimately ships, as "<Event>:<command>" strings.
# Empty by design - the template ships no hooks at all.
#
# A hook is strictly more dangerous than a permissions.allow entry. A permission
# pre-approves something Claude may choose to do; a hook runs unconditionally when
# its event fires, with no prompt and no model decision in between. Cloning a repo
# and opening it is enough. This is the vector the Shai-Hulud worm used in its
# August 2026 wave, planting a SessionStart hook in .claude/settings.json that
# executed on session start:
# https://research.jfrog.com/post/shai-hulud-is-back-august/
ALLOWED_HOOKS: set[str] = set()

FORBIDDEN_SCRIPTS = {"preinstall", "install", "postinstall", "prepare", "prepack"}

# The exact `allowed-tools` entries a skill or command frontmatter may carry.
# Claude Code pre-approves these for the turn that invokes the skill, with no
# prompt, and workspace trust never gates it - so the frontmatter is a second
# permission allowlist and is held to the same bar as settings.json. Tool-level
# entries only: path-scoped Read/Edit rules live in settings.json, and every
# Bash the skills document is allowlisted per command there. A portal skill
# under .agents/skills/<name>/ may additionally grant exactly its own CLI
# (checked structurally below, so no portal name appears here).
ALLOWED_SKILL_TOOLS = {
    "Read",
    "Glob",
    "Grep",
    "WebFetch",
    "WebSearch",
    "Edit",
    "Write",
    "AskUserQuestion",
    "Agent",
    "Bash(bun --version)",
    "Bash(python tools/job_key.py:*)",
    "Bash(python3 tools/job_key.py:*)",
}

# The tools a shipped .claude/agents/*.md may list. These agents read untrusted
# posting text, so nothing that edits or writes files, and no Agent (a subagent
# that could spawn a wider one). Bash is scoped by settings.json's allow list,
# not here: `tools:` is tool-name granularity, verified empirically - a
# `Bash(echo *)` entry gives the agent plain Bash.
ALLOWED_AGENT_TOOLS = {"Read", "Glob", "Grep", "WebFetch", "WebSearch", "Bash"}

_FRONTMATTER_KEY = re.compile(r"^([A-Za-z0-9_-]+):\s*(.*)$")


def _frontmatter(text: str):
    """Parse the YAML-ish frontmatter the repo's skills use, stdlib only.

    Returns a dict, or None when the file has no frontmatter. Handles
    `key: value`, folded/literal scalars (`key: >` / `key: |` followed by
    indented lines), and `key:` followed by `- item` lines. Indented lines
    never start a key, so a folded description mentioning "Bash" cannot be
    mistaken for a grant. Anything fancier than that is not used here, and
    an unrecognised shape surfaces as a missing key rather than a crash.
    """
    text = text.lstrip("﻿")  # a BOM from a Windows editor is not content
    if not text.startswith("---"):
        return None
    lines = text.splitlines()
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return None
    data: dict = {}
    key = None
    for raw in lines[1:end]:
        if raw[:1] in (" ", "\t"):
            if key is None:
                continue
            stripped = raw.strip()
            if stripped.startswith("- "):
                if not isinstance(data[key], list):
                    data[key] = []
                data[key].append(stripped[2:].strip())
            elif isinstance(data[key], str):
                data[key] = (data[key] + " " + stripped).strip()
            continue
        match = _FRONTMATTER_KEY.match(raw)
        if not match:
            key = None
            continue
        key, value = match.group(1), match.group(2).strip()
        data[key] = "" if value in (">", "|", ">-", "|-") else value
    return data


def _tool_entries(value) -> list:
    """Split an `allowed-tools` value into entries (string or list form)."""
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if not isinstance(value, str):
        return []
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):  # YAML flow list
        value = value[1:-1]
    entries, depth, current = [], 0, []
    for char in value:
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(depth - 1, 0)
        if char == "," and depth == 0:
            entries.append("".join(current).strip())
            current = []
        else:
            current.append(char)
    entries.append("".join(current).strip())
    return [entry for entry in entries if entry]


def _own_cli_grant(path: Path) -> set:
    """The two spellings of 'this portal skill may run its own CLI'."""
    try:
        rel = path.relative_to(ROOT).as_posix()
    except ValueError:
        return set()
    parts = rel.split("/")
    if len(parts) == 4 and parts[:2] == [".agents", "skills"] and parts[3] == "SKILL.md":
        cli = f"bun run .agents/skills/{parts[2]}/cli/src/cli.ts"
        return {f"Bash({cli} *)", f"Bash({cli}:*)"}
    return set()


def check_skill_tool_grants() -> None:
    skills = sorted(ROOT.glob(".claude/skills/*/SKILL.md")) + sorted(
        ROOT.glob(".agents/skills/*/SKILL.md")
    )
    commands = sorted((ROOT / ".claude" / "commands").glob("*.md"))
    for path in skills + commands:
        rel = path.relative_to(ROOT).as_posix()
        try:
            data = _frontmatter(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError) as exc:
            errors.append(f"{rel}: unreadable (must be UTF-8): {exc}")
            continue
        if data is None:
            if path in commands:
                continue  # commands may omit frontmatter entirely
            errors.append(f"{rel}: missing or unterminated frontmatter (expected --- ... ---)")
            continue
        # A portal skill may grant exactly its own CLI and nothing else - that is
        # the promise SECURITY.md makes, and portals are leaving the tree anyway.
        own_cli = _own_cli_grant(path)
        permitted = own_cli if own_cli else ALLOWED_SKILL_TOOLS
        for entry in _tool_entries(data.get("allowed-tools", "")):
            if entry in permitted:
                continue
            if "*" in entry and not (
                entry.endswith((" *)", ":*)")) and "*" not in entry[:-2]
            ):
                errors.append(
                    f"{rel}: allowed-tools entry uses a wildcard inside the pattern: "
                    f"{entry!r}. A glob here pre-approves whatever lands at that path, "
                    "including code added later; name the exact command instead."
                )
                continue
            errors.append(
                f"{rel}: allowed-tools entry not in the reviewed allowlist: {entry!r}. "
                "Claude Code pre-approves allowed-tools for the turn that invokes the "
                "skill, with no prompt and regardless of workspace trust, so this line is "
                "a permission allowlist like settings.json. Bare Bash means any command. "
                "If the grant is intentional, add it to ALLOWED_SKILL_TOOLS in "
                "tools/security_guards.py in the same PR; a portal skill may grant only "
                "its own .agents/skills/<name>/cli/src/cli.ts."
            )


def _hook_commands(event: str, entries: object):
    """Yield "<Event>:<command>" for every command a hook event would run.

    Fails closed: any shape this does not recognise yields a marker that cannot
    be in the allowlist, so an unfamiliar hook layout is rejected rather than
    silently skipped.
    """
    unrecognised = f"{event}:<unrecognised hook shape>"
    if not isinstance(entries, list):
        yield unrecognised
        return
    for entry in entries:
        if not isinstance(entry, dict):
            yield unrecognised
            continue
        inner = entry.get("hooks")
        if not isinstance(inner, list):
            yield unrecognised
            continue
        for hook in inner:
            command = hook.get("command") if isinstance(hook, dict) else None
            yield f"{event}:{command}" if isinstance(command, str) else unrecognised


def check_permissions() -> None:
    path = ROOT / ".claude" / "settings.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f".claude/settings.json: unreadable or invalid JSON: {exc}")
        return
    if not isinstance(data, dict):
        errors.append(".claude/settings.json: top-level JSON value must be an object")
        return

    # Checked before the permissions shape guards below, so a file that pairs a
    # malformed permissions block with a hook cannot return early and skip this.
    hooks = data.get("hooks", {})
    if hooks:
        if not isinstance(hooks, dict):
            errors.append(".claude/settings.json: hooks must be an object")
        else:
            for event, entries in hooks.items():
                for command in _hook_commands(str(event), entries):
                    if command not in ALLOWED_HOOKS:
                        errors.append(
                            f".claude/settings.json: hook not in the reviewed allowlist: "
                            f"{command!r}. A hook runs automatically when its event fires - it "
                            "is never gated by the permissions prompt, so it executes on every "
                            "fork without the user agreeing to anything. If this hook is "
                            "intentional, add it to ALLOWED_HOOKS in tools/security_guards.py "
                            "in the same PR so the addition is explicit and reviewable."
                        )

    permissions = data.get("permissions", {})
    if not isinstance(permissions, dict):
        errors.append(".claude/settings.json: permissions must be an object")
        return
    allow = permissions.get("allow", [])
    if not isinstance(allow, list) or not all(isinstance(entry, str) for entry in allow):
        errors.append(".claude/settings.json: permissions.allow must be a list of strings")
        return
    for entry in allow:
        if entry not in ALLOWED_PERMISSIONS:
            errors.append(
                f".claude/settings.json: permission not in the reviewed allowlist: {entry!r}. "
                "Pre-approved permissions run without prompting on every fork. If this entry is "
                "intentional, add it to ALLOWED_PERMISSIONS in tools/security_guards.py in the "
                "same PR so the widening is explicit and reviewable."
            )
    for entry in ALLOWED_PERMISSIONS - set(allow):
        # Not an error: settings may legitimately drop an entry. But an
        # allowlist entry that no longer exists should be pruned.
        print(f"note: allowlisted permission not present in settings.json: {entry!r}")

    for key, required, effect in (
        ("ask", REQUIRED_ASK_RULES, "an ask rule forces a prompt even over a skill grant"),
        ("deny", REQUIRED_DENY_RULES, "a deny rule blocks in every mode, bypass included"),
    ):
        rules = permissions.get(key, [])
        if not isinstance(rules, list) or not all(isinstance(entry, str) for entry in rules):
            errors.append(f".claude/settings.json: permissions.{key} must be a list of strings")
            continue
        present = set(rules)
        for rule in required:
            if rule not in present:
                errors.append(
                    f".claude/settings.json: required {key} rule missing: {rule!r}. "
                    f"Removing it silently re-opens what it closed ({effect}). If the "
                    f"change is intentional, update REQUIRED_{key.upper()}_RULES in "
                    "tools/security_guards.py in the same PR so the widening is explicit "
                    "and reviewable."
                )


def check_gitignore() -> None:
    path = ROOT / ".gitignore"
    try:
        lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    except OSError as exc:
        errors.append(f".gitignore: unreadable: {exc}")
        return
    rules = set(lines)
    for rule in REQUIRED_IGNORE_RULES:
        if rule not in rules:
            errors.append(
                f".gitignore: required personal-data rule missing: {rule!r}. "
                "These rules keep fork users from committing personal data. If the rule moved "
                "or was renamed intentionally, update REQUIRED_IGNORE_RULES in "
                "tools/security_guards.py in the same PR."
            )
    for line in lines:
        if line.startswith("!") and line not in ALLOWED_IGNORE_NEGATIONS:
            errors.append(
                f".gitignore: negation rule not in the reviewed allowlist: {line!r}. "
                "A negation re-includes a path an earlier rule excluded and can silently "
                "re-expose personal data (a required ignore rule stays present but stops "
                "taking effect). If this negation is intentional, add it to "
                "ALLOWED_IGNORE_NEGATIONS in tools/security_guards.py in the same PR."
            )


def check_package_manifests() -> None:
    manifests = [
        p for p in ROOT.glob(".agents/**/package.json") if "node_modules" not in p.parts
    ]
    if not manifests:
        errors.append(".agents: no package.json files found - glob roots are wrong or the tree moved")
    for manifest in manifests:
        relpath = manifest.relative_to(ROOT)
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"{relpath}: unreadable or invalid JSON: {exc}")
            continue
        if not isinstance(data, dict):
            errors.append(f"{relpath}: top-level JSON value must be an object")
            continue
        scripts = data.get("scripts", {})
        if not isinstance(scripts, dict):
            errors.append(f"{relpath}: scripts must be an object")
            continue
        bad = FORBIDDEN_SCRIPTS & set(scripts)
        if bad:
            errors.append(
                f"{relpath}: lifecycle script(s) {sorted(bad)} are forbidden - they execute "
                "arbitrary code during `bun install` on every fork user's machine."
            )
        if "trustedDependencies" in data:
            errors.append(
                f"{relpath}: trustedDependencies is forbidden - it re-enables dependency "
                "lifecycle scripts that bun blocks by default."
            )


def check_tracked_node_modules() -> None:
    """Fail on any tracked path with a ``node_modules`` component.

    ``.gitignore``'s old ``node_modules/`` rule matched directories only, so a
    symlink or plain file named ``node_modules`` (a contributor's local symlink
    to an absolute path, #623) was committed, broke ``bun install`` in CI with a
    dangling link, and checked out as a text file on Windows. The rule now has
    no trailing slash; this check catches what the rule cannot, such as a copy
    force-added or inherited from before the rule changed. Skipped quietly when
    the tree is not a git checkout (the guard also runs from a bare copy).
    """
    try:
        proc = subprocess.run(
            ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=False
        )
    except OSError:
        return
    if proc.returncode != 0:
        return
    for rel in proc.stdout.decode("utf-8", errors="replace").split("\x00"):
        if rel and "node_modules" in rel.split("/"):
            errors.append(
                f"tracked path inside node_modules: {rel!r}. Installed dependencies "
                "(or a symlink standing in for them) must never be committed: run "
                "`git rm --cached` on it; .gitignore's `node_modules` rule keeps it out."
            )


def check_agent_tool_grants() -> None:
    for path in sorted((ROOT / ".claude" / "agents").glob("*.md")):
        rel = path.relative_to(ROOT).as_posix()
        try:
            data = _frontmatter(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError) as exc:
            errors.append(f"{rel}: unreadable (must be UTF-8): {exc}")
            continue
        if data is None:
            errors.append(f"{rel}: missing or unterminated frontmatter (expected --- ... ---)")
            continue
        if "tools" not in data or not _tool_entries(data.get("tools")):
            errors.append(
                f"{rel}: no `tools:` key - an agent without one gets every tool, including "
                "Edit, Write and Bash. Shipped agents read untrusted posting text; declare "
                f"an explicit list drawn from {sorted(ALLOWED_AGENT_TOOLS)}."
            )
            continue
        for entry in _tool_entries(data.get("tools")):
            if entry in ALLOWED_AGENT_TOOLS:
                continue
            if "(" in entry:
                errors.append(
                    f"{rel}: tools entry {entry!r} looks scoped but is not - an agent's "
                    "`tools:` list is tool-name granularity (a `Bash(pattern)` entry gives "
                    "the agent plain Bash). List the bare tool and let settings.json's "
                    "allow list scope it."
                )
                continue
            errors.append(
                f"{rel}: tools entry not in the reviewed allowlist: {entry!r}. Shipped agent "
                "definitions read untrusted posting text, so they may not edit or write "
                "files or spawn further agents. If the grant is intentional, add it to "
                "ALLOWED_AGENT_TOOLS in tools/security_guards.py in the same PR."
            )


def main() -> int:
    check_permissions()
    check_gitignore()
    check_package_manifests()
    check_tracked_node_modules()
    check_skill_tool_grants()
    check_agent_tool_grants()
    if errors:
        print(f"security_guards: {len(errors)} failure(s)")
        for err in errors:
            print(f"  - {err}")
        return 1
    print(
        "security_guards: OK (permissions allowlist, hooks allowlist, gitignore rules, "
        "package manifests, no tracked node_modules, skill/command allowed-tools, agent tools)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

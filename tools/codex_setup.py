#!/usr/bin/env python3
"""Check local Codex dependencies or list portal CLIs without running a search."""

import argparse
import importlib.util
import json
import re
import shutil
import sys
from pathlib import Path

repoRoot = Path(__file__).resolve().parent.parent


def findPortals(root):
    portals = []
    for manifest in sorted(root.glob(".agents/skills/*/cli/package.json")):
        skillDir = manifest.parent.parent
        skillPath = skillDir / "SKILL.md"
        cliPath = manifest.parent / "src" / "cli.ts"
        if not skillPath.is_file() or not cliPath.is_file():
            raise ValueError(f"Incomplete portal: {skillDir.name} needs SKILL.md and cli/src/cli.ts")
        portals.append({"name": skillDir.name, "skill": skillPath.relative_to(root).as_posix(), "cli": cliPath.relative_to(root).as_posix()})
    return portals


def checkSetup(root, requireDocuments=False):
    checks = []
    checks.append((sys.version_info >= (3, 10), True, "Python 3.10+", sys.version.split()[0]))
    for moduleName in ("yaml", "pypdf"):
        found = importlib.util.find_spec(moduleName) is not None
        installName = "pyyaml" if moduleName == "yaml" else moduleName
        checks.append((found, True, installName, "installed" if found else f"install with: python -m pip install {installName}"))

    for toolName in ("bun", "lualatex", "xelatex", "pdftoppm", "pdftotext"):
        toolPath = shutil.which(toolName)
        required = toolName == "bun" or requireDocuments
        checks.append((bool(toolPath), required, toolName, toolPath or "not on PATH"))

    for source in ("AGENTS.md", "CLAUDE.md", ".agents/skills/job-search-assistant/SKILL.md"):
        checks.append(((root / source).is_file(), True, source, "required instruction file"))

    skillPath = root / ".agents" / "skills" / "job-search-assistant" / "SKILL.md"
    if skillPath.is_file():
        sourceText = skillPath.read_text(encoding="utf-8")
        routes = re.findall(r"\| ([a-z-]+) \| `([^`]+)` \|", sourceText)
        expectedNames = {path.stem for path in (root / ".claude" / "commands").glob("*.md")} | {"scrape", "upskill"}
        names = [name for name, _ in routes]
        checks.append((set(names) == expectedNames and len(names) == len(set(names)), True, "Workflow coverage", f"{len(routes)} routes to canonical sources"))
        for name, source in routes:
            sourcePath = (root / source).resolve()
            valid = sourcePath.is_relative_to(root.resolve()) and sourcePath.is_file()
            checks.append((valid, True, name, source))

    try:
        portals = findPortals(root)
        checks.append((bool(portals), True, "Portal discovery", f"{len(portals)} CLIs; workflow skills excluded"))
    except ValueError as error:
        checks.append((False, True, "Portal discovery", str(error)))
    return checks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portals", action="store_true", help="Print portal paths as JSON; no dependency checks or network calls.")
    parser.add_argument("--documents", action="store_true", help="Require LaTeX and Poppler tools for document generation.")
    args = parser.parse_args()
    if args.portals:
        if args.documents:
            parser.error("use --portals or --documents, not both")
        try:
            print(json.dumps(findPortals(repoRoot), indent=2))
            return 0
        except ValueError as error:
            print(str(error), file=sys.stderr)
            return 1

    checks = checkSetup(repoRoot, args.documents)
    for passed, required, name, detail in checks:
        status = "OK" if passed else "MISSING" if required else "OPTIONAL"
        print(f"{status}: {name} - {detail}")
    failed = any(required and not passed for passed, required, _, _ in checks)
    if failed:
        print("Install missing requirements, then rerun this check. See CODEX_SETUP.md.")
    else:
        print("Local prerequisites found. This does not test Codex login, live portals, or generated documents.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

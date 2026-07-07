from __future__ import annotations

import argparse
from pathlib import Path


def convert_apply_spec(apply_md: Path, output: Path) -> None:
    """Minimal helper that snapshots the canonical Claude apply spec into a template."""
    source = apply_md.read_text(encoding="utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        '{"role":"system","max_tokens":4096,"temperature":0.1}\n'
        "## SYSTEM\n"
        "You are implementing the ai-job-search /apply workflow. Treat the embedded Claude spec as canonical.\n\n"
        "## INSTRUCTION\n"
        "{{JOB_POSTING}}\n\n"
        "Canonical spec excerpt:\n\n"
        f"{source}\n",
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Snapshot Claude markdown specs into orchestrator templates.")
    parser.add_argument("--apply-md", default=".claude/commands/apply.md")
    parser.add_argument("--output", default="orchestrator/prompts/drafter.tpl.md")
    args = parser.parse_args(argv)
    convert_apply_spec(Path(args.apply_md), Path(args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

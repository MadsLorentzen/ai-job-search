#!/usr/bin/env python3
"""Record what each application actually costs, and price from the record.

Phase 5 of the consultancy plan asks a question no estimate can answer: what
does one `/apply` run cost? A run is a fit evaluation, a full CV and cover
letter draft, a reviewer subagent with its own context, PDF compile-and-inspect
iterations carrying rendered pages as image input, and an ATS pass. The spread
between a clean run and one that fights a two-page overflow is wide enough that
a guess is worthless as a basis for pricing.

So this does not estimate. It records real runs and reports the distribution,
and it refuses to produce a price from a sample too small to support one.

    costs record --client "Jane Doe" --company Acme --role "Data Scientist" \\
                 --input 82000 --output 14000 --cache-read 40000
    costs report

Token counts come from the API response's `usage` block. Pricing lives in
PRICING below - rates change, so it is data to be checked against Anthropic's
published pricing, not a constant to trust indefinitely.

Stdlib only.
"""

import argparse
import json
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEDGER_NAME = "costs/applications.jsonl"

# USD per million tokens. Cached 2026-06-24 - verify against
# https://www.anthropic.com/pricing before quoting a client.
# Cache reads bill at roughly 0.1x input; cache writes at roughly 1.25x.
PRICING = {
    "claude-opus-5":   {"input": 5.00, "output": 25.00},
    "claude-sonnet-5": {"input": 2.00, "output": 10.00},
    "claude-haiku-4-5": {"input": 1.00, "output": 5.00},
}
DEFAULT_MODEL = "claude-opus-5"
CACHE_READ_MULTIPLIER = 0.1
CACHE_WRITE_MULTIPLIER = 1.25

# Below this many runs the spread is not yet a distribution, and quoting from
# it would be guessing with extra steps.
MIN_SAMPLE_FOR_PRICING = 5


class CostError(Exception):
    """Raised when a run cannot be recorded or priced."""


def ledger_path(root=ROOT):
    return Path(root) / LEDGER_NAME


def cost_of(record):
    """USD for one recorded run."""
    model = record.get("model", DEFAULT_MODEL)
    rates = PRICING.get(model)
    if rates is None:
        raise CostError(
            f"no pricing for model {model!r} - add it to PRICING in tools/costs.py"
        )

    per_token_in = rates["input"] / 1_000_000
    per_token_out = rates["output"] / 1_000_000

    return (
        record.get("input_tokens", 0) * per_token_in
        + record.get("output_tokens", 0) * per_token_out
        + record.get("cache_read_tokens", 0) * per_token_in * CACHE_READ_MULTIPLIER
        + record.get("cache_write_tokens", 0) * per_token_in * CACHE_WRITE_MULTIPLIER
    )


def record_run(root=ROOT, **fields):
    """Append one run to the ledger. Returns the stored record."""
    for required in ("client", "company", "role"):
        if not fields.get(required):
            raise CostError(f"{required} is required - an unattributed run cannot be priced")

    model = fields.get("model") or DEFAULT_MODEL
    if model not in PRICING:
        raise CostError(f"unknown model {model!r} - known: {', '.join(sorted(PRICING))}")

    counts = {
        key: int(fields.get(key) or 0)
        for key in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens")
    }
    if any(value < 0 for value in counts.values()):
        raise CostError("token counts cannot be negative")
    if counts["input_tokens"] == 0 and counts["output_tokens"] == 0:
        raise CostError("a run with no input and no output tokens is not a run")

    entry = {
        "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "client": fields["client"],
        "company": fields["company"],
        "role": fields["role"],
        "model": model,
        **counts,
        "notes": fields.get("notes") or "",
    }
    entry["usd"] = round(cost_of(entry), 4)

    target = ledger_path(root)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry) + "\n")

    return entry


def load_runs(root=ROOT, client=None):
    """Every recorded run, optionally for one client. Skips nothing silently."""
    target = ledger_path(root)
    if not target.is_file():
        return []

    runs = []
    for number, line in enumerate(target.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError as exc:
            raise CostError(f"{target} line {number} is not valid JSON: {exc}") from exc
        if client is None or entry.get("client") == client:
            runs.append(entry)
    return runs


def summarise(runs):
    """Distribution of per-application cost, or None when there is nothing."""
    if not runs:
        return None

    amounts = sorted(cost_of(run) for run in runs)
    return {
        "count": len(amounts),
        "total": sum(amounts),
        "mean": statistics.fmean(amounts),
        "median": statistics.median(amounts),
        "min": amounts[0],
        "max": amounts[-1],
        # With a handful of runs a true p90 is not meaningful; the worst
        # observed run is the honest stand-in for "plan for this".
        "worst": amounts[-1],
    }


def format_report(runs, margin):
    lines = []
    stats = summarise(runs)

    if stats is None:
        lines.append("No applications recorded yet.")
        lines.append("")
        lines.append("Record one after each /apply run, reading the token counts")
        lines.append("from the API response's usage block:")
        lines.append('  costs record --client "Jane Doe" --company Acme \\')
        lines.append('               --role "Data Scientist" --input 82000 --output 14000')
        return lines

    lines.append(f"Applications recorded: {stats['count']}")
    lines.append(f"Total spend:           ${stats['total']:.2f}")
    lines.append("")
    lines.append("Cost per application")
    lines.append(f"  mean    ${stats['mean']:.3f}")
    lines.append(f"  median  ${stats['median']:.3f}")
    lines.append(f"  range   ${stats['min']:.3f} - ${stats['max']:.3f}")
    lines.append("")

    if stats["count"] < MIN_SAMPLE_FOR_PRICING:
        lines.append(
            f"Too few runs to price from ({stats['count']} of {MIN_SAMPLE_FOR_PRICING} "
            "minimum). The spread is not yet a distribution - keep recording."
        )
        return lines

    # Price against the worst observed run, not the mean: a quote that only
    # covers the average loses money on every application that fights a
    # two-page overflow, and those are not rare.
    floor = stats["worst"] * (1 + margin)
    lines.append(f"Price floor at {int(margin * 100)}% margin over the worst observed run")
    lines.append(f"  ${floor:.2f} per application")
    lines.append("")
    lines.append("This is cost of goods only. It excludes your time, which for a")
    lines.append("consultancy is the larger number.")
    return lines


def _cmd_record(args):
    entry = record_run(
        root=args.root,
        client=args.client,
        company=args.company,
        role=args.role,
        model=args.model,
        input_tokens=args.input_tokens,
        output_tokens=args.output_tokens,
        cache_read_tokens=args.cache_read,
        cache_write_tokens=args.cache_write,
        notes=args.notes,
    )
    print(f"recorded {entry['company']} / {entry['role']} for {entry['client']}: "
          f"${entry['usd']:.3f}")
    return 0


def _cmd_report(args):
    print("\n".join(format_report(load_runs(args.root, args.client), args.margin)))
    return 0


def build_parser():
    parser = argparse.ArgumentParser(description="Per-application cost ledger.")
    parser.add_argument("--root", type=Path, default=ROOT)
    sub = parser.add_subparsers(dest="command", required=True)

    record = sub.add_parser("record", help="record one /apply run")
    record.add_argument("--client", required=True)
    record.add_argument("--company", required=True)
    record.add_argument("--role", required=True)
    record.add_argument("--model", default=DEFAULT_MODEL)
    record.add_argument("--input", dest="input_tokens", type=int, default=0)
    record.add_argument("--output", dest="output_tokens", type=int, default=0)
    record.add_argument("--cache-read", type=int, default=0)
    record.add_argument("--cache-write", type=int, default=0)
    record.add_argument("--notes", default="")
    record.set_defaults(func=_cmd_record)

    report = sub.add_parser("report", help="cost distribution and a price floor")
    report.add_argument("--client", help="limit to one client")
    report.add_argument("--margin", type=float, default=0.5,
                        help="margin over the worst observed run (default 0.5 = 50%%)")
    report.set_defaults(func=_cmd_report)

    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except CostError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

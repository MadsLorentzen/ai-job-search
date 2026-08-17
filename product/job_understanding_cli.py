"""Thin developer CLI for hosted Job Understanding extraction."""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Any

from product.job_understanding import (
    EVIDENCE_CATEGORIES,
    JobUnderstandingValidationError,
    extract_job_understanding,
)
from product.job_understanding_providers import JobUnderstandingProviderError
from product.openai_job_understanding_provider import OpenAIJobUnderstandingProvider


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Extract grounded job evidence through a hosted provider"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    extract = commands.add_parser("extract", help="extract one Job Posting Snapshot")
    extract.add_argument("job_snapshot", type=Path)
    extract.add_argument("--provider", choices=("openai",), required=True)
    extract.add_argument("--request-id")
    extract.add_argument(
        "--category",
        action="append",
        choices=EVIDENCE_CATEGORIES,
        dest="categories",
    )
    return parser


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    provider = OpenAIJobUnderstandingProvider()
    request_id = args.request_id or f"hosted-{uuid.uuid4().hex}"
    try:
        result = extract_job_understanding(
            _load_json(args.job_snapshot),
            provider,
            request_id,
            requested_categories=args.categories,
        )
    except JobUnderstandingProviderError as exc:
        print(
            json.dumps({"error": "provider_error", "message": str(exc)}),
            file=sys.stderr,
        )
        return 2
    except JobUnderstandingValidationError as exc:
        print(
            json.dumps(
                {
                    "error": "validation_error",
                    "message": "job understanding failed local validation",
                    "error_count": min(len(exc.errors), 100),
                }
            ),
            file=sys.stderr,
        )
        return 3
    except (FileNotFoundError, OSError, UnicodeError, json.JSONDecodeError):
        print(
            json.dumps({"error": "input_error", "message": "could not load job snapshot"}),
            file=sys.stderr,
        )
        return 4
    except Exception:
        print(
            json.dumps({"error": "unexpected_error"}),
            file=sys.stderr,
        )
        return 5

    print(json.dumps(result, ensure_ascii=False, indent=2))
    if provider.last_audit is not None:
        print(
            json.dumps({"provider_audit": asdict(provider.last_audit)}),
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

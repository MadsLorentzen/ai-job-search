"""Rank normalized local jobs with the Ollama provider."""

import argparse
import json
import sys
from pathlib import Path

from app.jobs.models import Job
from app.llm.ollama import OllamaProvider
from app.ranking.scoring import RankingEvidence, rank_job
from app.state.models import RemoteStatus


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = REPO_ROOT / "job_scraper" / "seen_jobs.json"


def _load_jobs(path: Path) -> list[Job]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    records = payload.get("jobs", payload.get("seen", payload))
    if isinstance(records, dict):
        records = list(records.values())
    jobs = []
    for record in records:
        record = dict(record)
        record["remote_status"] = RemoteStatus(record.get("remote_status", "unknown"))
        jobs.append(Job(**{key: value for key, value in record.items() if key in Job.__dataclass_fields__}))
    return jobs


def rank_local_jobs(path: Path, model: str | None = None) -> list[dict]:
    jobs = _load_jobs(path)
    provider = OllamaProvider(model=model or "llama3.2")
    if not provider.health_check():
        raise RuntimeError("Ollama is not reachable at http://localhost:11434")
    results = []
    for job in jobs:
        # The deterministic score engine requires evidence; without a populated
        # profile, retain a neutral baseline rather than inventing fit claims.
        result = rank_job(job, RankingEvidence(0, 0, 0, 0, eligibility="unknown"))
        results.append({"job_id": result.job_id, "title": job.title, "company": job.company, "score": result.overall_score, "tier": result.tier})
    return results


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Rank locally scraped jobs")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--model", default=None)
    args = parser.parse_args(argv)
    try:
        results = rank_local_jobs(args.input, args.model)
        print(json.dumps(results, indent=2))
        return 0
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        print(f"rank failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
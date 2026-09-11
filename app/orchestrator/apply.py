"""Core local application workflow with explicit approval boundaries."""

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from app.applications.drafting import ApplicationContext, draft_application, evaluate_fit
from app.applications.models import DraftBundle, FitEvaluation, ReviewResult
from app.applications.reviewing import review_application
from app.documents.pipeline import PDFValidation, validate_pdf
from app.llm.context import ContextBudgetPolicy
from app.llm.provider import LLMProvider
from app.state.journal import TransactionalJournal
from app.state.machine import StateMachine
from app.state.models import (
    ApplicationStatus,
    FailureStage,
    WorkflowStage,
    WorkflowState,
)
import argparse
import sys


@dataclass
class ApplicationRun:
    state: WorkflowState
    fit: Optional[FitEvaluation] = None
    drafts: Optional[DraftBundle] = None
    review: Optional[ReviewResult] = None
    cv_pdf: Optional[PDFValidation] = None
    cover_letter_pdf: Optional[PDFValidation] = None


class ApplicationOrchestrator:
    """Run the local application path without submitting anything externally."""

    def __init__(
        self,
        provider: LLMProvider,
        journal: TransactionalJournal,
        *,
        context_policy: ContextBudgetPolicy | None = None,
    ):
        self.provider = provider
        self.journal = journal
        self.context_policy = context_policy or ContextBudgetPolicy()

    def run(
        self,
        job_id: str,
        context: ApplicationContext,
        *,
        approve_fit: Callable[[FitEvaluation], bool],
        approve_final: Callable[[ApplicationRun], bool],
        cv_pdf: Path | None = None,
        cover_letter_pdf: Path | None = None,
        pdf_runner=None,
    ) -> ApplicationRun:
        run = ApplicationRun(WorkflowState(job_id=job_id))
        machine = StateMachine(run.state)
        self._save(run.state)
        try:
            for stage in (
                WorkflowStage.NORMALIZED,
                WorkflowStage.FILTERED,
                WorkflowStage.RANKED,
                WorkflowStage.SHORTLISTED,
            ):
                machine.transition_to(stage)
                self._save(run.state)

            machine.transition_to(WorkflowStage.ANALYZING)
            run.fit = evaluate_fit(self.provider, context, self.context_policy)
            self._save(run.state)
            if not approve_fit(run.fit):
                machine.mark_failed(FailureStage.CANCELLED, "Fit evaluation was not approved")
                self._save(run.state)
                return run

            machine.transition_to(WorkflowStage.DRAFTING)
            run.drafts = draft_application(self.provider, context, self.context_policy)
            self._save(run.state)
            machine.transition_to(WorkflowStage.REVIEWING)
            run.review = review_application(
                self.provider, context, run.drafts.cv_source, run.drafts.cover_letter_source
            )
            if not run.review.approved:
                self._save(run.state)
                return run

            machine.transition_to(WorkflowStage.READY_FOR_APPROVAL)
            self._save(run.state)
            if not approve_final(run):
                machine.mark_failed(FailureStage.CANCELLED, "Final artifacts were not approved")
                self._save(run.state)
                return run

            machine.transition_to(WorkflowStage.COMPILING)
            machine.transition_to(WorkflowStage.VALIDATING)
            if cv_pdf is not None and cover_letter_pdf is not None:
                run.cv_pdf = validate_pdf(cv_pdf, expected_pages=2, runner=pdf_runner) if pdf_runner else None
                run.cover_letter_pdf = validate_pdf(cover_letter_pdf, expected_pages=1, runner=pdf_runner) if pdf_runner else None
                if (
                    run.cv_pdf and not run.cv_pdf.passed
                ) or (
                    run.cover_letter_pdf and not run.cover_letter_pdf.passed
                ):
                    machine.mark_failed(FailureStage.BLOCKED_VALIDATION, "PDF validation failed")
                    self._save(run.state)
                    return run

            machine.transition_to(WorkflowStage.READY_TO_ARCHIVE)
            machine.transition_to(WorkflowStage.ARCHIVED, ApplicationStatus.COMPLETED)
            self._save(run.state)
            return run
        except Exception as exc:
            machine.mark_failed(FailureStage.BLOCKED_PROVIDER, str(exc))
            self._save(run.state)
            raise

    def _save(self, state: WorkflowState) -> None:
        self.journal.save_state(state)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the local application workflow")
    parser.add_argument("--job", type=Path, help="JSON file containing job posting context")
    parser.add_argument("--profile", type=Path, help="Candidate profile text file")
    parser.add_argument("--dry-run", action="store_true", help="Validate inputs without writing application files")
    args = parser.parse_args(argv)
    if not args.job or not args.profile:
        parser.error("--job and --profile are required; no application files are generated without explicit inputs")
    try:
        json_payload = __import__("json").loads(args.job.read_text(encoding="utf-8-sig"))
        if isinstance(json_payload, dict) and "results" in json_payload:
            results = json_payload["results"]
            if not isinstance(results, list) or len(results) != 1:
                raise ValueError("job JSON collection must contain exactly one result for apply")
            json_payload = results[0]
        posting = json_payload.get("description", json_payload.get("posting", ""))
        if not posting:
            raise ValueError("job JSON must contain 'description' or 'posting'")
        profile = args.profile.read_text(encoding="utf-8")
        if args.dry_run:
            print(f"Validated job context ({len(posting)} chars) and profile ({len(profile)} chars)")
            print("Dry run complete; no LLM call or application file was written")
            return 0
        print("Application orchestration requires an explicit embedding with approval callbacks.", file=sys.stderr)
        print("Use ApplicationOrchestrator.run(...) from Python; no files were written.", file=sys.stderr)
        return 2
    except (OSError, ValueError, __import__("json").JSONDecodeError) as exc:
        print(f"apply failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
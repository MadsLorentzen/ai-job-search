from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path
from typing import Any

from orchestrator.adapters import AdapterError, build_adapter
from orchestrator.config import load_config
from orchestrator.utils import (
    apply_structured_edits,
    cleanup_latex_artifacts,
    executable_exists,
    load_template,
    parse_json_object,
    parse_reviewer_response,
    read_profile_bundle,
    read_text,
    redact_pii,
    render_template,
    run_command,
    sanitize_filename_part,
    write_text,
)


PROMPT_DIR = Path(__file__).parent / "prompts"


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "apply":
        return run_apply(args)
    if args.command == "setup":
        return run_setup(args)
    parser.print_help()
    return 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the ai-job-search LLM orchestrator.")
    parser.add_argument("--config", help="Path to .ai-job-search.json or compatible config file.")
    subparsers = parser.add_subparsers(dest="command")

    apply_parser = subparsers.add_parser("apply", help="Run the drafter-reviewer apply workflow.")
    apply_parser.add_argument("--job-text-file", help="Path to a pasted job posting file.")
    apply_parser.add_argument("--url", help="Optional job posting URL. Requires --allow-live-fetch.")
    apply_parser.add_argument("--allow-live-fetch", action="store_true", help="Allow fetching --url content.")
    apply_parser.add_argument("--backend", default=None, help="Backend: mock, openai, openai_chat, codex_compat.")
    apply_parser.add_argument("--profile", default="./CLAUDE.md", help="Candidate profile path.")
    apply_parser.add_argument("--output-dir", default=".", help="Directory where cv/ and cover_letters/ are written.")
    apply_parser.add_argument("--yes", action="store_true", help="Proceed without interactive confirmation.")
    apply_parser.add_argument("--local-only", action="store_true", help="Refuse remote API calls and produce a dry run.")
    apply_parser.add_argument("--skip-compile", action="store_true", help="Skip LaTeX and ATS checks.")
    apply_parser.add_argument("--verbose", action="store_true", help="Include full profile content in prompts.")
    apply_parser.add_argument("--log-full-prompts", action="store_true", help="Allow full prompt logging by adapters/tools.")

    setup_parser = subparsers.add_parser("setup", help="Read existing profile inputs for orchestrator readiness.")
    setup_parser.add_argument("--profile", default="./CLAUDE.md")
    return parser


def run_apply(args: argparse.Namespace) -> int:
    root = Path.cwd()
    config = load_config(args.config, root=root)
    if args.backend:
        config.backend = args.backend
    if args.local_only:
        config.safety.local_only = True
    if args.log_full_prompts:
        config.safety.log_full_prompts = True

    backend = config.backend
    output_dir = Path(args.output_dir)
    profile_path = Path(args.profile)
    job_posting = load_job_posting(args)

    if config.safety.local_only and backend != "mock":
        report = output_dir / "orchestrator_apply_report.md"
        write_text(
            report,
            "# ai-job-search Orchestrator Dry Run\n\n"
            f"Backend `{backend}` was requested, but `--local-only` is enabled. "
            "No candidate or job content was uploaded.\n",
        )
        print(f"Local-only mode refused remote backend `{backend}`. Wrote dry-run report to {report}.")
        return 0

    if backend != "mock":
        if not confirm_privacy_notice(backend, args.yes):
            print("Aborted before uploading candidate or job content.")
            return 1

    adapter = build_adapter(backend, config)
    profile_snippet = read_profile_bundle(profile_path, root, verbose=args.verbose)
    print(f"[orchestrator] start backend={backend}")
    parsed = model_json_call(
        adapter,
        "parse_input.tpl.md",
        config,
        {"JOB_POSTING": job_posting},
        fallback={"company": "UnknownCompany", "role": "UnknownRole", "department": None, "location": None, "language": None},
    )
    company = sanitize_filename_part(str(parsed.get("company") or "UnknownCompany"))
    role = sanitize_filename_part(str(parsed.get("role") or "UnknownRole"))
    salary_benchmark = run_salary_lookup(root, company, parsed.get("location"))

    evaluation = model_json_call(
        adapter,
        "drafter_eval.tpl.md",
        config,
        {
            "PROFILE_SNIPPET": profile_snippet,
            "JOB_POSTING": job_posting,
            "SALARY_BENCHMARK": salary_benchmark or "null",
        },
        fallback={"overall_score": None, "recommendation": "unknown"},
    )
    print_evaluation_summary(evaluation)

    if not should_proceed(args.yes):
        print("Stopped after evaluation.")
        return 0

    template_values = {
        "PROFILE_SNIPPET": profile_snippet,
        "JOB_POSTING": job_posting,
        "COMPANY": company,
        "ROLE": role,
        "DEPARTMENT": parsed.get("department") or "",
        "LOCATION": parsed.get("location") or "",
        "LANGUAGE": parsed.get("language") or "",
        "EVALUATION_JSON": json.dumps(evaluation, indent=2),
        "CV_TEMPLATE": read_first_matching(root / "cv", "main_*.tex"),
        "COVER_LETTER_TEMPLATE": read_first_matching(root / "cover_letters", "cover_*.tex")
        or read_first_matching(root / "cover_letters", "Cover_*.tex")
        or read_first_matching(root / "cover_letters", "cover.cls"),
    }
    draft = model_json_call(adapter, "drafter_draft.tpl.md", config, template_values, fallback={})

    cv_filename = f"cv/main_{company}.tex"
    cover_filename = f"cover_letters/cover_{company}_{role}.tex"
    cv_tex = str(draft.get("cv_tex", ""))
    cover_tex = str(draft.get("cover_letter_tex", ""))
    if not cv_tex or not cover_tex:
        raise AdapterError("Drafter response must include cv_tex and cover_letter_tex.")

    draft_files = {cv_filename: cv_tex, cover_filename: cover_tex}
    reviewer_text = model_text_call(
        adapter,
        "reviewer.tpl.md",
        config,
        {
            **template_values,
            "CV_TEX": cv_tex,
            "COVER_TEX": cover_tex,
        },
    )
    edits, part_b = parse_reviewer_response(reviewer_text)
    edit_result = apply_structured_edits(draft_files, edits)
    final_files = edit_result.files

    for relative_path, content in final_files.items():
        write_text(output_dir / relative_path, content)

    compile_result = run_compile_and_ats(output_dir, cv_filename, cover_filename, args.skip_compile)
    report = build_report(evaluation, edit_result, part_b, compile_result, final_files)
    report_path = output_dir / "orchestrator_apply_report.md"
    write_text(report_path, report)

    print(f"[orchestrator] finish backend={backend}")
    print(f"Wrote {output_dir / cv_filename}")
    print(f"Wrote {output_dir / cover_filename}")
    print(f"Wrote {report_path}")
    return 0


def run_setup(args: argparse.Namespace) -> int:
    profile_path = Path(args.profile)
    if not profile_path.exists():
        print(f"Profile file not found: {profile_path}")
        return 1
    print(f"Read existing profile: {profile_path}")
    print("The orchestrator delegates profile creation to the canonical Claude /setup workflow for now.")
    return 0


def load_job_posting(args: argparse.Namespace) -> str:
    if args.job_text_file:
        return read_text(Path(args.job_text_file))
    if args.url:
        if not args.allow_live_fetch:
            raise SystemExit("--url requires --allow-live-fetch. CI and smoke tests should use --job-text-file.")
        with urllib.request.urlopen(args.url, timeout=30) as response:
            return response.read().decode("utf-8", errors="replace")
    raise SystemExit("Provide --job-text-file for the initial orchestrator workflow.")


def confirm_privacy_notice(backend: str, assume_yes: bool) -> bool:
    warning = (
        f"This operation will upload parts of your CV and job posting to {backend}. "
        "By continuing you consent. To avoid uploading PII, run in local mode or redact personally identifiable fields."
    )
    print(warning)
    if assume_yes or not sys.stdin.isatty():
        return True
    return input("Continue? [y/N] ").strip().lower() in {"y", "yes"}


def model_json_call(adapter, template_name: str, config, values: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    text = model_text_call(adapter, template_name, config, values)
    try:
        return parse_json_object(text)
    except ValueError:
        if fallback:
            return fallback
        raise


def model_text_call(adapter, template_name: str, config, values: dict[str, Any]) -> str:
    template = load_template(PROMPT_DIR / template_name)
    messages = render_template(template, values)
    response = adapter.send_chat(
        messages,
        max_tokens=int(template.metadata.get("max_tokens", config.max_tokens)),
        temperature=float(template.metadata.get("temperature", config.temperature)),
        stop=None,
    )
    return adapter.response_text(response)


def should_proceed(assume_yes: bool) -> bool:
    if assume_yes or not sys.stdin.isatty():
        return True
    return input("Should I proceed with drafting the CV and cover letter for this role? [y/N] ").strip().lower() in {
        "y",
        "yes",
    }


def run_salary_lookup(root: Path, company: str, location: Any | None = None) -> str | None:
    salary_tool = root / "salary_lookup.py"
    if not salary_tool.exists():
        return None
    command = [sys.executable, str(salary_tool), company, "--json"]
    if location:
        command.extend(["--city", str(location)])
    code, output = run_command(command, root)
    if code != 0:
        return None
    return output.strip() or None


def read_first_matching(directory: Path, pattern: str) -> str:
    for path in sorted(directory.glob(pattern)):
        return read_text(path)
    return ""


def print_evaluation_summary(evaluation: dict[str, Any]) -> None:
    score = evaluation.get("overall_score", "unknown")
    recommendation = evaluation.get("recommendation", "unknown")
    print(f"Evaluation: score={score}, recommendation={recommendation}")


def run_compile_and_ats(output_dir: Path, cv_filename: str, cover_filename: str, skip_compile: bool) -> dict[str, Any]:
    result: dict[str, Any] = {"compile": "skipped", "ats": "skipped", "warnings": []}
    if skip_compile or os.environ.get("CI", "").lower() == "true":
        result["warnings"].append("LaTeX compile skipped.")
        return result

    cv_path = output_dir / cv_filename
    cover_path = output_dir / cover_filename
    result["compile"] = "attempted"
    if executable_exists("lualatex"):
        code, output = run_command(["lualatex", "-interaction=nonstopmode", cv_path.name], cv_path.parent)
        result["cv_compile_exit_code"] = code
        result["cv_compile_output_tail"] = output[-2000:]
    else:
        result["warnings"].append("lualatex not found; CV compile skipped.")

    if executable_exists("xelatex"):
        code, output = run_command(["xelatex", "-interaction=nonstopmode", cover_path.name], cover_path.parent)
        result["cover_compile_exit_code"] = code
        result["cover_compile_output_tail"] = output[-2000:]
    else:
        result["warnings"].append("xelatex not found; cover letter compile skipped.")

    cleanup_latex_artifacts(cv_path.parent)
    cleanup_latex_artifacts(cover_path.parent)
    pdf_path = cv_path.with_suffix(".pdf")
    if pdf_path.exists() and executable_exists("pdftotext"):
        text_path = cv_path.with_suffix(".txt")
        code, output = run_command(["pdftotext", "-layout", pdf_path.name, text_path.name], cv_path.parent)
        result["ats_exit_code"] = code
        result["ats"] = "completed" if code == 0 else "failed"
        result["ats_output_tail"] = redact_pii(output[-1000:])
        text_path.unlink(missing_ok=True)
    elif pdf_path.exists():
        result["warnings"].append("pdftotext not found; ATS text-layer check skipped.")
    return result


def build_report(
    evaluation: dict[str, Any],
    edit_result,
    part_b: str,
    compile_result: dict[str, Any],
    final_files: dict[str, str],
) -> str:
    files = "\n".join(f"- `{name}`" for name in final_files)
    failures = "\n".join(f"- `{item['file']}`: {item['reason']}" for item in edit_result.failures) or "- None"
    applied = "\n".join(f"- `{item['file']}`: {item['reason']}" for item in edit_result.applied) or "- None"
    return (
        "# ai-job-search Orchestrator Report\n\n"
        "## Evaluation\n"
        f"```json\n{json.dumps(evaluation, indent=2)}\n```\n\n"
        "## Structured Reviewer Edits Applied\n"
        f"{applied}\n\n"
        "## Structured Reviewer Edit Failures\n"
        f"{failures}\n\n"
        "## Reviewer Part B Guidance\n"
        f"{part_b or 'No narrative guidance returned.'}\n\n"
        "## Verification Checklist\n"
        "- Factual accuracy: review required against profile source files.\n"
        "- Targeting: generated from posting and profile prompts.\n"
        "- Consistency: draft files written from the same parsed company and role.\n"
        f"- LaTeX compile: {compile_result.get('compile', 'attempted')}.\n"
        f"- ATS text-layer check: {compile_result.get('ats', 'skipped')}.\n"
        f"- Warnings: {', '.join(compile_result.get('warnings', [])) or 'None'}.\n\n"
        "## Files Created\n"
        f"{files}\n"
    )


if __name__ == "__main__":
    raise SystemExit(main())

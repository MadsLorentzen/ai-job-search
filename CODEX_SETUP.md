# Codex Setup Guide

This guide explains how to run the AI Job Search framework with Codex. The existing Claude Code setup remains supported; Codex support is additive.

## 1. Prerequisites

Install:

- Codex
- Python 3.10+ for `salary_lookup.py`
- Bun for the job portal CLI tools
- A LaTeX distribution with `lualatex` and `xelatex`
- Optional: `pdftotext` from Poppler for ATS text-layer checks

Codex reads repository instructions from `AGENTS.md` and repository skills from `.agents/skills/`.

## 2. Install Job Search CLI Dependencies

Run these from the repository root.

PowerShell:

```powershell
$tools = @("jobbank-search", "jobdanmark-search", "jobindex-search", "jobnet-search", "linkedin-search")
foreach ($tool in $tools) {
  Set-Location ".agents/skills/$tool/cli"
  bun install
  Set-Location "..\..\..\.."
}
```

Bash, zsh, or Git Bash:

```bash
for tool in jobbank-search jobdanmark-search jobindex-search jobnet-search linkedin-search; do
  cd .agents/skills/$tool/cli && bun install && cd ../../../..
done
```

For `linkedin-search`, `bun install` is optional for runtime use because the CLI has zero runtime dependencies. It is still useful for typechecking and tests.

## 3. Start Codex in the Repository

Open Codex from the repository root:

```bash
codex
```

Codex should load:

- `AGENTS.md` for repository rules and the candidate profile
- `.agents/skills/*/SKILL.md` for reusable workflows

If Codex does not pick up new skills immediately, restart the Codex session.

## 4. Run the Setup Workflow

Ask Codex:

```text
Run setup for this job search workspace.
```

or:

```text
/setup
```

Codex will use `.agents/skills/setup/SKILL.md`. The setup workflow offers the same three paths as the Claude Code workflow:

- Documents folder
- Single CV import
- Interview mode

The Codex setup populates:

- `AGENTS.md`
- `.agents/skills/job-application-assistant/01-candidate-profile.md`
- `.agents/skills/job-application-assistant/02-behavioral-profile.md`
- `.agents/skills/job-application-assistant/04-job-evaluation.md`
- `.agents/skills/job-application-assistant/05-cv-templates.md`
- `.agents/skills/job-application-assistant/07-interview-prep.md`
- `cv/main_example.tex`
- `.agents/skills/job-scraper/search-queries.md`

## 5. Search, Rank, and Apply

Ask Codex to search for jobs:

```text
Find new jobs.
```

or:

```text
/scrape
```

Ask Codex to rank scraped jobs:

```text
Rank the scraped jobs.
```

or:

```text
/rank
```

Ask Codex to apply to a posting:

```text
Apply to this job: https://example.com/job-posting
```

or paste the full posting text and ask Codex to run the application workflow.

The Codex `/apply` skill evaluates fit first, asks before drafting, creates tailored LaTeX files, compiles and inspects the PDFs, and performs the ATS text-layer check when `pdftotext` is available.

## 6. Other Codex Workflows

The following repository skills mirror the Claude command workflows:

| Workflow | Codex skill |
|---|---|
| Setup profile | `.agents/skills/setup/SKILL.md` |
| Apply to a job | `.agents/skills/apply/SKILL.md` |
| Scrape jobs | `.agents/skills/job-scraper/SKILL.md` |
| Rank scraped jobs | `.agents/skills/rank/SKILL.md` |
| Record outcomes | `.agents/skills/outcome/SKILL.md` |
| Expand competencies | `.agents/skills/expand/SKILL.md` |
| Register templates | `.agents/skills/add-template/SKILL.md` |
| Add job portals | `.agents/skills/add-portal/SKILL.md` |
| Reset profile/documents | `.agents/skills/reset/SKILL.md` |
| Upskill plan | `.agents/skills/upskill/SKILL.md` |

You can invoke skills explicitly by name or naturally by describing the task.

## 7. Notes for Claude Code Users

Claude Code remains supported through:

- `CLAUDE.md`
- `.claude/commands/`
- `.claude/skills/`
- `.claude/settings.json`

The two setups are intentionally parallel. Use the Codex paths when working in Codex, and use the Claude paths when working in Claude Code.

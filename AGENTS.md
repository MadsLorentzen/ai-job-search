---
framework_version: 1.0.1
---

# Agent Guidelines: AI Job Search

This workspace is structured to manage job search activities, scraper tools, CVs, cover letters, and interview preparation.

## Thin-Pointer Design (Single Source of Truth)

To prevent duplication and configuration drift across different AI agent frameworks (Claude Code, Google Antigravity, Codex, Cursor, Gemini CLI, etc.), this workspace uses a unified thin-pointer design. All agent runtimes should load the canonical specifications and candidate profiles from the files and directories below:

1. **Personal Candidate Profile:**
   - The candidate profile, contact details, education, and target preferences are defined in [CLAUDE.md](CLAUDE.md) and the individual profile methodology files under [.claude/skills/job-application-assistant/](.claude/skills/job-application-assistant/) (specifically `01-*.md` etc.).
2. **Canonical Workflow Specifications:**
   - The step-by-step instructions and triggers for tasks (setup, scrape, rank, apply, upskill, interview) are defined in the [.claude/](.claude/) directory (specifically under `.claude/skills/` and `.claude/commands/`).
   - Do not duplicate these rules or specifications. Treat `.claude/` files as the single source of truth.
3. **Portal Search Skills:**
   - Job-portal search CLIs live under [.agents/skills/](.agents/skills/) in the portable Agent Skills format (with a `SKILL.md` per portal). Codex and Antigravity discover these automatically; the `/scrape` workflow in [.claude/skills/job-scraper/](.claude/skills/job-scraper/) orchestrates them.

## Codex entry point

For career tasks, read [.agents/skills/job-search-assistant/SKILL.md](.agents/skills/job-search-assistant/SKILL.md) and follow the selected canonical workflow. Accept `$job-search-assistant setup`, `$job-search-assistant apply <posting>`, and equivalent natural-language requests. `/setup` and similar references name upstream workflows; they are not installed Codex slash commands.

The `.claude/` files are shared specifications, not a requirement to run Claude Code. Use the current Codex runtime and its available tools. References that require mentioning Claude Code in a candidate's documents apply only if the candidate actually used it; name tools from their supplied evidence. Never infer candidate facts from the runtime running this repo.

For portal discovery, run `python tools/codex_setup.py --portals`. The workflow adapter is not a portal. See [CODEX_SETUP.md](CODEX_SETUP.md) for dependencies and runtime differences.

For repository maintenance, follow [CONTRIBUTING.md](CONTRIBUTING.md). Do not run candidate onboarding for a code or documentation request. Keep new code simple, use descriptive camelCase names where interfaces permit, and preserve upstream workflow sources rather than copying them.

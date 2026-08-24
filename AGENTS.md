---
framework_version: 1.0.0
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

## Learned User Preferences

- Extend the existing Claude/Cowork job-search architecture instead of adding parallel frameworks; read existing files fully before changing them.
- Never push personal profile, tailored CVs, or autofill answers to a public remote; share only the public US-framework fork.
- When pulling upstream, keep US/North American search defaults; do not blind-sync the public fork.
- Keep the `gui/` desk a polished, full CLI-equivalent conversation in the browser, not a thin command launcher.

## Learned Workspace Facts

- This workspace is a US-market fork of MadsLorentzen/ai-job-search: US boards and English defaults; Danish portal CLIs may remain in-tree but disabled.
- Personal profile and application files belong on the private `personal` branch/remote; `origin/master` is the shareable North American framework.
- The optional Chrome desk lives in `gui/` and starts with `node gui/server.mjs` on macOS, Windows, and Linux (localhost only; Claude Code with skip-permissions). The installable Job Search Desk from GitHub Releases is the same desk: one-click start, official Claude Code install if missing, `claude auth login --claudeai` for the Chrome / claude.ai subscription.

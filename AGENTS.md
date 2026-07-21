---
framework_version: 1.1.0
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

## Contribution Rules (Normativa Vinculante)

Toda contribución a este repositorio **debe** cumplir estrictamente con:

1. **CONTRIBUTING.md** — El archivo [CONTRIBUTING.md](CONTRIBUTING.md) es la autoridad máxima sobre qué se mergea y qué se declina. Sus reglas son vinculantes:
   - Bug fixes requieren el caso fallido demostrado en tests.
   - Un solo cambio por PR (no kitchen-sink).
   - PRs se abren contra `MadsLorentzen/ai-job-search` (upstream), no contra el fork.
   - El PR debe verificar que el `base repository` apunte a upstream antes de publicar.

2. **Conventional Commits** — Todos los commits deben seguir el formato `tipo(alcance): descripción`. Tipos válidos: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.

3. **Pull Requests siempre** — Ningún cambio se pushea directamente a `master` del fork ni se commitea sin PR. El flujo correcto es:
   - Branch con nombre `fix/` o `feat/` desde `master`.
   - Push del branch al fork.
   - PR contra upstream.
   - Mantener `master` del fork sincronizado con `upstream/master`.

4. **Verificación pre-PR** — Antes de abrir un PR, ejecutar: `python tools/lint_skills.py`, `python tools/check_framework_version.py`, y los test suites relevantes. Todos deben pasar.

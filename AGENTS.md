---
framework_version: 1.0.0
---

# AGENTS.md

Tool-neutral entrypoint for any coding agent working in this repository. This file
is a **pointer, not a parallel config tree** — there is no duplicated per-agent
surface to keep in sync.

- **Candidate profile & repo conventions:** `CLAUDE.md` — start here.
- **Workflow specs (single source of truth):** `.claude/commands/*.md` and
  `.claude/skills/` — the job-search (`/scrape`), CV, cover-letter, interview, and
  upskill workflows.
- **Job-portal search CLIs:** bundled inside the `/scrape` skill at
  `.claude/skills/job-scraper/scripts/` and documented in
  `.claude/skills/job-scraper/reference/portals/`. They are implementation detail of
  `/scrape`, driven by it rather than invoked as standalone skills.

Agents that read their own native skill path (Claude Code → `.claude/skills/`;
Codex/Antigravity/Gemini → `.agents/skills/`) will not find a second copy here by
design: the canonical specs above are the one place to read and edit.

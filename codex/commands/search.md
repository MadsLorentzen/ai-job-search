# Codex Command: Search

Use when the user asks to search, scrape, or refresh job listings.

Procedure:
1. Read `AGENTS.md`.
2. Read `.claude/skills/job-scraper/SKILL.md` completely.
3. Prefer `my/profile/job-scraper/search-queries.md` when it exists; otherwise
   read `.claude/skills/job-scraper/search-queries.md`.
4. Read each portal skill before invoking its CLI.
5. Prefer project-local container scripts such as `tools/run_portal_cli.sh` over
   installing tooling globally.
6. Keep generated search reports and state in ignored personal paths.


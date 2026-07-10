# Agent Guidance

This repository is a job-application workspace that was originally built for Claude
Code. Codex should preserve the Claude-compatible files while using the guidance
below as the project-local entry point.

## Priority

- Follow this `AGENTS.md` first for Codex behavior.
- If `my/profile/` exists, treat it as the canonical private candidate
  profile and personalization layer. It is intentionally ignored by git.
- Treat `CLAUDE.md` as the public/template high-level workflow guide when no
  `my/profile/CLAUDE.md` override exists.
- Treat `codex/commands/*.md` as Codex-facing workflow entry points. These are
  project command specs, not a native Codex slash-command runtime.
- Treat `.claude/commands/*.md` and `.claude/skills/*` as reusable workflow
  specifications, even though their names and tool references are Claude-specific.
- Do not delete or rewrite `.claude/` just to make the repo Codex-friendly; the
  fork should remain usable from Claude Code.

## Tool Translation

When a Claude instruction names a Claude Code tool, use the Codex equivalent:

- `Read`, `Glob`, `Grep` -> shell reads, `rg`, `find`, and normal file inspection.
- `Edit`, `Write` -> `apply_patch` for manual edits.
- `Bash(...)` -> shell commands, respecting Codex sandbox and approval rules.
- `WebFetch`, `WebSearch` -> web browsing/search when current external facts or
  source verification are needed.
- `Agent` -> use available multi-agent tooling if present; otherwise do the work
  inline and keep the same separation of concerns.
- `AskUserQuestion` -> ask a concise direct question only when local context cannot
  resolve the decision safely.

## Job Application Workflow

For job postings, applications, CVs, cover letters, and interview prep:

1. Read `my/profile/CLAUDE.md` if present; otherwise read `CLAUDE.md`.
2. Read `.claude/skills/job-application-assistant/SKILL.md`.
3. For each referenced profile/personalization file, prefer the private
   `my/profile/...` version if present; otherwise use the tracked template:
   - profile facts: `my/profile/job-application-assistant/01-candidate-profile.md` or `.claude/skills/job-application-assistant/01-candidate-profile.md`
   - behavior/culture fit: `my/profile/job-application-assistant/02-behavioral-profile.md` or `.claude/skills/job-application-assistant/02-behavioral-profile.md`
   - writing rules: `.claude/skills/job-application-assistant/03-writing-style.md`
   - fit scoring: `my/profile/job-application-assistant/04-job-evaluation.md` or `.claude/skills/job-application-assistant/04-job-evaluation.md`
   - CV rules: `my/profile/job-application-assistant/05-cv-templates.md` or `.claude/skills/job-application-assistant/05-cv-templates.md`
   - cover letter rules: `.claude/skills/job-application-assistant/06-cover-letter-templates.md`
   - interview prep: `my/profile/job-application-assistant/07-interview-prep.md` or `.claude/skills/job-application-assistant/07-interview-prep.md`
4. Always evaluate fit before drafting application materials unless the user
   explicitly asks for only a narrow artifact.
5. Never fabricate candidate experience, employer facts, salary data, job
   requirements, or application outcomes.
6. Verify company-specific claims with current external sources before using them
   in a CV, cover letter, or interview prep pack.
7. Compile and inspect LaTeX outputs as required by `CLAUDE.md` before presenting
   CV or cover-letter results.

## Codex Command Equivalents

Codex does not receive Claude slash commands automatically. If the user invokes one
or asks for the same outcome in natural language, prefer the matching
`codex/commands/*.md` wrapper. Each wrapper points to the detailed Claude workflow
spec or skill to execute under Codex tool translation.

| User intent | Codex wrapper to read |
| --- | --- |
| Set up or refresh profile | `codex/commands/setup.md` |
| Search/scrape jobs | `codex/commands/search.md` |
| Apply to a posting | `codex/commands/apply.md` |
| Rank scraped jobs | `codex/commands/rank.md` |
| Interview preparation | `codex/commands/interview.md` |
| Record application outcome | `codex/commands/outcome.md` |
| Expand profile from public/source materials | `codex/commands/expand.md` |
| Build an upskilling plan | `codex/commands/upskill.md` |
| Add a LaTeX template | `codex/commands/add-template.md` |
| Add a job portal skill | `codex/commands/add-portal.md` |
| Reset profile/documents | `codex/commands/reset.md` |

If a Codex wrapper is missing or stale, fall back to the corresponding
`.claude/commands/*.md` or `.claude/skills/*` file directly.

## Job Search Portal Skills

The installed portal CLIs live under `.agents/skills/`. Before running one, read
that portal's `SKILL.md` and use its documented flags. Prefer the CLI output over
free-form web search when the portal skill exists. Keep searches low-volume and
respect each skill's personal-use or terms-of-service notes.

For search strategy, prefer `my/profile/job-scraper/search-queries.md` if it
exists; otherwise use `.claude/skills/job-scraper/search-queries.md`.

## Repository Hygiene

- Keep edits narrowly scoped to the requested workflow.
- Preserve user profile data and generated application archives unless the user
  explicitly asks to reset or delete them.
- Leave unrelated untracked files alone.
- When changing generated CV or cover-letter files, re-read and verify the final
  file contents before reporting completion.

# Agent Guidance

This repository is a job-application workspace that was originally built for Claude
Code. Codex should preserve the Claude-compatible files while using the guidance
below as the project-local entry point.

## Priority

- Follow this `AGENTS.md` first for Codex behavior.
- Treat `CLAUDE.md` as the canonical candidate profile and high-level workflow
  guide.
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

1. Read `CLAUDE.md`.
2. Read `.claude/skills/job-application-assistant/SKILL.md`.
3. Read only the referenced files needed for the requested step:
   - profile facts: `.claude/skills/job-application-assistant/01-candidate-profile.md`
   - behavior/culture fit: `.claude/skills/job-application-assistant/02-behavioral-profile.md`
   - writing rules: `.claude/skills/job-application-assistant/03-writing-style.md`
   - fit scoring: `.claude/skills/job-application-assistant/04-job-evaluation.md`
   - CV rules: `.claude/skills/job-application-assistant/05-cv-templates.md`
   - cover letter rules: `.claude/skills/job-application-assistant/06-cover-letter-templates.md`
   - interview prep: `.claude/skills/job-application-assistant/07-interview-prep.md`
4. Always evaluate fit before drafting application materials unless the user
   explicitly asks for only a narrow artifact.
5. Never fabricate candidate experience, employer facts, salary data, job
   requirements, or application outcomes.
6. Verify company-specific claims with current external sources before using them
   in a CV, cover letter, or interview prep pack.
7. Compile and inspect LaTeX outputs as required by `CLAUDE.md` before presenting
   CV or cover-letter results.

## Claude Slash Command Equivalents

Codex does not receive Claude slash commands automatically. If the user invokes one
or asks for the same outcome in natural language, read the matching file and follow
it as a procedure:

| User intent | Claude spec to read |
| --- | --- |
| Set up or refresh profile | `.claude/commands/setup.md` |
| Search/scrape jobs | `.claude/skills/job-scraper/SKILL.md` |
| Apply to a posting | `.claude/commands/apply.md` |
| Rank scraped jobs | `.claude/commands/rank.md` |
| Interview preparation | `.claude/commands/interview.md` |
| Record application outcome | `.claude/commands/outcome.md` |
| Expand profile from public/source materials | `.claude/commands/expand.md` |
| Build an upskilling plan | `.claude/skills/upskill/SKILL.md` |
| Add a LaTeX template | `.claude/commands/add-template.md` |
| Add a job portal skill | `.claude/commands/add-portal.md` |
| Reset profile/documents | `.claude/commands/reset.md` |

## Job Search Portal Skills

The installed portal CLIs live under `.agents/skills/`. Before running one, read
that portal's `SKILL.md` and use its documented flags. Prefer the CLI output over
free-form web search when the portal skill exists. Keep searches low-volume and
respect each skill's personal-use or terms-of-service notes.

## Repository Hygiene

- Keep edits narrowly scoped to the requested workflow.
- Preserve user profile data and generated application archives unless the user
  explicitly asks to reset or delete them.
- Leave unrelated untracked files alone.
- When changing generated CV or cover-letter files, re-read and verify the final
  file contents before reporting completion.

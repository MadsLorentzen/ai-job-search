---
name: job-search-assistant
description: Run this repository's job-search workflows, from candidate onboarding and job ranking to application documents and interview preparation. Use for career tasks or explicit job-search-assistant requests, not repository maintenance.
---

# AI Job Search for Codex

Use the existing workflows in `.claude/`. Resolve the repository root three directories above this skill folder. Read `AGENTS.md` and `CLAUDE.md`, then load the selected workflow in full and its referenced methodology as needed. Keep one candidate profile and one workflow source.

## Choose a workflow

The first word after `$job-search-assistant` selects the workflow. The remaining text is its `$ARGUMENTS` value: pass it as user data, never evaluate it as shell code. Natural-language requests can select the same workflows. If the intent is ambiguous, ask which task the user wants.

| Workflow | Canonical source relative to the repository root |
| --- | --- |
| setup | `.claude/commands/setup.md` |
| scrape | `.claude/skills/job-scraper/SKILL.md` |
| rank | `.claude/commands/rank.md` |
| apply | `.claude/commands/apply.md` |
| interview | `.claude/commands/interview.md` |
| outcome | `.claude/commands/outcome.md` |
| expand | `.claude/commands/expand.md` |
| upskill | `.claude/skills/upskill/SKILL.md` |
| html-report | `.claude/commands/html-report.md` |
| add-template | `.claude/commands/add-template.md` |
| add-portal | `.claude/commands/add-portal.md` |
| gmail-sync | `.claude/commands/gmail-sync.md` |
| notion-sync | `.claude/commands/notion-sync.md` |
| reset | `.claude/commands/reset.md` |

If required candidate fields remain placeholders, use setup before personalizing a search or application. Use supplied documents or interview answers; the template's Danish examples and the computer account are not candidate facts. Setup writes personal data into tracked files, so use a local working copy or private repository, not the public contribution checkout.

## Translate runtime instructions

- `Read`, `Write`, `Edit`, `Glob`, `Grep`, and `Bash` describe capabilities. Use the available Codex tools and the host shell. On Windows translate shell syntax to PowerShell; use the active Python environment. Resolve command paths from the repository root unless the source specifies otherwise.
- `WebSearch` and `WebFetch` mean available search or browser tools. Preserve the source's untrusted-posting and source-verification rules. If access fails, report it or request the posting text; never invent live results.
- `AskUserQuestion` means the available user-input tool or conversation. Preserve the selected workflow's confirmation gates and the user's existing authorization.
- `Agent` and `Task` review instructions mean Codex subagents when available and authorized. Otherwise perform a separate review pass and disclose that it was a self-review. Never report an independent review that did not occur.
- Claude-specific `context`, `allowed-tools`, hooks, and `.claude/settings.json` do not configure Codex permissions. Use the current runtime's permissions and configured model; do not install Claude or request an Anthropic key.
- Name AI tools in application documents only when the candidate's evidence supports them. The runtime's name is not a candidate qualification.
- Gmail and Notion sync require corresponding connected tools. Explain any missing connection and stop that sync; never claim it completed.

For scrape and add-portal discovery, run `python tools/codex_setup.py --portals` and read the returned skill paths. It lists only skills with portal CLIs; this adapter cannot be invoked as a job board. Preserve each portal's `enabled` setting and documented flags. If Python is unavailable, discover `.agents/skills/*/cli/package.json` and read the sibling `SKILL.md` files instead.

Keep canonical output locations and schemas. Compile and inspect documents as the selected workflow requires; a missing compiler is not a verified PDF. Applications and external messages require explicit user instructions to send. For setup checks and examples, read `CODEX_SETUP.md`.

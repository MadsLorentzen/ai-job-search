---
name: ats-boards-search
version: 1.0.0
description: >
  Search live software and professional job listings on public Greenhouse, Lever,
  and Ashby company career boards (country-agnostic ATS APIs). Use when the user
  names a company that posts via those boards, wants tech jobs from employer
  career pages, or mentions Greenhouse, Lever, Ashby, or "company job board".
  Trigger phrases: greenhouse jobs, lever jobs, ashby jobs, company career page,
  ATS board, jobs at <company>.
context: fork
enabled: false  # set true after adding job_scraper/ats_boards.json or passing --board
allowed-tools: Bash(bun run .agents/skills/ats-boards-search/cli/src/cli.ts *)
---

# ATS boards search (Greenhouse / Lever / Ashby)

Country-agnostic. These three ATS platforms power a large share of tech career pages worldwide. Reads are public JSON APIs — **no API key**, zero runtime dependencies.

This is a **generic** skill: you pass company board tokens, not a country. Do not PR country-specific boards upstream; keep your company list in `job_scraper/ats_boards.json` (gitignored).

## Commands

### Search

```bash
bun run .agents/skills/ats-boards-search/cli/src/cli.ts search --board greenhouse:<token> [flags]
```

- `--board <kind:token>` — repeatable. `kind` is `greenhouse`, `lever`, or `ashby`
- `--boards-file <path>` — JSON `{ "boards": ["greenhouse:stripe", "lever:netflix"] }`
- `--query` / `-q`, `--location` / `-l`, `--jobage <days>`, `--page`, `--limit` / `-n`
- `--format json|table|plain`

### Detail

```bash
bun run .agents/skills/ats-boards-search/cli/src/cli.ts detail greenhouse:stripe:12345 --format plain
```

Copy the `id` from search output (`kind:token:jobId`).

## Examples

```bash
bun run .agents/skills/ats-boards-search/cli/src/cli.ts search --board greenhouse:stripe -q "engineer" --format table
bun run .agents/skills/ats-boards-search/cli/src/cli.ts search --board lever:netflix --board ashby:openai --jobage 14
bun run .agents/skills/ats-boards-search/cli/src/cli.ts search --boards-file job_scraper/ats_boards.json -l Remote
```

Copy `boards.example.json` in this folder to `job_scraper/ats_boards.json` and add companies you actually follow.

## How to find a board token

- Greenhouse: `https://boards.greenhouse.io/<token>` or `https://job-boards.greenhouse.io/<token>`
- Lever: `https://jobs.lever.co/<token>`
- Ashby: `https://jobs.ashbyhq.com/<token>`

## Notes

- `/scrape` will run this skill if `enabled: true`. Without `--board` or a boards file it errors; keep a boards file or set `enabled: false` until you have companies listed.
- 429/5xx are retried with backoff. Keep volume to companies you would actually apply to.

---
name: zhipin-search
version: 1.0.0
description: >
  Search BOSS直聘 (zhipin.com) job listings in China through the user's own
  logged-in Chrome session (Chrome DevTools Protocol), read-only. Use when the
  user wants to find or read Chinese job postings on BOSS直聘 by keyword or city.
  Trigger phrases: BOSS直聘, boss zhipin, boss直聘岗位, 找工作, zhipin jobs,
  find a job on boss, 搜职位, BOSS直聘招聘. Requires Chrome launched with
  --remote-debugging-port=9222 and logged into BOSS直聘.
context: fork
enabled: true  # requires Chrome CDP running; set false to have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/zhipin-search/cli/src/cli.ts *)
---

# zhipin-search Skill

Search BOSS直聘 job listings through **your own logged-in Chrome session** via
the Chrome DevTools Protocol (CDP). BOSS直聘 is login-walled and anti-bot
protected, so this skill does not scrape an anonymous endpoint — it drives a real
Chrome window you are logged into and reads the rendered page. Read-only.

## ⚠️ Personal use only

This drives your own BOSS直聘 account through your own browser. Keep volume low,
read listings as you would manually, and do not use it to automate applications.
Run it on your own responsibility.

## Prerequisite (run once)

Launch Chrome with remote debugging enabled and log into BOSS直聘:

```bash
open -a "Google Chrome" --args --remote-debugging-port=9222 \
    --remote-allow-origins=* --user-data-dir="$HOME/zhipin-chrome-profile"
```

- `--remote-allow-origins=*` is required on Chrome 111+ (CDP WebSocket rejects
  connections without it).
- `--user-data-dir` isolates this session; reuse the same dir next time to stay
  logged in.

## When to use this skill

- Search BOSS直聘 openings by keyword (job title / skill), optionally scoped to a city
- Read a specific posting's full description
- Feed `/scrape` a BOSS直聘 source (the CLI is auto-discovered like other portal skills)

## Commands

### Search job listings

```bash
bun run .agents/skills/zhipin-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (title / skill). Recommended.
- `--location <name|code>` / `-l <...>` — city name (`上海`, `北京`, `杭州`, …) or
  raw city code (e.g. `101020100`). Optional; omit to search nationwide. See
  `url-reference.md` for the code table.
- `--page <n>` — 1-indexed page. Default 1.
- `--limit <n>` / `-n <n>` — cap results emitted (client-side).
- `--format json|table|plain` — default `json`.

> **Recency note:** BOSS直聘's search URL has no simple posted-within-N-days
> parameter, so there is no `--jobage` flag. Results follow BOSS直聘's default sort.

### Fetch full job detail

```bash
bun run .agents/skills/zhipin-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the `/job_detail/<id>` segment of a listing URL (a long mixed-case token),
or a full `https://www.zhipin.com/job_detail/<id>.html` URL.

## Usage examples

```bash
# 算法工程师 jobs in Shanghai
bun run .agents/skills/zhipin-search/cli/src/cli.ts search -q "算法工程师" -l 上海 --format table

# AI平台 jobs nationwide, JSON, capped at 20
bun run .agents/skills/zhipin-search/cli/src/cli.ts search -q "AI平台" --limit 20 --format json

# Full detail for a specific job
bun run .agents/skills/zhipin-search/cli/src/cli.ts detail f902a6107a7a3a6b0nF839q0GVBW --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use (`{ meta, results }`) |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the
process exits with code `1`.

## Notes

- Data comes from your logged-in BOSS直聘 session via CDP; there is no anonymous
  API to fall back to. If the CLI cannot reach Chrome, it exits non-zero with a
  clear message — start Chrome per the prerequisite above.
- **Search-list salary is obfuscated.** BOSS直聘 renders salary digits through a
  custom font, so `search` results show garbled glyphs for `salary`. The `detail`
  page is clean — run `detail <id>` to get the real salary (and full description).
- If the DOM selectors in `src/helpers.ts` stop matching (BOSS直聘 changes its
  markup), `search` returns zero results rather than crashing. Update the
  selectors together with `url-reference.md`.
- Read-only: no `apply` command. Use the results to apply manually.

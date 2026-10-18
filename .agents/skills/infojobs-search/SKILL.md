---
name: infojobs-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in Spain on InfoJobs, Spain's
  largest job board, through its official API: ofertas de empleo en InfoJobs, trabajo en
  Toledo / Madrid / Barcelona, vacantes por provincia o ciudad, en cualquier sector. Look up
  a specific InfoJobs offer by ID or URL. Requires the user's own InfoJobs API credentials
  (INFOJOBS_API_TOKEN). Trigger phrases: buscar en InfoJobs, ofertas InfoJobs, infojobs,
  ofertas de empleo España, find a job in Spain on InfoJobs.
context: fork
enabled: false  # shipped OFF: needs your credentials and a first live check. Set to true once Setup below works.
allowed-tools: Bash(bun run .agents/skills/infojobs-search/cli/src/cli.ts *)
---

# InfoJobs Search Skill

Search InfoJobs offers through the **official InfoJobs REST API**, the sanctioned way to read
InfoJobs data (its website blocks automated access and its `robots.txt` disallows offer pages).
**Zero runtime dependencies** — it runs with just `bun`.

> **Status: not yet verified against the live API.** The author could not test it, because the API
> rejects every request without an application's credentials (a plain request returns
> `{"error":"102","error_description":"Client credentials not valid"}`). The code follows the published
> API documentation and is covered by offline tests with documentation-shaped responses. Run the check
> in Setup step 4 before relying on it; if a field comes back wrong, the mappings to adjust are listed in
> `url-reference.md`.

## Setup (once)

1. Create a free InfoJobs account if you have none, then register an application at
   <https://developer.infojobs.net> to obtain a **Client ID** and a **Client Secret**.
2. Put both in one environment variable, joined by a colon. Never in a file in this repo, never as a flag:

   ```bash
   # bash / Git Bash — current session
   export INFOJOBS_API_TOKEN="<client_id>:<client_secret>"
   ```
   ```powershell
   # PowerShell — current session
   $env:INFOJOBS_API_TOKEN = "<client_id>:<client_secret>"
   ```
   For a permanent setting use the OS user-environment settings (Windows: *Edit environment variables
   for your account*). The repo `.gitignore` already covers `.env`, but this skill never reads one.
3. The CLI reads the variable only from the environment. Passing a token as a flag is rejected
   (`UNKNOWN_FLAG`) and the value is never printed, including in error messages.
4. Check it with one small search, then enable the skill:

   ```bash
   bun run .agents/skills/infojobs-search/cli/src/cli.ts search -q "ingeniero" -l Toledo --limit 3 --format table
   ```
   If that prints offers with a title, company, place and date, change `enabled: false` to
   `enabled: true` in this file's frontmatter. `/scrape health infojobs` also probes it while it is disabled.

API usage is subject to InfoJobs' developer terms and its rate limits. This is for your own job search;
keep volume low.

## Commands

### Search offers

```bash
bun run .agents/skills/infojobs-search/cli/src/cli.ts search [--query "<text>"] [--location "<province>"] [--city "<city>"] [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keywords. At least one of `--query` / `--location` / `--city` is required.
- `--location <text>` / `-l <text>` — **province**, e.g. `Toledo`, `Madrid`, `Ciudad Real`. Converted to the dictionary-style key (`ciudad-real`) and sent as `province`.
- `--city <text>` — a city used as the centre of a geographic search, e.g. `Illescas`.
- `--jobage <days>` — posted within N days. The API offers 24 hours, 7 and 15 days; other values round up to the next bucket, and over 15 applies no filter (so also filter client-side on `date`).
- `--page <n>` — page number (1-indexed).
- `--limit <n>` / `-n <n>` — results per page, up to 50 (default 20).
- `--format json|table|plain` — default `json`.

Each result carries the standard fields plus `salary`, `contract`, `workday`, `experience`,
`teleworking` and `summary` (the offer's minimum-requirements text). The JSON `meta` has the API's own
`total` and `pages`.

### Fetch full offer detail

```bash
bun run .agents/skills/infojobs-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the offer ID from `search` (a 30-character hex string) or an `infojobs.net/.../of-i<id>` URL.
Returns description, minimum and desired requirements, salary range (when the offer shows it), contract,
hours, experience, studies and skills. The API publishes **no application deadline**: `deadline` is `null`.

## Usage examples

```bash
# Industrial engineering around Toledo, last two weeks
bun run .agents/skills/infojobs-search/cli/src/cli.ts search -q "ingeniero industrial" -l Toledo --jobage 15 --format table

# Maintenance roles within reach of Illescas
bun run .agents/skills/infojobs-search/cli/src/cli.ts search -q "técnico de mantenimiento" --city Illescas --format table

# A bigger page of production-management offers in Madrid
bun run .agents/skills/infojobs-search/cli/src/cli.ts search -q "jefe de producción" -l Madrid --limit 40

# Full detail for one offer
bun run .agents/skills/infojobs-search/cli/src/cli.ts detail eb371a01c14f97838d790d19d606ce --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading results or a single offer's full detail |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Error codes worth knowing: `MISSING_CREDENTIALS` (variable unset), `BAD_CREDENTIALS_FORMAT` (not
  `id:secret`), `INVALID_CREDENTIALS` (the API answered 401/403 — wrong values or an inactive app),
  `PARSE_FAILED` (the response had no offers list, reported instead of a false "zero jobs").
- A province that is not in InfoJobs' dictionary simply matches nothing or is ignored by the API; if
  `--location` returns nothing for a real place, retry with `--city`.
- `date` is the offer's `published` date (falling back to `updated`).
- Parsing anchors and the documented endpoints are in `url-reference.md`.

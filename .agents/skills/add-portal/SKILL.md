---
name: add-portal
description: >-
  Generate a zero-dependency job-portal search skill (TypeScript + Bun) for any local job board or market.
  Triggers on: add portal, new job portal, scaffold portal, create portal search, /add-portal.
---

# /add-portal - Generate a Job-Portal Search Skill for Your Local Market

You are helping the user build a job-portal search skill for a job board in their market. The repo ships a canonical worked example of the pattern — the zero-dependency, country-agnostic `.agents/skills/linkedin-search/` — and this workflow investigates the portal, scaffolds the skill from the canonical structure, and test-runs a live query before registering anything.

The generator is **country-agnostic**: it works for any portal in any market and language.

Follow these steps **in order**.

---

## Step 0: Parse User Input

- If the user prompt contains `--list`: list installed portal skills in `.agents/skills/` (reading their `SKILL.md` and `url-reference.md`), print a summary table, and stop.
- If the user prompt contains a URL: treat it as the portal URL and carry it into Step 1.
- Otherwise: start the interview at Step 1.

---

## Step 1: Interview - Portal Basics

Ask the user for any missing items:
1. **Portal URL** - the job board's public site (e.g. `https://www.seek.com.au`, `https://www.stepstone.de`).
2. **Skill name** - kebab-case, suffixed `-search` (e.g. `seek-search`, `stepstone-search`). Must not collide with an existing folder in `.agents/skills/`.
3. **Market and language** - which country/region the portal covers and what language its postings use.
4. **A realistic test query** - a job title or skill the user would actually search for, used for the live test in Step 4.

---

## Step 2: Investigate the Portal

Do reconnaissance before writing any code using `read_url_content` or `curl` via bash:
1. **Find search URL pattern**: search endpoint, query parameter, location/page/date parameters, JSON API vs HTML.
2. **Fetch one search response**: identify fields (`id`, `title`, `company`, `location`, `date`, `url`).
3. **Find detail page pattern**: endpoint for full description, deadline, apply link.
4. **Check robots.txt & terms**: halt if login is required; add prominent personal-use warning if automated access is restricted.

Record all endpoints and anchors for `url-reference.md`.

---

## Step 3: Scaffold the Skill

Create `.agents/skills/<name>/` following the `.agents/skills/linkedin-search/` pattern:

```
<name>/
├── SKILL.md              # Skill definition with trigger phrases
├── url-reference.md      # Endpoint documentation from Step 2
└── cli/
    ├── package.json
    ├── tsconfig.json
    ├── README.md
    ├── src/
    │   ├── cli.ts        # Arg parsing, help text, command dispatch
    │   ├── helpers.ts    # Fetch with backoff, parsers, error writer
    │   └── commands/
    │       ├── search.ts
    │       └── detail.ts
    └── tests/
        └── helpers.ts
```

### The portal-skill contract
- **Commands:** `search` and `detail <id|url>`.
- **Search flags:** `--query`/`-q`, `--jobage <days>`, `--page <n>`, `--limit <n>`, `--format json|table|plain`. Add `--location`/`-l` if supported.
- **JSON output shape:** `{ "meta": { "count": ..., "page": ... }, "results": [...] }` (fields: `id`, `title`, `company`, `location`, `date`, `url`).
- **Errors:** written to **stderr** as `{ "error": "...", "code": "..." }`, exit code `1`.
- **Runtime:** Plain `bun` + `fetch` + regex/chunked parsing (zero runtime dependencies).

---

## Step 4: Test-Run a Live Query (MANDATORY)

1. Install dev types and typecheck:
   ```bash
   cd .agents/skills/<name>/cli && bun install && bun run typecheck
   ```
2. Run live search:
   ```bash
   bun run src/cli.ts search -q "<test query>" --limit 5 --format table
   ```
3. Test detail endpoint on one ID:
   ```bash
   bun run src/cli.ts detail <id> --format plain
   ```
4. Run test suite:
   ```bash
   bun run test
   ```

Do not proceed to Step 5 until search, detail, and tests all pass.

---

## Step 5: Register & Confirm

1. If the user wants the portal added to the scraper queries, update `.agents/skills/job-scraper/search-queries.md`.
2. Present a confirmation summary with example commands.

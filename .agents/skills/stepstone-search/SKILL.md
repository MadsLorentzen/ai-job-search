---
name: stepstone-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in Germany, find German
  job listings, look up a specific stepstone.de posting, or asks about the German
  job market — even if they don't mention Stepstone by name. Invoke for open
  positions, vacancies, hiring, or career opportunities in Germany or German cities
  (Stuttgart, Berlin, Munich, Frankfurt, Hamburg, Cologne, etc.). Trigger phrases
  include: stepstone, jobsuche, stellenangebote, offene stellen, jobangebote,
  arbeitsstelle, job in deutschland, jobs in germany, german jobs, jobs stuttgart,
  jobs berlin, jobs munich, jobs frankfurt, data scientist jobs germany, machine
  learning jobs germany, software engineer jobs deutschland, IT jobs deutschland.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/stepstone-search/cli/src/cli.ts *)
---

# Stepstone Search Skill

Search live German job listings from stepstone.de, one of Germany's largest general
job boards. No authentication needed, zero runtime dependencies — it runs with just
`bun`.

## When to use this skill

- Search for job openings in Germany by keyword, job title, or technology
- Find jobs in a specific German city (`--location "Stuttgart"`, `--location "Berlin"`)
- Filter jobs by recency (posted today, last 7 days, last 14 days)
- Get the full description of a specific job listing

## Commands

### Search job listings

```bash
bun run .agents/skills/stepstone-search/cli/src/cli.ts search --query "<text>" [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keywords (job title, skill, or role). **Required.**
- `--location <text>` / `-l <text>` — city/region, e.g. `"Stuttgart"`, `"Berlin"`. Stepstone
  resolves this to roughly a 30km radius. Omit to search all of Germany.
- `--jobage <days>` — keep only postings within N days. Applied **client-side** against
  each result's relative timestamp (`vor 4 Tagen`, etc.) — see the robots.txt note below.
- `--page <n>` — must be `1`. See "Why no pagination" below.
- `--limit <n>` — cap total results the CLI outputs (client-side)
- `--format json|table|plain`

> **robots.txt note**: stepstone.de allows automated `GET /jobs/*?q=*` but explicitly
> disallows any second query parameter on that path. There is no allowed way to request
> page 2 or pass a server-side age filter — this skill only ever issues the one allowed
> request shape and does everything else (recency, result cap) client-side. Full detail
> in `url-reference.md`.

### Fetch full job detail

```bash
bun run .agents/skills/stepstone-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric job ID from `search` results (e.g. `14338328`). You may also pass the
full `stellenangebote--...-inline.html` URL. Returns the full description, salary (when
Stepstone shows one), and the posting URL.

---

## How to use effectively

**Always start with `search`, `--query` is required.** Add `--location` to narrow to a
city; without it results span all of Germany.

**Use `--jobage 7` or `--jobage 14` for fresh listings.** Without it, all postings on the
first results page are included regardless of age.

**Natural workflow: `search` → `detail`.**
1. Use `search` to find matching jobs and their `id` values.
2. Call `detail <id>` to get the full description and salary (when available).

**Only page 1 is reachable.** Stepstone's own results page shows ~25 of the (often
higher) total count; further results load via client-side infinite scroll that isn't
reachable through an allowed single request. Use `--limit` to cap what you take from
that first page, not to page further.

---

## Usage examples

### Machine Learning roles in Stuttgart

```bash
bun run .agents/skills/stepstone-search/cli/src/cli.ts search \
  --query "Machine Learning Engineer" \
  --location "Stuttgart" \
  --format table
```

### Data Scientist roles in Berlin, last 14 days

```bash
bun run .agents/skills/stepstone-search/cli/src/cli.ts search \
  --query "Data Scientist" \
  --location "Berlin" \
  --jobage 14 \
  --format table
```

### Computer Vision roles anywhere in Germany

```bash
bun run .agents/skills/stepstone-search/cli/src/cli.ts search \
  --query "Computer Vision" \
  --limit 10 \
  --format table
```

### NLP roles in Frankfurt, JSON output

```bash
bun run .agents/skills/stepstone-search/cli/src/cli.ts search \
  --query "Natural Language Processing" \
  --location "Frankfurt" \
  --format json
```

### Get full details for a specific job

```bash
bun run .agents/skills/stepstone-search/cli/src/cli.ts detail 14338328 --format plain
```

---

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, data processing, passing IDs to `detail` |
| `table` | Quick human-readable overview and scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

---

## Notes

- All data is from the public `stepstone.de` search-results and job-detail pages — no
  credentials required.
- **Only the first results page is available** (~25 results, though `meta.total` in the
  JSON output reports Stepstone's own higher total count) — see "Why no pagination" above.
- `--jobage` is a client-side filter over each result's relative timestamp; unparseable
  timestamps are kept rather than dropped (can't prove they're stale).
- Salary and application-deadline data is inconsistently present on Stepstone postings
  (unlike the Danish portal skills in this repo) — both surface as `null` when absent,
  never fabricated.
- The apply button on Stepstone's detail pages is client-side-only; `detail`'s `applyUrl`
  is the posting's own URL, not a direct apply link — a human still opens it in a browser.
- Job IDs are numeric (e.g. `14338328`) — pass them as-is to `detail`.

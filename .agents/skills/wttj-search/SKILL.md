---
name: wttj-search
version: 1.0.0
description: >
  Use this skill to search live job listings on Welcome to the Jungle
  (welcometothejungle.com), the largest job board in the French market (~95,000
  open postings, ~93% of them in France). Covers every sector — tech, business,
  sales, marketing, industry — filterable by city, region, contract type (CDI,
  CDD, stage, alternance, freelance) and télétravail. Trigger phrases: find a job
  in France, jobs in Paris, French job search, Welcome to the Jungle, WTTJ,
  offres d'emploi, recherche d'emploi, chercher un job à Paris/Lyon/Bordeaux,
  emploi CDI, stage, alternance, télétravail, look up this Welcome to the Jungle
  posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/wttj-search/cli/src/cli.ts *)
---

# Welcome to the Jungle Search Skill

Search live job listings from **[Welcome to the Jungle](https://www.welcometothejungle.com)**,
the dominant job board in the French market. No authentication, no API key, and
**zero runtime dependencies** — it runs with just `bun`.

Postings are structured records (contract type, télétravail policy, salary range,
required experience and education, sector), not scraped prose — the same
Welcomekit record shape the `stationf-search` skill reads.

## ⚠️ Personal use only

This skill queries the **Algolia search host that Welcome to the Jungle's own
front-end calls**, using the search-only key the site publishes for it. It does
**not** fetch the site's search page: `www.welcometothejungle.com/robots.txt`
disallows query-string URLs (`Disallow: /*?` and `Disallow: */jobs?query=*`), so
the search URL is off-limits to automated clients. Job **detail** pages carry no
query string and are on the allowed side of robots.txt.

Reading the site's data this way is not something its terms invite, and this
skill is a deliberate, user-approved trade-off for a **personal job search**:

- Keep volume low — a handful of queries per session, not a crawl.
- No commercial use, no bulk collection, no redistribution of the data.
- You run it under your own responsibility.

**The site is behind AWS WAF.** Detail-page fetches are rate-limited by anti-bot
challenges; when one fires, the CLI exits with a clear `WAF_CHALLENGE` error (or
falls back to the search index, see below) rather than retrying blindly. If you
see it, wait a few minutes — do not loop.

## Scope

~95,000 live postings: ~88,000 in France, then Spain, the UK, the US and Germany.
Paris and Île-de-France dominate (~37,000 postings in the region), followed by
Auvergne-Rhône-Alpes, Nouvelle-Aquitaine and PACA. Postings are ~90% in French,
~9% in English. Contract mix: 70k CDI, 12.6k CDD, 6.8k stages, 3.4k alternances,
837 freelance.

## When to use this skill

- Search the French job market by keyword, city, or region
- Filter by contract type (CDI / CDD / stage / alternance / freelance),
  télétravail policy, department, sector, or posting language
- Sweep only what was posted recently (`--jobage`, backed by a date-sorted index)
- Get the full description of a specific WTTJ posting

## Commands

### Search job listings

```bash
bun run .agents/skills/wttj-search/cli/src/cli.ts search [-q "<mots-clés>"] [filtres]
```

Key flags:
- `--query <text>` / `-q <text>` — full-text keywords (title, company, description). Optional.
- `--location <cities>` / `-l <cities>` — city/cities, comma = OR. e.g. `-l Paris,Lyon`
- `--region <states>` — region as the site spells it, e.g. `--region Ile-de-France`
  (no accents, hyphenated — see `url-reference.md` for the exact spellings)
- `--country <codes>` — ISO-3166 alpha-2, e.g. `--country FR`
- `--contract <types>` — `cdi` | `cdd` | `stage` | `alternance` | `freelance` | `autres`
- `--remote <modes>` — `full` | `partial` | `punctual` | `no` (télétravail)
- `--department <names>` — `Tech`, `Business`, `Sales`, `Marketing`, `Opérations`, `Retail`, …
- `--company <slugs>` — organization slug(s), e.g. `--company gitguardian`
- `--language <codes>` — posting language: `fr`, `en`, `es`, `de`, `it`
- `--jobage <days>` — only postings published within N days
- `--sort <mode>` — `relevance` (default) | `date`
- `--page <n>` — 1-indexed. Default 1.
- `--limit <n>` / `-n <n>` — results returned. Default 20.
- `--format json|table|plain` — default `json`.
- `--facet <attr=value>` — any other index attribute (repeatable), e.g. `--facet education_level=BAC_5`

> `--jobage` and `--sort date` switch the query to the site's **date-sorted
> replica index**, so recency filtering is exact rather than best-effort. That
> also means those runs are ordered by date, not by relevance.

### Fetch full job detail

```bash
bun run .agents/skills/wttj-search/cli/src/cli.ts detail <org-slug/job-slug|url> [--format json|plain]
```

`<org-slug/job-slug>` is the `id` from a search result (e.g.
`gitguardian/senior-data-engineer_paris_GITGU_1O04qgL`); a full
`https://www.welcometothejungle.com/fr/companies/<org>/jobs/<slug>` URL works too.

**Two sources, and the output says which you got.** Normally `detail` reads the
job page's structured data and returns the full description (`"source": "page"`).
If the WAF blocks that page, it falls back to the search index and returns the
structured fields plus the "profil recherché" text, with `description: null` and
`"source": "index"`. Never assume a null description means the employer wrote
none — check `source`.

## Usage examples

```bash
# Permanent data roles in Paris
bun run .agents/skills/wttj-search/cli/src/cli.ts search -q "data engineer" -l Paris --contract cdi --format table

# Anything in Tech across Île-de-France posted in the last week, newest first
bun run .agents/skills/wttj-search/cli/src/cli.ts search --department Tech --region Ile-de-France --jobage 7 --format table

# Internships and apprenticeships in Lyon and Bordeaux
bun run .agents/skills/wttj-search/cli/src/cli.ts search --contract stage,alternance -l Lyon,Bordeaux --format table

# Full-remote English-language roles anywhere in France
bun run .agents/skills/wttj-search/cli/src/cli.ts search --remote full --language en --country FR --format table

# Roles paying at least €60k, where the employer published a salary
bun run .agents/skills/wttj-search/cli/src/cli.ts search -q "product manager" --facet salary_yearly_minimum=60000 --format table

# Full details for one posting
bun run .agents/skills/wttj-search/cli/src/cli.ts detail gitguardian/senior-data-engineer_paris_GITGU_1O04qgL --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing a result's `id` to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page", "total", "window", "truncated" }, "results": [...] }`;
each result carries at least `id`, `title`, `company`, `location`, `date`, and
`url`, plus the French-market extras `contract`, `contract_type`, `remote`,
`salary`, `department`, `experience_years` and `reference` (missing values are
`null`, never omitted). All errors go to **stderr** as
`{ "error": "...", "code": "..." }` with exit code `1`; `WAF_CHALLENGE` is the
code that means "back off", not "broken".

## Notes

- **`id` is `<org-slug>/<job-slug>`**, not the Algolia object id — that pair
  addresses the public job page, and it is what `detail` consumes.
- **Duplicates are removed by `reference`.** WTTJ stores one record per job *per
  website* it syndicates to — a single posting can carry 16 of them — so raw
  results repeat heavily. The CLI over-fetches and dedupes; `meta.total` is the
  raw Algolia count and therefore **larger than the number of distinct jobs**.
- **`remote: "unknown"`** means the employer did not state a policy — not that
  the role is on-site. `unknown` is the single largest bucket (~39k postings), so
  filtering on `--remote partial` silently drops jobs that may well be hybrid.
- **`contract` is the French label** (`CDI`, `CDD / Temporaire`, `Stage`,
  `Alternance`, `Freelance`); `contract_type` keeps the raw code for filtering.
- **Region names have no accents and are hyphenated** in the index
  (`Ile-de-France`, `Auvergne-Rhone-Alpes`, `Provence-Alpes-Cote d'Azur`).
  City names do carry accents. Use `url-reference.md` rather than guessing.
- **Salary is only present when the employer published one**, which most do not.
- Requests retry 429/5xx with exponential backoff; an unreachable site exits
  non-zero with a clear message rather than hanging.

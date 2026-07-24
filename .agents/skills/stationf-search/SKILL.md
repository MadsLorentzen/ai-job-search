---
name: stationf-search
version: 1.0.0
description: >
  Use this skill to search live job listings from the STATION F job board
  (jobs.stationf.co) — roles at the ~1,000 startups on the STATION F campus in
  Paris, plus their other offices. Covers the French startup market: CDI, CDD,
  stage, alternance and freelance roles, filterable by city, contract type and
  télétravail. Trigger phrases: Station F jobs, startup jobs Paris, jobs at
  French startups, offres d'emploi Station F, emploi startup Paris, recherche
  d'emploi startup, stage/alternance startup Paris, look up this Station F
  posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/stationf-search/cli/src/cli.ts *)
---

# STATION F Job Board Search Skill

Search live job listings from the **[STATION F job board](https://jobs.stationf.co)** —
the shared careers board of the startups based on the STATION F campus in Paris
(the world's largest startup campus). No authentication, no API key, and **zero
runtime dependencies** — it runs with just `bun`.

The board is built on **Welcomekit**, Welcome to the Jungle's ATS, so the records
are structured (contract type, télétravail policy, salary range, required
experience) rather than scraped from prose — the same record shape the
`wttj-search` skill reads.

## Scope: small, high-signal, Paris-centric

~650 live postings from ~200 startups. That is a fraction of what a general board
carries, so treat this as a **high-signal supplement**, not a volume source:
every posting is from a campus-resident startup, and the corpus skews Paris
(~85% of postings), Tech/Business/Sales, and early-career-friendly (over a
quarter of postings are stages or alternances).

## Access

The board's `robots.txt` is `Allow: /`, and everything this skill reads is public:
the Algolia application id, the **search-only** API key, and the index name are
published by the board's own `/search` page for its JavaScript, and the job pages
are fully server-rendered. The CLI re-reads those credentials at call time rather
than hardcoding them, so a key rotation heals itself. Keep query volume modest —
this is a job search, not a crawl.

## When to use this skill

- Find startup roles in Paris (or the startups' other offices) by keyword
- Filter by contract type (CDI / CDD / stage / alternance / freelance), city,
  télétravail policy, department, or posting language
- Track a specific campus startup's openings (`--company <slug>`)
- Get the full description of a specific Station F posting

## Commands

### Search job listings

```bash
bun run .agents/skills/stationf-search/cli/src/cli.ts search [-q "<mots-clés>"] [filtres]
```

Key flags:
- `--query <text>` / `-q <text>` — full-text keywords (title, company, description). Optional.
- `--location <cities>` / `-l <cities>` — city/cities, comma = OR. e.g. `-l Paris,Marseille`
- `--region <states>` — region as the board spells it, e.g. `--region Ile-de-France`
- `--country <codes>` — ISO-3166 alpha-2, e.g. `--country FR`
- `--contract <types>` — `cdi` | `cdd` | `stage` | `alternance` | `freelance` | `autres`
  (English spellings work too: `full-time`, `temporary`, `internship`, `apprenticeship`)
- `--remote <modes>` — `full` | `partial` | `punctual` | `no` (French: `complet`, `partiel`, `ponctuel`, `non`)
- `--department <names>` — `Tech`, `Business`, `Sales`, `Marketing`, `Opérations`, …
- `--company <slugs>` — organization slug(s), e.g. `--company joko-1`
- `--language <codes>` — posting language: `fr`, `en`, `es`, `de`, `it`
- `--jobage <days>` — keep postings published within N days
- `--sort <mode>` — `relevance` (default) | `date`
- `--page <n>` — 1-indexed. Default 1.
- `--limit <n>` / `-n <n>` — results returned. Default 20.
- `--format json|table|plain` — default `json`.
- `--facet <attr=value>` — any other index attribute (repeatable), e.g. `--facet education_level=BAC_5`

> **`--jobage` and `--sort date` are applied client-side.** The board has no
> date-sorted index, so the CLI widens the fetch window (to ≥100 hits) and filters
> there. With a corpus of ~650 postings that is reliable for a broad query; if a
> narrow query plus `--jobage` returns nothing, widen the query rather than
> concluding nothing was posted. `meta.window` in the JSON output reports the
> window that was actually scanned.

### Fetch full job detail

```bash
bun run .agents/skills/stationf-search/cli/src/cli.ts detail <org-slug/job-slug|url> [--format json|plain]
```

`<org-slug/job-slug>` is the `id` from a search result (e.g.
`allphins/data-engineer-h-f_paris`). A full
`https://jobs.stationf.co/companies/<org>/jobs/<slug>` URL works too. Returns the
full description, the candidate profile ("Profil recherché"), education and
experience requirements, contract type, salary, and the posting/expiry dates.

## Usage examples

```bash
# Data roles in Paris, permanent contracts
bun run .agents/skills/stationf-search/cli/src/cli.ts search -q "data engineer" -l Paris --contract cdi --format table

# Anything in Tech posted in the last two weeks, newest first
bun run .agents/skills/stationf-search/cli/src/cli.ts search --department Tech --jobage 14 --sort date --format table

# Internships and apprenticeships for a product career
bun run .agents/skills/stationf-search/cli/src/cli.ts search -q "product" --contract stage,alternance --format table

# Roles with at least partial remote, English-language postings
bun run .agents/skills/stationf-search/cli/src/cli.ts search --remote partial,full --language en --format table

# Everything open at one campus startup
bun run .agents/skills/stationf-search/cli/src/cli.ts search --company joko-1 --sort date --format table

# Full details for one posting
bun run .agents/skills/stationf-search/cli/src/cli.ts detail allphins/data-engineer-h-f_paris --format plain
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
`{ "error": "...", "code": "..." }` with exit code `1`.

## Notes

- **`id` is `<org-slug>/<job-slug>`**, not the Algolia object id — that pair is
  what addresses the public job page, and it is what `detail` consumes.
- **Duplicates are removed by `reference`.** Welcomekit stores one record per job
  *per website*, so the same posting can appear several times in raw results.
- **`remote` values** are the board's own vocabulary: `fulltime`, `partial`,
  `punctual`, `no`, `unknown`. `unknown` means the employer did not state a
  policy — not that the role is on-site.
- **`contract` is the French label** (`CDI`, `CDD / Temporaire`, `Stage`,
  `Alternance`, `Freelance`); `contract_type` keeps the raw code (`FULL_TIME`, …)
  for filtering.
- **`salary` is only present when the employer published one** (~44% of postings).
  Its shape follows the source: a range from `search`, sometimes a single figure
  from `detail`.
- Facet values are controlled vocabularies. To discover live values for an
  attribute, use `--facet` against a value you saw in results rather than
  inventing one; `url-reference.md` lists the attributes and their common values.
- Requests retry 429/5xx with exponential backoff; an unreachable board exits
  non-zero with a clear message rather than hanging.

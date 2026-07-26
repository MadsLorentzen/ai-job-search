---
name: free-work-search
version: 1.0.0
description: >
  Use this skill to search live IT / tech / engineering job postings and
  freelance missions on Free-Work (www.free-work.com), the largest French
  freelance and IT job board (formerly Freelance-Info), or to look up a specific
  posting. Filterable by keyword, contract type (freelance/contractor, CDI,
  CDD, alternance), location key, and remote policy, and it returns the daily
  rate (TJM), mission duration, and renewability that French freelance missions
  publish. Trigger phrases: mission freelance, freelance mission France, TJM,
  taux journalier, Free-Work, freelance informatique, mission backend Paris,
  developpeur freelance, offres freelance, recherche mission, find a freelance
  contract in France, French IT contracting, look up this Free-Work posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/free-work-search/cli/src/cli.ts *)
---

# Free-Work Search Skill

Search live job postings from **[Free-Work](https://www.free-work.com)** — the
French tech job board formed from Freelance-Info and Carrière-Info. It is the
main French destination for **freelance IT missions**, which the country's
generalist boards barely carry (Welcome to the Jungle lists ~837 freelance
postings against ~70k CDI).

Unlike the HTML-scraping portals in this repo, this skill queries Free-Work's
**public JSON API** (`https://api.free-work.com/job_postings`), so results are
structured rather than parsed from markup. No authentication, no API key, and
**zero runtime dependencies** — it runs with just `bun`.

## Why this portal matters for freelance search

Free-Work publishes the fields a freelancer actually decides on, which most job
boards omit entirely:

| Field | Example |
|---|---|
| **TJM** (taux journalier moyen) | `450-620 EUR/day` — present on roughly half of postings |
| **Duration** | `6 months`, `1 year` |
| **Renewable** | `true` / `false` |
| **Contract type** | `contractor` (freelance), `permanent`, `fixed-term`, `apprenticeship` |
| **Remote policy** | `full` / `partial` / `none` |
| **Experience level** | `junior` / `intermediate` / `senior` / `expert` |

## Access and fair use

Free-Work's `robots.txt` disallows only `/login`, `/logout`, and `/fw-deals`;
the job paths are permitted, and the API answers unauthenticated GETs. There is
no ToS-restriction warning to carry here, unlike `linkedin-search`. Even so,
this is a personal job-search tool: keep request volume modest and do not use it
for bulk data collection.

## When to use this skill

- Find freelance missions (`--contract contractor`) in the French market
- Filter by daily rate expectations, region, remote policy, or recency
- Search permanent French tech roles too (`--contract permanent`)
- Get the full description of a specific Free-Work posting

## Commands

```bash
bun run .agents/skills/free-work-search/cli/src/cli.ts search [flags]
bun run .agents/skills/free-work-search/cli/src/cli.ts detail <slug|url> [--format json|plain]
```

### Search flags

| Flag | Meaning |
|---|---|
| `--query`, `-q <text>` | Keywords: job title, skill, or stack. Recommended. |
| `--location`, `-l <place>` | Region, department, or city. Accepts a friendly name (`"Ile-de-France"`, `"Paris"`) or an exact Free-Work location key (`fr~ile-de-france~~`). |
| `--contract`, `-c <types>` | `contractor` \| `permanent` \| `fixed-term` \| `apprenticeship` \| `internship`. Comma-separated for OR. |
| `--remote <mode>` | `full` \| `partial` \| `none`. Client-side filter. |
| `--jobage <days>` | Posted within N days. **Client-side** — the API has no date filter. |
| `--page <n>` | 1-indexed page, 50 results per page. Default 1. |
| `--limit`, `-n <n>` | Cap results emitted (client-side). |
| `--format <fmt>` | `json` (default) \| `table` \| `plain`. |

### Examples

```bash
# Freelance backend missions in Île-de-France, newest first
bun run .agents/skills/free-work-search/cli/src/cli.ts \
  search -q "backend" -c contractor -l "Ile-de-France" --format table

# Rust missions posted in the last two weeks
bun run .agents/skills/free-work-search/cli/src/cli.ts \
  search -q "rust" -c contractor --jobage 14 --format plain

# Full-remote platform / DevEx missions
bun run .agents/skills/free-work-search/cli/src/cli.ts \
  search -q "platform engineer" -c contractor --remote full --format table

# TypeScript missions in Paris, capped at 10
bun run .agents/skills/free-work-search/cli/src/cli.ts \
  search -q "developpeur typescript" -c contractor -l Paris -n 10

# Full description of one posting
bun run .agents/skills/free-work-search/cli/src/cli.ts \
  detail developpeur-fullstack-java-spring-react-trade-finance-operation --format plain
```

## Output format

`--format json` (default) follows the repo's portal-skill contract:

```json
{
  "meta": { "count": 8, "page": 1 },
  "results": [
    {
      "id": "656516",
      "slug": "developpeur-c-net-backend-azure",
      "title": "Développeur C# .NET backend Azure",
      "company": "Digistrat consulting",
      "location": "Paris, France",
      "date": "2026-07-24T09:12:03+02:00",
      "url": "https://www.free-work.com/fr/tech-it/job-mission/...",
      "contracts": ["contractor"],
      "remote": "partial",
      "experienceLevel": "senior",
      "dailyRate": "450-620 EUR/day",
      "annualSalary": null,
      "duration": "6 months",
      "renewable": true
    }
  ]
}
```

Missing values are `null`, never omitted. Errors go to **stderr** as
`{"error": "...", "code": "..."}` with exit code 1.

| Format | Use |
|---|---|
| `json` | Default. Machine-readable, full field set. |
| `table` | Scannable one-line-per-mission with TJM column. |
| `plain` | Human-readable blocks including contract, TJM, duration, remote. |

## Notes and portal quirks

- **`detail` takes a slug, not a numeric id.** `/job_postings/{id}` returns 404;
  only `/job_postings/{slug}` resolves. Pass the `slug` field from a search
  result, or the full posting URL — the CLI extracts the slug from either. A
  bare number produces a `BAD_ID` error explaining this.
- **The keyword parameter is `searchKeywords`.** The website's own front-end
  sends `query=`, which the API accepts and then **silently ignores** — it
  returns unfiltered results rather than an error. This is the single easiest
  way to get plausible-looking but wrong output from this API.
- **`contracts` must be a scalar.** `contracts=contractor` works;
  `contracts[]=contractor` returns `Input value "contracts" contains a
  non-scalar value.` Comma-separate for OR: `contracts=contractor,permanent`.
- **No server-side date filter.** `publishedSince`, `sinceDate`, and
  `publishedAt[after]` are all silently ignored. `--jobage` is therefore applied
  client-side after fetching a page sorted by `order=date` (newest first), so a
  narrow `--jobage` on a broad query may return few results from page 1 — raise
  `--page` to reach further back.
- **Location keys** follow `country~adminLevel1~adminLevel2~locality`, where
  empty trailing segments widen the match (`fr~ile-de-france~~` = the whole
  region). The CLI slugifies a friendly name into a region-level key; for an
  exact department or city, copy the `location.key` value from a search result
  and pass it verbatim.
- **Coverage is not France-only.** The board carries Swiss, Belgian, and UK
  postings (currency comes back as `GBP` for the latter). Filter with
  `--location` if you need French roles only.
- **`order=date` is the only ordering that works.** API Platform's
  `order[publishedAt]=desc` syntax errors out as non-scalar.

See `url-reference.md` for full endpoint documentation and the raw field list.

---
name: hellowork-search
version: 1.0.0
description: >
  Use this skill to search live job postings and freelance missions on HelloWork
  (www.hellowork.com), the largest French generalist job board, or to look up a
  specific HelloWork posting. Covers the whole French market (all sectors, not
  just tech) and filters by keyword, city or region, contract type
  (Freelance, Independant, CDI, CDD, alternance, stage, interim), posting age,
  and search radius. Returns the TJM / salary range where the employer published
  one. Trigger phrases: HelloWork, offres d'emploi, offre d'emploi France,
  recherche emploi, emploi Paris, mission freelance, TJM, taux journalier,
  developpeur freelance Paris, annonces emploi, chercher un emploi en France,
  French job board, find jobs in France, look up this HelloWork posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/hellowork-search/cli/src/cli.ts *)
---

# HelloWork Search Skill

Search live job postings from **[HelloWork](https://www.hellowork.com)** — the
largest French generalist job board (formerly RegionsJob). It is broad rather
than tech-specific, and unlike most French generalist boards it carries a real
volume of **Freelance** postings with published daily rates.

The CLI parses HelloWork's server-rendered search page and reads the
**schema.org `JobPosting` JSON-LD** that every posting page embeds, so `detail`
returns structured data rather than scraped markup. No authentication, no API
key, and **zero runtime dependencies** — it runs with just `bun`.

## ⚠️ Personal use only

**HelloWork's `robots.txt` disallows the search endpoint for generic clients.**
Specifically, for `User-Agent: *` it declares:

```
Disallow: /*?                            # any URL carrying a query string
Disallow: /fr-fr/emploi/recherche.html   # the search endpoint this skill uses
```

Detail pages (`/fr-fr/emplois/<id>.html`) are **not** disallowed — only
sub-paths such as `/candidature.html`, `/token/`, and `/ext/` are. So `detail`
is within the rules; `search` is not.

Notably, the same file grants `Allow: /*?` with an empty `Disallow:` to
`GPTBot`, `ChatGPT-User`, `OAI-SearchBot`, and `ccbot` — HelloWork permits AI
crawlers what it denies generic bots. That is their decision about crawlers, not
a licence for this tool.

Accordingly: **keep request volume low** (a handful of searches, not a crawl),
do **not** use this commercially or for bulk data collection, and run it on your
own responsibility. It exists to support one person's job search.

## When to use this skill

- Find freelance missions (`-c Freelance`) across the French market, including
  outside tech
- Search a specific French city or region with a radius
- Filter to the newest postings (`--jobage`, `--sort date`) for a daily sweep
- Pull the full description, required skills, and TJM of a specific posting

## Commands

```bash
bun run .agents/skills/hellowork-search/cli/src/cli.ts search [flags]
bun run .agents/skills/hellowork-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

### Search flags

| Flag | Meaning |
|---|---|
| `--query`, `-q <text>` | Keywords: job title, skill, or stack. Recommended. |
| `--location`, `-l <text>` | Place. Must use HelloWork's own form — see the note below. |
| `--contract`, `-c <types>` | `Freelance` \| `Independant` \| `CDI` \| `CDD` \| `Travail_temp` \| `Stage` \| `Alternance` \| `Franchise` \| `Associe` \| `Fonctionnaire` \| `Stage_de_lycee`. Comma-separated for OR. English aliases (`freelance`, `permanent`, `contractor`, `internship`, `apprenticeship`) are accepted. |
| `--jobage <days>` | Posted within N days. HelloWork's own buckets are 24h / 3d / 1w / 1m; anything finer is filtered client-side. |
| `--sort <mode>` | `relevance` (default) \| `date`. |
| `--radius <km>` | Radius around `--location`. HelloWork's own default is 20. |
| `--page <n>` | 1-indexed page, 30 results per page. Default 1. |
| `--limit`, `-n <n>` | Cap results emitted (client-side). |
| `--format <fmt>` | `json` (default) \| `table` \| `plain`. |

> **`--location` needs a city *and* its postcode**, e.g. `"Paris 75000"`,
> `"Lyon 69000"`, `"Marseille 13000"` — or a region name such as
> `"Ile-de-France"`. A bare city name (`-l Paris`) is **not** recognised and
> returns **zero** results rather than an error. Omit the flag entirely to
> search all of France.

### Examples

```bash
# Freelance backend missions in Paris
bun run .agents/skills/hellowork-search/cli/src/cli.ts \
  search -q "backend" -l "Paris 75000" -c Freelance --format table

# Everything posted in the last 3 days across Île-de-France, newest first
bun run .agents/skills/hellowork-search/cli/src/cli.ts \
  search -q "developpeur" -l "Ile-de-France" -c Freelance --jobage 3 --sort date

# Freelance or independent, either contract, capped at 10
bun run .agents/skills/hellowork-search/cli/src/cli.ts \
  search -q "typescript node" -c Freelance,Independant -n 10 --format plain

# Widen the radius around Paris to 40 km, second page
bun run .agents/skills/hellowork-search/cli/src/cli.ts \
  search -q "rust" -l "Paris 75000" --radius 40 --page 2

# Full description, skills, and TJM of one posting
bun run .agents/skills/hellowork-search/cli/src/cli.ts \
  detail 81577686 --format plain

# detail also accepts a pasted posting URL
bun run .agents/skills/hellowork-search/cli/src/cli.ts \
  detail https://www.hellowork.com/fr-fr/emplois/81577686.html
```

## Output format

`--format json` (default) follows the repo's portal-skill contract:

```json
{
  "meta": { "count": 5, "page": 1 },
  "results": [
    {
      "id": "81577686",
      "title": "Développeur Mulesoft - Salesforce H/F",
      "company": "Celad",
      "location": "Paris - 75",
      "date": "2026-07-22",
      "dateRelative": "il y a 5 jours",
      "ageDays": 5,
      "url": "https://www.hellowork.com/fr-fr/emplois/81577686.html",
      "contract": "Freelance",
      "salary": "500 - 550 € / jour"
    }
  ]
}
```

Missing values are `null`, never omitted. Errors go to **stderr** as
`{"error": "...", "code": "..."}` with exit code 1.

`detail` adds `companyUrl`, `employmentType`, `validThrough`,
`experienceMonths`, `education`, `industry[]`, `skills[]`, `description`, and
`qualifications`, all sourced from the posting's JSON-LD.

| Format | Use |
|---|---|
| `json` | Default. Machine-readable, full field set. |
| `table` | Scannable one-line-per-posting with contract and TJM columns. |
| `plain` | Human-readable blocks; on `detail`, the full description text. |

## Notes and portal quirks

- **Cards carry no timestamp — only a French relative label.** "il y a 5 jours",
  "il y a 18 heures". The CLI converts these to an ISO `date` plus `ageDays`,
  and keeps the original in `dateRelative`. The freshest listings drop the
  prefix entirely and read **"moins d'une heure"**, which is why the parser
  cannot simply match on `il y a`.
- **`--jobage` is only as precise as HelloWork's buckets.** The board offers
  24h / 3 days / 1 week / 1 month (`d=h|d|w|m`). The CLI requests the tightest
  bucket containing your value, then filters the remainder client-side. Cards
  whose label does not parse are **kept**, not dropped, so a filter never
  silently hides a posting.
- **A bare city name returns zero results.** `l=Paris` yields nothing;
  `l=Paris 75000` works. The `l_autocomplete=<INSEE code>` parameter the website
  sends alongside is ignored on its own and is not required.
- **`data-cy="contractCard"` is a trap on detail pages.** Those divs belong to
  the *related-offers sidebar*, so reading one gives you a neighbouring job's
  contract type (a Paris freelance mission reported as a CDI in Buc). The
  posting's real contract comes from the GTM `dataLayer` blob scoped to its own
  `idOffre`, with the `<h1>` tag list as fallback.
- **`employmentType` is not the contract type.** JSON-LD reports
  `FULL_TIME`/`PART_TIME`; the French contract (`Freelance`, `CDI`, …) is the
  separate `contract` field.
- **Duplicate postings are common.** The same mission is frequently listed
  several times under different ids by the same agency (ESN) — often within
  minutes. Treat repeated title+company pairs as one opportunity; this is the
  mass-posting pattern the job-scraper skill flags.
- **Heavy ESN presence.** Many freelance listings come from staffing agencies
  placing consultants at an unnamed end client. Check `company` against the
  ESN / body-shop deal-breaker before investing time in one.
- **30 results per page**, via `p=` (1-indexed; `p` is omitted for page 1).
- **Salary is only present when the employer published it** — roughly half of
  freelance listings show a TJM range, the rest show nothing.

See `url-reference.md` for full endpoint documentation and the parsing anchors.

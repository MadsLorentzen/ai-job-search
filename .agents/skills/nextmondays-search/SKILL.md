---
name: nextmondays-search
version: 1.0.0
description: >
  Use this skill to search freelance tech missions in France on Next Mondays
  (nextmondays.com) — a French job board dedicated to freelance/contractor tech
  work (missions in Île-de-France, Auvergne-Rhône-Alpes, Nouvelle-Aquitaine, Pays
  de la Loire, Bourgogne-Franche-Comté). Every listing is a freelance mission with
  a published daily rate (TJM), so this is the skill for daily-rate and contract
  searches. Trigger phrases: freelance mission, contract role France, daily rate,
  TJM, French freelance jobs, missions in Paris/Lyon/Nantes/Bordeaux; and in
  French: mission freelance, offre freelance, recherche de mission, missions
  informatiques, TJM, offres d'emploi tech, développeur freelance, régie,
  prestation, consultant indépendant.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/nextmondays-search/cli/src/cli.ts *)
---

# Next Mondays Search Skill

Search live **freelance tech missions in France** from [Next Mondays](https://nextmondays.com),
a Marseille-based placement platform focused on digital and electronics freelancing. No
authentication, no API key, and **zero runtime dependencies** — it runs with just `bun`.

Every listing is a freelance/contractor mission (`employmentType: CONTRACTOR`) with a
**published indicative daily rate (TJM)**, which makes this board unusually easy to
pre-filter on rate.

## ✅ robots.txt compliant

`nextmondays.com/robots.txt` disallows `/Search` (the site's own keyword-search endpoint).
**This skill never requests it.** It reads the allowed listing surfaces instead —
`/jobs/regions/*`, `/jobs/groups/*`, `/jobs/tags/*` — and filters by keyword client-side.
The public board is small (~80 missions), so one fetch covers it. Keep volume low anyway.

## ⚠️ The end client is never named

Next Mondays is a **placement intermediary**. Listings describe the client only as an
anonymised blurb ("Fintech", "Filiale d'un grand groupe spécialisé dans le Gaming").
Accordingly, every result has `company: null`, the blurb in `clientProfile`, and
`intermediary: "Next Mondays"`. If unnamed end clients are a deal-breaker for you, treat
that field as the signal — it is never populated on this board.

## When to use this skill

- Find freelance tech missions in France, filtered by keyword, domain, tag, or city
- Screen missions by **minimum daily rate** (`--tjm-min`) before reading any of them
- Filter out missions already taken (`offre pourvue` listings are excluded by default)
- Get the full description, duration, tags, and recruiter contact for a mission

## Commands

### Search missions

```bash
bun run .agents/skills/nextmondays-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keywords, matched client-side against title, client blurb, tags, and domain. Space-separated terms are ANDed. Accent-insensitive: `developpeur` matches `Développeur`.
- `--location <text>` / `-l <text>` — city or region (`Paris`, `Lyon`, `Nantes`, `Île-de-France`). Location only exists on detail pages, so this triggers enrichment — narrow with `-q` or `-t` first.
- `--group <name>` / `-g <name>` — job domain: `electronique`, `"infra & ops"`, `"logiciel embarqué"`, `management`, `"test & qa"`, `"web & edition"`.
- `--tag <name>` / `-t <name>` — an exact site tag (`typescript`, `react`, `python`, `devops`, `nodejs`). Cheaper than `-q`: the tag page is filtered server-side.
- `--jobage <days>` — posted within N days. Triggers enrichment (see above).
- `--tjm-min <n>` — minimum published daily rate in EUR/day.
- `--include-filled` — include missions marked `offre pourvue` (excluded by default).
- `--enrich` — fetch each match's detail page to fill in `location` and `date`.
- `--page <n>` — page number (1-indexed, 20 results per page).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full mission detail

```bash
bun run .agents/skills/nextmondays-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the mission reference from `search` results (e.g. `03P712386`). A full
`nextmondays.com/jobs/...` URL works too. Returns the mission brief, client blurb,
required profile, duration, domain, TJM, tags, key points, and the named Next Mondays
recruiter with their email.

## Usage examples

```bash
# TypeScript missions, quick scan
bun run .agents/skills/nextmondays-search/cli/src/cli.ts search -q "typescript" --format table

# Backend Node missions at 550 EUR/day or more
bun run .agents/skills/nextmondays-search/cli/src/cli.ts search -q "node backend" --tjm-min 550 --format table

# Everything tagged React, in Paris (enriches to resolve the city)
bun run .agents/skills/nextmondays-search/cli/src/cli.ts search -t react -l Paris --format table

# Web & Edition domain, posted in the last 90 days
bun run .agents/skills/nextmondays-search/cli/src/cli.ts search -g "web & edition" --jobage 90 --format table

# Rust/Go systems work anywhere on the board, with dates and cities filled in
bun run .agents/skills/nextmondays-search/cli/src/cli.ts search -q "rust" --enrich --format plain

# Full brief for one mission
bun run .agents/skills/nextmondays-search/cli/src/cli.ts detail 03P712386 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning (id, title, location, TJM, date, status) |
| `plain` | Reading missions with their client blurb and tags |

Search JSON is `{ "meta": {...}, "results": [...] }`. Each result carries `id`, `title`,
`company` (always `null` here), `location`, `date`, `url`, plus `subtitle`,
`clientProfile`, `intermediary`, `tjm`, `currency`, `tags`, `group`, and `filled`.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process
exits with code `1`.

## Notes

- **Small board.** ~79 listings total, of which roughly 50 are open at any time. There is
  no meaningful pagination on the site — one fetch returns everything.
- **Region pages don't filter.** `/jobs/regions/<anything>` renders the *complete* board
  server-side; the region facet is applied by the site's own JS. The CLI exploits this and
  uses one region page as its "all missions" surface. Don't read region in the URL as a filter.
- **No location or date on listing cards.** Both live only on detail pages, which is why
  `-l` and `--jobage` imply enrichment (one extra request per match, 4 at a time, capped at
  100 — `meta.enrichTruncated` flags the cap). Narrow with `-q`/`-t`/`--tjm-min` first.
- **Listings are long-lived.** Posting dates on currently-open missions span roughly six
  months, so `--jobage` is worth using when you want genuinely fresh work.
- **Filled missions stay listed** as `offre pourvue` (~29 of 79). They're excluded unless
  you pass `--include-filled`.
- **Tags are exact strings.** `-t typescript` works; `-t "type script"` returns nothing.
  Tag names come from the `tags` array on any result.
- **Known upstream data bug:** the detail page's JSON-LD reports
  `addressCountry: "Afghanistan"` for every mission. The CLI ignores that field and uses
  the page's own `localisation` value instead.
- The mission URL slug is decorative — `/jobs/<id>` resolves on its own, so `detail` only
  needs the reference.

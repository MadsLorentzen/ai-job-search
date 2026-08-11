---
name: stepstone-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in Germany, find German job
  listings on StepStone, look up a specific StepStone job posting, or asks anything about
  the German job market via StepStone — even if they don't say "stepstone" explicitly.
  Invoke for open positions, job vacancies, hiring in Germany, or German-market roles in
  any sector. Trigger phrases include: stepstone, jobsuche, stellenangebote, stellenanzeige,
  jobs in deutschland, stellenmarkt, jobboerse, jobbörse, job search germany, german jobs,
  jobs in berlin, jobs in munich, jobs in muenchen, jobs in frankfurt, jobs in hamburg,
  jobs in cologne, jobs in koeln, product owner jobs germany, product manager jobs germany,
  english speaking jobs germany, jobs deutschland, arbeit finden, offene stellen.
context: fork
enabled: true
allowed-tools: Bash(bun run .agents/skills/stepstone-search/cli/src/cli.ts *)
---

# StepStone Search Skill

Search live German job listings from StepStone.de. No authentication needed, **zero runtime
dependencies** — it runs with just `bun`.

## Personal use, low volume

StepStone's `robots.txt` disallows most of the site's query-string search endpoints and its
JSON API entirely (`/public-api/resultlist/`); this skill only uses the paths it explicitly
permits (see `url-reference.md` for the exact rules). The site also runs active bot detection —
detail pages silently hang/drop connections that don't look like real browser navigation (see
the Referer-header note in `url-reference.md`). Both of these are signs the site does not want
heavy automated traffic. **Keep volume low, don't use this for bulk data collection, and run it
on your own responsibility.**

## When to use this skill

- Search for job openings in Germany by job title/keyword, optionally filtered by city
- Get the full description, contract type, and work-type (remote/hybrid/onsite) of a specific posting
- Explore the German job market for a given role type

## Commands

### Search job listings

```bash
bun run .agents/skills/stepstone-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — job title / keywords, e.g. `"Product Owner"`. Recommended.
- `--location <text>` / `-l <text>` — a German city, e.g. `"Berlin"`, `"Muenchen"`. Optional — omit for all of Germany.
- `--limit <n>` / `-n <n>` — cap results emitted (client-side).
- `--format json|table|plain` — default `json`.

> **No `--jobage` or `--page`.** StepStone's robots.txt only allows a single, query-string-free
> search URL per query (see `url-reference.md`) — there is no robots.txt-compliant way to
> request a second page or filter by posting age via URL parameters on this path. Each search
> returns StepStone's own default single page of results (observed ~25).

### Fetch full job detail

```bash
bun run .agents/skills/stepstone-search/cli/src/cli.ts detail <url> [--format json|plain]
```

Pass the full `url` from a `search` result — StepStone detail URLs embed a descriptive slug
before the numeric job ID, so a bare ID alone cannot be turned into a working URL. Returns the
full description (job description + requirements + benefits sections combined), contract type,
work type, and posting date.

## Usage examples

```bash
# Product Owner roles in Berlin
bun run .agents/skills/stepstone-search/cli/src/cli.ts search -q "Product Owner" -l "Berlin" --format table

# Product Manager roles anywhere in Germany
bun run .agents/skills/stepstone-search/cli/src/cli.ts search -q "Product Manager" --format table

# Payments-specific search
bun run .agents/skills/stepstone-search/cli/src/cli.ts search -q "Produktmanager Zahlungsverkehr" -l "Frankfurt am Main" --format table

# Full detail for a specific posting (URL from a search result)
bun run .agents/skills/stepstone-search/cli/src/cli.ts detail "https://www.stepstone.de/stellenangebote--...--14255090-inline.html" --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing URLs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Query keywords are **English or German** — StepStone does fuzzy matching on the URL slug, so
  either works ("Product Owner" and "Produktmanager" both return relevant results); for the
  candidate's dual-market English-speaking-roles-only search, English keywords are fine.
- `date` / `onlineDate` fields are **German relative-time strings** (`vor 3 Tagen`, `vor 1
  Woche`), not ISO dates — StepStone does not expose an absolute posting date anywhere in the
  markup this CLI can reach.
- `applyUrl` in `detail` output is always `null` — the apply button is wired up by client-side
  JS after page load and isn't present in the static HTML. Use the job's own `url` to apply.
- Results can list multiple cities for one posting (multi-location roles) — `location` may be a
  comma-separated string.
- See `url-reference.md` for the full robots.txt analysis, markup anchors, and the detail-page
  Referer-header requirement (**do not fetch detail pages without it** — the request will hang).

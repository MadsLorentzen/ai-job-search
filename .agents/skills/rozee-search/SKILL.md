---
name: rozee-search
version: 1.0.0
description: >
  Search public job listings on Rozee.pk in Pakistan. Use for Rozee jobs,
  job search in Pakistan, data and AI/ML roles, and for
  نوکریاں تلاش کرنا or پاکستان میں نوکریاں.
context: fork
enabled: true
allowed-tools: Bash(bun run .agents/skills/rozee-search/cli/src/cli.ts *)
---

# Rozee.pk Search Skill

Search public job listings on Rozee.pk, Pakistan's job portal. Search results
include the listing title, employer, city, posted date, and a link to the
original listing. The CLI uses Bun and has no runtime dependencies.

## Personal use only

Rozee's site says reproducing page material without permission is prohibited.
The portal's robots.txt allows its job-search and job-detail paths, but the
terms page does not clearly state whether automated access is permitted. This
skill is for low-volume personal job searching only: it extracts a small set of
listing fields and links back to Rozee.pk. Do not use it commercially or for
bulk collection. Use it at your own responsibility and seek Rozee's permission
before reusing or redistributing listing content.

## Commands

### Search listings

```bash
bun run .agents/skills/rozee-search/cli/src/cli.ts search --query "<keywords>" [flags]
```

Flags:

- `--query, -q <text>`: job title, skill, or other keywords. Omit to search all
  available listings.
- `--location, -l <city>`: supported Pakistani city (currently Lahore,
  Islamabad, Karachi, Rawalpindi, or Faisalabad). Omit to search across
  Pakistan.
- `--page <n>`: 1-indexed page; Rozee returns 20 results per page.
- `--limit, -n <n>`: client-side result cap.
- `--format json|table|plain`: output format; defaults to `json`.

Rozee does not expose a posting-age or remote-work filter on this search page.
`--jobage` is rejected rather than silently ignored. `/scrape` should apply its
14-day date window to the returned `date` field. Remote roles should be searched
on a portal that exposes a remote filter, such as LinkedIn.

### Fetch a listing

```bash
bun run .agents/skills/rozee-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

Use the `id` (the Rozee permalink slug) or `url` from a search result. Numeric
job IDs alone cannot be resolved to a permalink by this portal's public pages.

## Examples

```bash
# AI/ML internships in Islamabad
bun run .agents/skills/rozee-search/cli/src/cli.ts search -q "Machine Learning Intern" -l Islamabad --limit 10 --format table

# Junior data analyst roles across Pakistan
bun run .agents/skills/rozee-search/cli/src/cli.ts search -q "Junior Data Analyst" --format table

# Machine learning roles in Karachi
bun run .agents/skills/rozee-search/cli/src/cli.ts search -q "Machine Learning" -l Karachi --format table

# Read a listing returned by search
bun run .agents/skills/rozee-search/cli/src/cli.ts detail "machine-learning-intern-islamabad-jobs-123456" --format plain
```

## Output formats

| Format | Use |
|--------|-----|
| `json` | Default; machine-readable `{ meta, results }` response |
| `table` | Quick human-readable scan |
| `plain` | Read one listing's description |

Errors are written to stderr as JSON and exit with code `1`.

## Notes

- Search locations are matched to Rozee city IDs. Omit `--location` for a
  country-wide search; unsupported city names produce a clear error.
- Search dates are supplied as shown by Rozee; the portal may return older
  postings because no recency filter is exposed.
- See `url-reference.md` for the observed routes, payload fields, and access
  notes.

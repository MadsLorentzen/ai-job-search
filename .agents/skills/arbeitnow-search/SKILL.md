---
name: arbeitnow-search
version: 1.0.0
description: >
  Use this skill when the user wants to search tech, startup, or English-speaking
  jobs in Germany, remote jobs in Germany, or jobs with visa sponsorship — via the
  free Arbeitnow job board API. Good complement to arbeitsagentur-search: Arbeitnow
  skews towards IT/startup/international roles, while the Arbeitsagentur covers the
  whole market. Trigger phrases include: arbeitnow, english speaking jobs germany,
  jobs with visa sponsorship germany, remote jobs germany, startup jobs berlin,
  tech jobs germany, developer jobs germany english, IT jobs für englischsprachige,
  remote stelle deutschland, homeoffice job tech, international jobs germany.
context: fork
allowed-tools: Bash(bun run .agents/skills/arbeitnow-search/cli/src/cli.ts *)
---

# Arbeitnow Search Skill

Search job listings from the free Arbeitnow job board API — **no API key, no
registration, zero runtime dependencies**. Focus: jobs in Germany with a
tech/startup/English-speaking slant, including remote and visa-sponsorship
friendly roles.

> **Important:** the API ignores server-side filter parameters, so this CLI fetches
> pages (100 jobs each, newest first) and filters **client-side**. Use `--pages` to
> control how deep it searches (default 3 = 300 jobs).

## When to use this skill

- Search tech/startup/English-speaking jobs in Germany by keyword
- Find remote or hybrid roles in the German market
- Complement an `arbeitsagentur-search` run with startup/international postings
- Get the full description of a specific Arbeitnow posting

## Commands

### Search job listings

```bash
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q` — keyword filter, matched case-insensitively against title, tags, company, and description (client-side)
- `--location <text>` / `-l` — filter by location substring (e.g. `Berlin`, `Munich`)
- `--remote` — only remote jobs; `--onsite` — only non-remote jobs
- `--jobage <days>` — only jobs posted within the last N days (client-side, from `created_at`)
- `--pages <n>` — how many API pages to scan (100 jobs/page, default 3, max 10)
- `--page <n>` — 1-indexed start page (default 1)
- `--limit <n>` — cap results the CLI outputs
- `--format json|table|plain` (default `json`)

### Fetch full job detail

```bash
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts detail <slug|url> [--format json|plain]
```

`slug` is the `id` from search results (e.g. `senior-developer-berlin-123456`); a full
`arbeitnow.com/jobs/...` URL also works. Scans up to 10 pages for the slug and returns
the full description (HTML stripped in `plain`).

---

## How to use effectively

**Search German AND English terms.** Listings are mixed-language — try
`-q entwickler` as well as `-q developer`.

**Increase `--pages` for rare keywords.** The default scans 300 recent jobs;
`--pages 10` scans 1000.

**Run `detail` soon after `search`.** Detail scans for the slug in the same list,
so very old postings may have rotated out.

---

## Usage examples

### Remote developer jobs

```bash
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search \
  -q developer --remote --format table
```

### Python jobs in Berlin, last 14 days

```bash
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search \
  -q python -l Berlin --jobage 14 --format table
```

### Marketing roles, deep scan

```bash
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search \
  -q marketing --pages 10 --limit 20 --format table
```

### Full details for a posting

```bash
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts detail senior-developer-berlin-123456 --format plain
```

---

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing slugs to `detail` |
| `table` | Quick human-readable overview |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the
process exits with code `1`.

---

## Notes

- Free public API (`arbeitnow.com/api/job-board-api`), no key. The API asks not to
  be abused — the CLI caps page scans at 10 and retries politely.
- Server-side `search`/`remote` params are silently ignored by the API — everything
  is filtered client-side (see `url-reference.md`).
- `date` in results is derived from the unix `created_at` timestamp.
- `meta.count` in JSON output is the number of matches found in the scanned pages,
  not a global total (the API does not expose one for a filtered view).

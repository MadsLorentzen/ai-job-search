---
name: arbeitsagentur-search
version: 1.0.0
description: >
  Make sure to use this skill whenever the user wants to search for jobs in Germany,
  find German job listings, look up a specific job posting, or asks anything about
  the German job market — even if they don't mention arbeitsagentur.de explicitly.
  This skill covers the official German government job portal operated by the
  Bundesagentur für Arbeit (Federal Employment Agency), Germany's largest job board
  including private-sector postings, apprenticeships (Ausbildung), and internships.
  Trigger phrases include: arbeitsagentur, jobbörse, jobsuche, stellenangebote,
  stellenanzeigen, job in deutschland, arbeit finden, stellensuche, jobs berlin,
  jobs münchen, jobs hamburg, jobs köln, jobs stuttgart, softwareentwickler job,
  webentwickler stelle, ausbildungsplatz, ausbildung finden, praktikum finden,
  german jobs, jobs in germany, job search germany, work in germany, hiring germany,
  vacancies germany, developer jobs berlin, IT jobs germany, ingenieur stelle,
  handwerker job, teilzeit job, vollzeit stelle, homeoffice job deutschland.
context: fork
allowed-tools: Bash(bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts *)
---

# Arbeitsagentur Search Skill

Search live German job listings from the official Bundesagentur für Arbeit Jobsuche
API. No authentication beyond a static public API key (built in), **zero runtime
dependencies**. Germany's largest job portal: several hundred thousand active
postings across all sectors, including apprenticeships and internships.

## When to use this skill

Invoke this skill when the user wants to:

- Search for job openings in Germany by keyword, job title, or technology
- Filter by city/postal code with a km radius, posting age, full/part time,
  home office, permanent/temporary contracts
- Find apprenticeships (Ausbildung) or internships (Praktikum)
- Get the full description of a specific posting
- Explore the German job market for a profession or skill set

## Commands

### Search job listings

```bash
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q` — keyword search (job title, skill, profession)
- `--location <text>` / `-l` — city, postal code, or region (e.g. `Berlin`, `70173`)
- `--radius <km>` — radius around `--location` (API default: 25)
- `--jobage <days>` — posting age in days, 0–100 (e.g. `1`, `7`, `14`, `30`)
- `--worktime <type>` — `vz` (full-time), `tz` (part-time), `snw` (shift/night/weekend), `ho` (home office), `mj` (minijob); combine with `;` e.g. `"vz;ho"`
- `--contract <type>` — `1` (temporary/befristet) or `2` (permanent/unbefristet)
- `--offertype <type>` — `1` job (default), `4` apprenticeship (Ausbildung/duales Studium), `34` internship/trainee
- `--employer <text>` — filter by employer name
- `--no-tempwork` — exclude temp-agency (Zeitarbeit) postings
- `--page <n>` — page number (1-indexed)
- `--size <n>` — results per page (default 20, max 100)
- `--limit <n>` — cap results the CLI outputs (client-side)
- `--format json|table|plain` (default `json`)

### Fetch full job detail

```bash
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts detail <refnr|url> [--format json|plain]
```

`refnr` is the ID from `search` results (e.g. `12016-10004847581-S`). A full
`arbeitsagentur.de/jobsuche/jobdetail/...` URL also works. Returns the full
description, employer, locations, start date, salary info (if given), and contract type.

---

## How to use effectively

**Natural workflow: `search` → `detail`.** Search first, then fetch details for
promising `id`s.

**Always pass `--location` for German results.** Without it, the API also returns
Austrian (AMS) postings for German-language queries.

**Use `--jobage 7` or `--jobage 1` for fresh listings.** Otherwise all active
postings are returned.

**Exclude recruiter noise** with `--no-tempwork` — Zeitarbeit/staffing agencies
post high volumes; filtering them improves signal for direct positions.

**Use `--format table` for scanning**, `json` for processing, `plain` for reading.

---

## Usage examples

### Python jobs in Berlin, last 7 days

```bash
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts search \
  -q python -l Berlin --jobage 7 --format table
```

### Full-stack developer near Stuttgart, 50 km, no temp agencies

```bash
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts search \
  -q "full stack entwickler" -l Stuttgart --radius 50 --no-tempwork --format table
```

### Permanent full-time or home-office positions

```bash
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts search \
  -q "devops" -l München --worktime "vz;ho" --contract 2 --format table
```

### Apprenticeships (Ausbildung) in Hamburg

```bash
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts search \
  -q mechatroniker -l Hamburg --offertype 4 --format table
```

### Full details for a posting

```bash
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts detail 12016-10004847581-S --format plain
```

---

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable overview and scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the
process exits with code `1`.

---

## Notes

- Data source: official public API (`rest.arbeitsagentur.de`), documented at
  https://jobsuche.api.bund.dev/ — static API key, no registration, no ToS concerns
  for personal use.
- Job IDs (`refnr`) are strings like `12016-10004847581-S`; the detail endpoint
  requires them base64-encoded — the CLI handles this automatically.
- The detail endpoint is **v3** — v1/v2 return 403 (see `url-reference.md`).
- Postings with `externalUrl` are hosted on external boards; their `detail` data
  can be thinner. The `externalUrl` is included in search results.
- Human-facing URL per job: `https://www.arbeitsagentur.de/jobsuche/jobdetail/{refnr}`

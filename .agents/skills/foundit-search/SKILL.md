---
name: foundit-search
version: 1.0.0
description: >
  Read a specific job posting from Foundit (formerly Monster India,
  foundit.in) — a portal strong in IT and corporate roles across India.
  DETAIL-ONLY: fetches a single posting's full description from a Foundit job
  URL or id. It CANNOT search/list jobs (Foundit's search is bot-blocked and
  robots-disallowed) — find postings elsewhere and pass the URL here. Trigger
  phrases: open this Foundit job, foundit.in posting, Monster India job, "get
  the details of this foundit job", "read this foundit.in listing", नौकरी विवरण.
context: fork
allowed-tools: Bash(bun run skills/foundit-search/cli/src/cli.ts *)
---

# Foundit Search Skill (detail-only)

Read a single job posting from **Foundit** (formerly **Monster India**,
`foundit.in`) — a job board strong in **IT and corporate roles across India**.
Runs with just `bun` and **zero runtime dependencies**.

> Market: India, English (postings are in English). This is a worked instance of
> the repo's job-portal-skill pattern, restricted to the `detail` command.

## ⚠️ Detail-only — this skill cannot search Foundit

Foundit has **no robots-allowed, bot-accessible search surface**:

- Its keyword/location **search API** is under `/middleware/`, which
  `robots.txt` **disallows**.
- Its HTML **`/search/…` pages** return **HTTP 403** to any non-browser client
  (Akamai bot protection) and embed no job data server-side.

So `search` is intentionally not implemented — it exits `1` with a JSON error.
Only **individual job pages** (`/job/<slug>-<id>`) are robots-allowed and
server-render a complete schema.org `JobPosting`, which is what `detail` reads.

**To find Foundit postings:** search LinkedIn, or Google with
`site:foundit.in <role> <city>`, then pass the resulting job URL (or its numeric
id) to `detail`.

## When to use this skill

- The user has a Foundit / Monster India job **URL or id** and wants the full
  description, company, location, required experience, skills, or deadline.
- Do **not** use it to list or discover jobs — use `linkedin-search` (or another
  portal skill) for that, then bring the Foundit URL here.

## Commands

### Read a job posting

```bash
bun run skills/foundit-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

- `<id|url>` — **required.** A numeric Foundit job id (e.g. `57203413`) or a full
  `https://www.foundit.in/job/<slug>-<id>` URL.
- `--format json|plain` — default `json`. Use `plain` to read the description.

### Search (unsupported)

```bash
bun run skills/foundit-search/cli/src/cli.ts search ...
# -> stderr: {"error":"Foundit search is not supported ...","code":"SEARCH_UNSUPPORTED"}, exit 1
```

## Usage examples

```bash
# Full details of a Foundit posting, human-readable
bun run skills/foundit-search/cli/src/cli.ts detail 57203413 --format plain

# From a full URL (e.g. one found via Google site:foundit.in "data analyst" Mumbai)
bun run skills/foundit-search/cli/src/cli.ts detail "https://www.foundit.in/job/software-development-specialist-ntt-data-pune-57203413"

# JSON for programmatic use
bun run skills/foundit-search/cli/src/cli.ts detail 57203413
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — one JobPosting object (id, title, company, location, date, url, description, employmentType, deadline, experienceMonths, category, industry, skills, applyUrl) |
| `plain` | Reading a single job's full description |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and
the process exits with code `1` (`BAD_ID`, `NO_ID`, `NOT_FOUND`,
`SEARCH_UNSUPPORTED`, `DETAIL_FAILED`).

## Notes

- **Data source:** the schema.org `JobPosting` JSON-LD embedded in the
  robots-allowed `/job/<slug>-<id>` page. The bare `/job/<id>` form works too.
- **Dates** are `DD-MM-YYYY` (e.g. `27-06-2026`); `deadline` is `validThrough`.
- **`experienceMonths`** comes from `experienceRequirements.monthsOfExperience`.
- A bogus/expired id returns HTTP 404 → `NOT_FOUND` (exit 1), not a crash.
- Foundit may rate-limit; the CLI retries 429/5xx with exponential backoff. Keep
  volume low.
- See `url-reference.md` for the full endpoint/field documentation and the
  investigation that established the detail-only limitation.

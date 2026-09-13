# jobindex-cli

CLI for searching jobs on [Jobindex.dk](https://www.jobindex.dk).

**Base URL**: `https://www.jobindex.dk/`
**Authentication**: None required.
**Format**: The API returns JSON with embedded HTML blobs. The CLI parses the HTML internally and emits clean JSON.

---

## Installation

```bash
cd skills/jobindex-search/cli
bun install
```

---

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings |
| `detail` | Fetch full detail for a single job listing |

All commands accept `--format json|table|plain` (default: `json`).
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

---

## `search` — Search for job listings

**Endpoint**: `GET https://www.jobindex.dk/jobsoegning.json`

```bash
bun run src/cli.ts search [flags]
```

The API always returns 20 results per page (fixed — no `--per-page` flag). The CLI parses the `result_list_box_html` HTML blob from the response to extract structured job records.

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--query` / `-q` | string | — | Keyword search query (e.g. `python`, `grafisk designer`) |
| `--page` | number | `1` | Page number (1-indexed) |
| `--jobage` | number | `9999` | Max age of posting in days: `1`, `7`, `14`, `30`, or `9999` (all) |
| `--sort` | string | `score` | Sort order: `score` (relevance) or `date` (newest first) |
| `--limit` | number | — | Cap total results returned by the CLI (client-side) |
| `--format` | string | `json` | Output format: `json`, `table`, `plain` |

### Sort options

| Value | Description |
|-------|-------------|
| `score` | Relevance / best match (default) |
| `date` | Newest postings first |

### jobage options

| Value | Description |
|-------|-------------|
| `1` | Posted today |
| `7` | Last 7 days |
| `14` | Last 14 days |
| `30` | Last 30 days |
| `9999` | All time (default) |

### Example

```bash
# Search for Python jobs posted in the last 7 days, sorted by date
bun run src/cli.ts search --query python --jobage 7 --sort date

# Search for "grafisk designer" jobs — show first 5 results
bun run src/cli.ts search --query "grafisk designer" --limit 5

# Page 2 of results for data engineer
bun run src/cli.ts search --query "data engineer" --page 2 --format table
```

### Response shape

```json
{
  "meta": {
    "total": 237,
    "page": 1,
    "perPage": 20
  },
  "results": [
    {
      "id": "h1647303",
      "title": "Data Engineer til opbygning af Gavefabrikkens dataplatform",
      "company": "Gavefabrikken",
      "companyUrl": "https://www.gavefabrikken.dk/",
      "location": "Valby",
      "date": "2026-03-12",
      "url": "https://www.jobindex.dk/jobannonce/h1647303/data-engineer-til-opbygning-af-gavefabrikkens-dataplatform",
      "description": "Vi søger en dygtig Data Engineer til at opbygge og vedligeholde vores dataplatform..."
    }
  ]
}
```

**Field notes:**
- `id` — string ID prefixed with `h` (e.g. `h1647303`). Use this with the `detail` command.
- `company` — company name; may be `null` for some aggregated listings.
- `companyUrl` — company homepage URL; may be `null` if not present.
- `location` — city or area; may be `null` if not listed.
- `date` — ISO date string (`YYYY-MM-DD`) from the `datetime` attribute on the `<time>` element; may be `null`.
- `description` — short excerpt from the listing; may be `null` or empty.
- `url` — full Jobindex.dk URL for the listing.
- `total` in `meta` — parsed from `hitcount_html` (Danish thousands separator `.` is stripped before parsing, e.g. `18.903` → `18903`).

> **Note on area filtering**: The Jobindex API does not reliably support area/region filtering via query parameters. `area` and `geoareaid` params are silently ignored. To filter by location, use `--query` with a city name (e.g. `--query "python aarhus"`) or apply `--limit` and filter the JSON output externally.

---

## `detail` — Fetch full job listing detail

**URL**: `https://www.jobindex.dk/jobannonce/{id}/{slug}`

```bash
bun run src/cli.ts detail <id> [--format json|plain]
```

The `id` is the job ID from `search` results (e.g. `h1647303`). The slug is optional — the CLI fetches the canonical URL by first constructing `https://www.jobindex.dk/jobannonce/{id}` and following any redirect, or by using the full URL from the `url` field in `search` results.

You may also pass the full URL directly as the `id` argument.

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--format` | string | `json` | Output format: `json`, `plain` |

### Example

```bash
# Using ID from search results
bun run src/cli.ts detail h1647303

# Using full URL
bun run src/cli.ts detail "https://www.jobindex.dk/jobannonce/h1647303/data-engineer-til-opbygning-af-gavefabrikkens-dataplatform"

# Plain text output
bun run src/cli.ts detail h1647303 --format plain
```

### Response shape

```json
{
  "id": "h1647303",
  "title": "Data Engineer til opbygning af Gavefabrikkens dataplatform",
  "company": "Gavefabrikken",
  "companyUrl": "https://www.gavefabrikken.dk/",
  "location": "Valby, København",
  "date": "2026-03-12",
  "deadline": "2026-04-01",
  "employmentType": "Fastansættelse",
  "hours": "Fuldtid",
  "applyUrl": "https://www.gavefabrikken.dk/jobs/apply/123",
  "url": "https://www.jobindex.dk/jobannonce/h1647303/data-engineer-til-opbygning-af-gavefabrikkens-dataplatform",
  "description": "Full job description text here..."
}
```

**Field notes:**

Jobindex serves detail pages in two shapes, and field availability differs:
a **jobindex-native** page (recognisable by its `jd-*` facts blocks) carries
company, location, an ISO deadline, employment type and hours; an **external
ATS passthrough** (the employer's hosted ad, e.g. hr-manager/Talentech, served
through jobindex) has no reliable company anchor, so `company` is `null` there
rather than the ATS brand, and location/deadline come from the ad's own
widgets when present.

- `id` / `url` — always the jobindex id and its `jobannonce` URL, never the
  page's `og:url`/canonical (on passthrough pages those point at the external
  ATS, not the posting).
- `deadline` — `YYYY-MM-DD` or `null`; Danish long dates ("13. september
  2026") and `DD-MM-YYYY` widget dates are converted.
- `employmentType` / `hours` — from the native facts blocks; `null` on
  passthrough pages.
- `companyUrl` — currently always `null`; no page shape carries a usable
  company link.
- `applyUrl` — the Jobindex redirect link (`/c?t=...`) when present; `null`
  otherwise.
- `description` — plain text of the ad body (HTML stripped), falling back to
  the page's meta description when the body is empty.
- All fields except `id`, `title`, and `url` may be `null`.

---

## Error handling

All errors are written to **stderr** in JSON format and exit with code `1`:

```json
{ "error": "Job not found", "code": "NOT_FOUND" }
{ "error": "API request failed: 500 Internal Server Error", "code": "API_ERROR" }
{ "error": "Failed to parse job listing HTML", "code": "PARSE_ERROR" }
{ "error": "--query is required", "code": "MISSING_REQUIRED" }
```

---

## URL construction

Job detail pages on jobindex.dk:
- `https://www.jobindex.dk/jobannonce/{id}/{slug}`

The slug is part of the `url` returned by `search`. When calling `detail` with just an ID, the CLI fetches `https://www.jobindex.dk/jobannonce/{id}` which redirects to the full URL.

---

## Parsing notes

### Total count from `hitcount_html`

The API returns pagination info as an HTML string like:

```html
<div class="jix_pagination_total"><strong>1</strong> til <strong>20</strong> af <strong>18.903</strong> resultater.</div>
```

Parse total with: `/af <strong>([\d.]+)<\/strong>/` and strip `.` before converting to integer.

### Job card selectors

Each job card is wrapped in `[data-beacon-tid]`. Inside, select:

| Field | Selector |
|-------|----------|
| `id` | `[data-beacon-tid]` attribute value |
| `title` | `h4 > a` text content |
| `url` | `h4 > a[href]` |
| `company` | `.jix-toolbar-top__company a` text |
| `companyUrl` | `.jix-toolbar-top__company a[href]` |
| `location` | `span.jix_robotjob--area` text |
| `date` | `time[datetime]` attribute value |
| `description` | `p` text content (first `<p>` in card) |

Two card types exist: `div.PaidJob` (sponsored) and `div.jix_robotjob` (aggregated). Both use the same selector pattern.

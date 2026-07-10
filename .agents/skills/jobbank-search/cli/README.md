# jobbank-cli

CLI for [Akademikernes Jobbank](https://jobbank.dk) — Denmark's job portal for highly educated candidates.

**Data sources:**
- **RSS feed**: `https://jobbank.dk/job/rss?{params}` — 100 items max, all search filters work
- **Job detail**: `https://jobbank.dk/job/{id}/` — JSON-LD (`Schema.org JobPosting`) embedded in page HTML

**Authentication**: None required. A browser User-Agent header is sent, but Jobbank may still block automated requests with Cloudflare bot protection. In that case the CLI exits with a clear error and callers should use a WebSearch fallback rather than retrying.
**Format**: RSS XML (search), HTML with embedded JSON-LD (detail).

---

## Installation

```bash
cd skills/jobbank-search/cli
bun install
```

---

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search job listings via RSS feed |
| `detail` | Full detail for a single job posting |

All commands accept `--format json|table|plain` (default: `json`).
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

---

## Filter Reference Tables

### Job Types (`--type` / `cvtype`)

| Code | Label |
|------|-------|
| 3 | Fuldtidsjob |
| 6 | Graduate/trainee |
| 13 | Deltidsjob |
| 8 | Vikariat |
| 12 | Ph.d. & Postdoc |
| 11 | Freelance |
| 15 | Iværksætterprojekt |
| 14 | Event |
| 9 | Praktikplads |
| 4 | Studiejob |
| 5 | Studieprojekt/speciale |

### Location / Region (`--location` / `amt`)

| Code | Label |
|------|-------|
| 2 | Storkøbenhavn |
| 3 | Nordsjælland |
| 14 | Østsjælland |
| 4 | Vestsjælland |
| 5 | Sydsjælland & Øer |
| 13 | Fyn |
| 12 | Sønderjylland |
| 11 | Sydvestjylland |
| 9 | Vestjylland |
| 10 | Sydøstjylland |
| 7 | Midtjylland |
| 8 | Østjylland (Aarhus) |
| 6 | Nordjylland |
| 20 | Bornholm |
| 21 | Øresundsregionen |
| 22 | Grønland & Færøerne |
| 23 | Udlandet (Sverige) |
| 24 | Udlandet (Norge) |
| 19 | Udlandet (øvrige) |

### Work Area / Function (`--work-area` / `erf`)

| Code | Label |
|------|-------|
| 20 | Administration |
| 38 | Arkitektur & Design |
| 22 | Bank & Forsikring |
| 43 | Data & Analyse |
| 47 | Eksport |
| 41 | Forskning & Udvikling |
| 28 | Human Resources |
| 49 | Indkøb |
| 34 | Internet & Multimedia |
| 32 | IT - Hardware |
| 33 | IT - Netværk & Telekomm. |
| 31 | IT - Software |
| 24 | Jura |
| 35 | Kommunikation, Media & SoMe |
| 46 | Konstruktion & Beregning |
| 37 | Kunst & Kultur |
| 26 | Ledelse & Planlægning |
| 29 | Marketing & Reklame |
| 40 | Medicinal & Sundhed |
| 45 | Naturvidenskab |
| 23 | Organisation & Forening |
| 52 | Politik & Samfund |
| 44 | Produktion |
| 27 | Projektledelse |
| 50 | Rådgivning & Support |
| 30 | Salg |
| 39 | Socialvæsen |
| 42 | Teknik |
| 25 | Topledelse |
| 48 | Transport & Logistik |
| 36 | Undervisning |
| 21 | Økonomi & Forvaltning |

### Education Field (`--education` / `udd`)

| Code | Label |
|------|-------|
| 20 | Administration |
| 43 | Anlæg, Byggeri & Konstruktion |
| 29 | Arkitektur, Kunst & Design |
| 47 | Elektro & Telekommunikation |
| 32 | Fødevarer & Veterinær |
| 38 | Human Resources |
| 28 | Humaniora |
| 24 | IT |
| 23 | Jura |
| 44 | Kemi, Biotek & Materialer |
| 45 | Klima, Miljø & Energi |
| 37 | Landbrug & Natur |
| 22 | Marketing & Business |
| 48 | Maskin & Design |
| 46 | Matematik, Fysik & Nano |
| 31 | Medicinal & Sundhed |
| 30 | Naturvidenskab |
| 41 | Organisation & Ledelse |
| 35 | Produktion, Logistik & Transport |
| 34 | Samfundsvidenskab |
| 25 | Sprog, Media & Kommunikation |
| 33 | Teknik & Teknologi |
| 26 | Undervisning & Pædagogik |
| 21 | Økonomi & Revision |

### Industry (`--industry` / `branche`)

| Code | Label |
|------|-------|
| 10359 | Advokat & Revision |
| 11669 | Byggeri & Anlæg |
| 11634 | Elektronik & Maskin |
| 16791 | Fagforeninger, A-kasser & Pensionskasser |
| 10358 | Finans, Forsikring & Pension |
| 10442 | Forskning & Uddannelse |
| 15407 | Fødevarer & Dagligvarer |
| 10364 | Handel & Service |
| 10331 | IT & Tele |
| 17209 | Klima, Energi & Forsyning |
| 16826 | Kommuner |
| 10341 | Kultur, Medier & Underholdning |
| 10333 | Medicinal, Biotek & Kemi |
| 10363 | Papir, Møbel & Materialer |
| 11626 | Regioner, Sundhed- & Socialvæsen |
| 15586 | Rådgivning & Konsulentservice |
| 10362 | Stat, Politik & Samfund |
| 10440 | Transport |
| 12450 | Vikar & Rekruttering |

### Remote Work (`--remote` / `fjernarbejde`)

| Value | Label |
|-------|-------|
| `helt` | Fully remote |
| `delvist` | Partially remote |

### Suitable For (`--suitable-for` / `andet`)

| Code | Label |
|------|-------|
| 2 | Nyuddannede |
| 4 | International baggrund |
| 5 | Erfarne |

---

## `search` — Search job listings

**Endpoint**: `GET https://jobbank.dk/job/rss?{params}`

```bash
bun run src/cli.ts search [flags]
```

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--key` | string | — | Keyword search (title, company, keyword) |
| `--exclude` | string | — | Exclude keywords (`antikey`) |
| `--type` | number | — | Job type code (`cvtype`). Repeatable for multiple: `--type 3 --type 6` |
| `--education` | number | — | Education field code (`udd`). Repeatable. |
| `--location` | number | — | Region code (`amt`). Repeatable. |
| `--work-area` | number | — | Work area / function code (`erf`). Repeatable. |
| `--industry` | number | — | Industry code (`branche`). Repeatable. |
| `--suitable-for` | number | — | Suitable-for code (`andet`). Repeatable. |
| `--company` | number | — | Company ID (`virk`) |
| `--remote` | string | — | Remote work: `helt` or `delvist` |
| `--since` | string | — | Posted on or after date, format `YYYY-MM-DD` (`oprettet`) |
| `--limit` | number | — | Cap total results returned by CLI (client-side) |
| `--format` | string | `json` | Output format: `json`, `table`, `plain` |

> **Important limitation:** The RSS feed returns a maximum of **100 items** per request. There is no pagination via RSS — the `page=` parameter has no effect on the RSS endpoint. If your query matches more than 100 jobs, only the first 100 are returned. The `meta.total` field reflects the true total count (fetched separately from the HTML search page title), while `results` is capped at 100.

> **Multi-value flags**: Flags marked "Repeatable" map to params that accept multiple values in the API (repeated query params). Pass them multiple times: `--type 3 --type 6` sends `cvtype=3&cvtype=6`.

### RSS Parsing

The CLI fetches the RSS feed and parses each `<item>` as follows:

- **id**: extracted from the URL path — `/job/{id}/{company-slug}/{title-slug}` — the first numeric segment after `/job/`
- **title**: from `<title>` (CDATA)
- **description**, **company**, **location**, **jobType**, **deadline**: parsed from the `<description>` field, which has the format: `"JobType hos Company, Location (Ansøgningsfrist: DD.MM.YYYY)"` or `"JobType hos Company, Location (Ansøgningsfrist: løbende)"`
- **url**: from `<link>`
- **posted**: from `<pubDate>`, normalized to ISO 8601

### Example

```bash
bun run src/cli.ts search --key python --location 2 --type 3 --limit 10
bun run src/cli.ts search --key "data scientist" --remote helt
bun run src/cli.ts search --industry 10331 --work-area 31 --format table
bun run src/cli.ts search --education 24 --suitable-for 2 --since 2026-03-01
```

### Response shape

```json
{
  "meta": {
    "total": 457
  },
  "results": [
    {
      "id": "1234567",
      "title": "Senior Data Scientist",
      "company": "Novo Nordisk",
      "location": "Bagsværd",
      "jobType": "Fuldtidsjob",
      "description": "Fuldtidsjob hos Novo Nordisk, Bagsværd (Ansøgningsfrist: 12.04.2026)",
      "url": "https://jobbank.dk/job/1234567/novo-nordisk/senior-data-scientist",
      "posted": "2026-03-02T00:00:00+01:00",
      "deadline": "2026-04-12"
    }
  ]
}
```

#### Field details

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Numeric job ID extracted from URL |
| `title` | string | Job title |
| `company` | string | Company name, parsed from description |
| `location` | string | Location string, parsed from description |
| `jobType` | string | Employment type (e.g. "Fuldtidsjob", "Graduate/trainee"), parsed from description |
| `description` | string | Raw RSS description field (single-line summary) |
| `url` | string | Full URL to job posting |
| `posted` | string | Publication date in ISO 8601 |
| `deadline` | string \| null | Application deadline as `DD.MM.YYYY` string, or `null` if "løbende" / not present |

> `meta.total` is fetched from the HTML page `<title>` in a secondary request (pattern: `"{N} relevante job og karriereopslag"`). If the secondary request fails, `meta.total` is `null`.

---

## `detail` — Full job detail

**Endpoint**: `GET https://jobbank.dk/job/{id}/`

```bash
bun run src/cli.ts detail <id> [--format json|plain]
```

The `id` is the numeric job ID from `search` results (the `id` field). The short URL `https://jobbank.dk/job/{id}/` redirects to the full slug URL and returns HTTP 200.

The CLI fetches the HTML page and extracts the `<script type="application/ld+json">` block containing a Schema.org `JobPosting` object.

### Example

```bash
bun run src/cli.ts detail 1234567
bun run src/cli.ts detail 1234567 --format plain
```

### Response shape

```json
{
  "id": "1234567",
  "url": "https://jobbank.dk/job/1234567/",
  "title": "Senior Data Scientist",
  "description": "<p>Full HTML description of the role...</p>",
  "datePosted": "2026-03-02",
  "deadline": "2026-04-12",
  "employmentType": ["FULL_TIME"],
  "company": {
    "name": "Novo Nordisk",
    "logo": "https://jobbank.dk/images/dynamic/company/logo/12345/"
  },
  "location": {
    "streetAddress": "",
    "city": "Bagsværd",
    "postalCode": "",
    "country": "DK"
  }
}
```

#### Field details

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Numeric job ID (from `identifier.value` in JSON-LD) |
| `url` | string | Canonical URL of the job posting |
| `title` | string | Job title |
| `description` | string | Full HTML job description body |
| `datePosted` | string | Publication date in ISO 8601 format (`YYYY-MM-DD`) |
| `deadline` | string \| null | Application deadline (`validThrough` in JSON-LD), ISO 8601, or `null` if absent |
| `employmentType` | string[] | Schema.org employment type values, e.g. `["FULL_TIME"]` |
| `company.name` | string | Hiring organization name |
| `company.logo` | string \| null | URL to company logo, or `null` if absent |
| `location.streetAddress` | string | Street address (may be empty) |
| `location.city` | string | City (may be empty for international jobs) |
| `location.postalCode` | string | Postal code (may be empty) |
| `location.country` | string | Country code (may be empty) |

> `location` fields may be empty strings for international jobs or postings that do not specify a physical location.

---

## Error handling

All errors are written to **stderr** in JSON format and exit with code `1`:

```json
{ "error": "Job not found", "code": "NOT_FOUND" }
{ "error": "Jobbank is blocking automated requests with Cloudflare bot protection. Skip this portal or use the WebSearch fallback.", "code": "API_ERROR" }
{ "error": "No JSON-LD found on job page", "code": "PARSE_ERROR" }
{ "error": "--key or at least one filter is required", "code": "MISSING_REQUIRED" }
```

---

## Implementation notes

### User-Agent

All HTTP requests include a browser User-Agent header:

```
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
```

This is not guaranteed to bypass Cloudflare bot protection. If Jobbank returns a Cloudflare challenge page, the CLI reports that condition and callers should skip the portal or use a WebSearch fallback.

### RSS description parsing

The RSS `<description>` field follows this pattern:

```
Fuldtidsjob, Graduate/trainee hos Novo Nordisk, Bagsværd (Ansøgningsfrist: 12.04.2026)
Fuldtidsjob hos DTU, Lyngby (Ansøgningsfrist: løbende)
```

Parse strategy:
1. Split on ` hos ` — left side is job type(s), right side is `Company, Location (Ansøgningsfrist: Deadline)`
2. From the right side, extract the parenthetical `(Ansøgningsfrist: ...)` for deadline
3. Remaining text is `Company, Location` — split on first `, ` to separate company from location

### JSON-LD extraction

On detail pages, find `<script type="application/ld+json">` containing `"@type": "JobPosting"` and parse the JSON. Map fields:

- `identifier.value` → `id`
- `url` → `url`
- `title` → `title`
- `description` → `description` (HTML)
- `datePosted` → `datePosted`
- `validThrough` → `deadline` (may be absent → `null`)
- `employmentType` → `employmentType` (array)
- `hiringOrganization.name` → `company.name`
- `hiringOrganization.logo` → `company.logo`
- `jobLocation.address.streetAddress` → `location.streetAddress`
- `jobLocation.address.addressLocality` → `location.city`
- `jobLocation.address.postalCode` → `location.postalCode`
- `jobLocation.address.addressCountry` → `location.country`

### Rate limiting

No explicit rate limits are enforced, but Cloudflare is present. Add a 300–500ms delay between sequential requests (e.g. when fetching total count from HTML in addition to the RSS feed). The `search` command makes at most 2 requests (RSS + HTML for total count).

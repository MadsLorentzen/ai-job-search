---
name: apna-search
version: 1.0.0
description: >
  Use this skill to search for jobs on apna.co — India's largest blue-collar,
  grey-collar and entry-level job board (delivery, driver, telecaller, sales,
  retail, warehouse, security, data entry, field work, back office, and similar
  roles), strong in tier-2/tier-3 cities. Invoke for job hunts in any Indian city
  (Delhi, Mumbai, Bengaluru, Pune, Hyderabad, Kolkata, Jaipur, Lucknow, etc.) and
  for looking up a specific apna job posting. Trigger phrases: apna jobs, find a
  job in India, naukri, job search India, "delivery jobs in <city>", "driver
  vacancy", telecaller job, "nokri", "kaam", part-time / full-time jobs near me,
  freshers jobs, look up this apna.co posting.
context: fork
allowed-tools: Bash(bun run skills/apna-search/cli/src/cli.ts *)
---

# apna.co Search Skill

Search live job listings from **apna.co**, India's leading job platform for
blue-collar, grey-collar and entry-level roles. No authentication, no API key, and
**zero runtime dependencies** — it runs with just `bun`.

Data comes from apna's public server-rendered listing pages (the full job objects
are embedded in each page's `__NEXT_DATA__` JSON) and schema.org `JobPosting`
detail pages. See `url-reference.md` for the parsing anchors.

## When to use this skill

- Find entry-level / blue-collar / grey-collar jobs in any Indian city (delivery,
  driver, telecaller, field sales, retail, warehouse, cook, security, data entry…)
- Filter by recency (posted within N days) or paginate through results
- Get the full description, salary, and apply info of a specific apna posting

## How search works (important)

apna's free-text keyword search is **app / login-gated and not available on the
public web** — the public site is browsed by *slug* (city, job category,
department, company). This skill bridges that gap: it resolves your `--query` to
apna's nearest **job category or department** from apna's own live catalog, fetches
that category's listings (optionally scoped to your city), and then narrows the
results **client-side** by keyword. So `-q "delivery executive"` maps to apna's
"Delivery Person" category and returns delivery roles. Broad or unusual queries
fall back to city-wide listings filtered by keyword.

## Commands

### Search job listings

```bash
bun run skills/apna-search/cli/src/cli.ts search -q "<role>" [-l "<city>"] [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — role/keyword, e.g. `"delivery executive"`, `"telecaller"`, `"driver"`. Recommended.
- `--location <text>` / `-l <text>` — Indian city, e.g. `"Delhi"`, `"Mumbai"`, `"Bengaluru"`. Optional; omit for all-India.
- At least one of `--query` or `--location` is **required**.
- `--jobage <days>` — keep only postings created within N days (client-side filter on posting date).
- `--page <n>` — page number (1-indexed, 25 results/page).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run skills/apna-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric job id from `search` results (e.g. `276594032`). You may also
pass a full apna `https://apna.co/job/...` URL. Returns title, company, salary,
employment type, category/industry, posting & expiry dates, the full decoded
description (English/Hindi), and the apply link.

## Usage examples

```bash
# Delivery roles in Delhi (the canonical test query)
bun run skills/apna-search/cli/src/cli.ts search -q "delivery executive" -l "Delhi" --format table

# Telecaller / BPO roles in Mumbai, first 10
bun run skills/apna-search/cli/src/cli.ts search -q "telecaller" -l "Mumbai" --limit 10 --format table

# Driver jobs in Bengaluru posted in the last 7 days
bun run skills/apna-search/cli/src/cli.ts search -q "driver" -l "Bengaluru" --jobage 7 --format table

# Data-entry / back-office roles anywhere in India
bun run skills/apna-search/cli/src/cli.ts search -q "data entry" --format table

# Full details for one posting
bun run skills/apna-search/cli/src/cli.ts detail 276594032 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning (id, title, company, location, salary, date) |
| `plain` | Reading a single job's full detail (`detail` command) |

JSON search output is `{ "meta": { "count", "page" }, "results": [...] }`; each
result has `id`, `title`, `company`, `location`, `date`, `url`, `salary`,
`category`, `department`, `employmentType`, `openings`, `workFromHome` (missing
values are `null`). All errors are written to **stderr** as
`{ "error": "...", "code": "..." }` with exit code `1`.

## Notes

- **Slug-based search.** apna has no public keyword search; results reflect the
  best-matching category/department for your query, then a keyword narrowing pass.
  Very specific titles may surface the broader category — refine with `--limit` and
  read titles. See `url-reference.md`.
- **City tokens.** Cities are slugified from `--location` (e.g. `"Delhi"` → `jobs-in-delhi`).
  Use the common city name; apna also accepts NCR-area names under "Delhi".
- **Salary** is India-formatted monthly INR (e.g. `₹50,000 - ₹1,15,000/month`) and
  is often a broad advertised range including incentives.
- **`--jobage`** is applied client-side against each posting's `created_on` date;
  apna's listing order is relevance/recency, not strictly by date.
- **Bilingual descriptions.** Many postings are in Hindi or mixed Hindi/English;
  the `detail` command decodes them to readable text.
- apna may rate-limit; the CLI retries 429/5xx with exponential backoff. Keep volume low.

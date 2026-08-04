# Jobsdb Hong Kong Search CLI

Search live job listings from [Jobsdb Hong Kong](https://hk.jobsdb.com). No
authentication, no API key, and **zero runtime dependencies** — it runs anywhere
`bun` is available.

> This skill follows the repo's job-portal-skill contract: `search` and `detail`
> commands, standard JSON output shape, and errors on stderr as JSON.

## ⚠️ Personal use only

Jobsdb's `robots.txt` disallows `*/job/`, `/api/jobsearch/`, `/graphql`, and most
query-string paths. Automated access is against the site's stated rules, so **keep
volume low and do not use this commercially or for bulk data collection.** Run it
on your own responsibility.

## Commands

```bash
bun run src/cli.ts search -q "<keywords>" [--location "<place>"] [flags]
bun run src/cli.ts detail <id|url> [--format json|plain]
```

### Search flags

- `--query`, `-q <text>` — **required.** Job title, skill, or role (e.g. `"AI engineer"`).
- `--location`, `-l <text>` — Optional location slug (e.g. `"Hong Kong"`, `"Kowloon Bay, Kwun Tong District"`).
- `--jobage <days>` — Max posting age. Maps to `daterange`: `1`, `3`, `7`, `14`, or `31` days.
- `--page <n>` — 1-indexed page number.
- `--limit`, `-n <n>` — Cap results emitted (client-side).
- `--format <fmt>` — `json` (default) | `table` | `plain`.

## Examples

```bash
bun run src/cli.ts search -q "AI engineer" --limit 5 --format table
bun run src/cli.ts search -q "software engineer" -l "Hong Kong" --jobage 7 --format table
bun run src/cli.ts search -q "data analyst" -l "Central, Hong Kong Island" --page 2 --format json
bun run src/cli.ts detail 93714207 --format plain
```

## Output

Search JSON:

```json
{
  "meta": { "count": 5, "page": 1 },
  "results": [
    {
      "id": "93714207",
      "title": "AI Engineer",
      "company": "APJ Software (Hong Kong) Company Limited",
      "location": "Kowloon Bay, Kwun Tong District",
      "date": "Listed one hour ago",
      "url": "https://hk.jobsdb.com/job/93714207?type=standard&ref=search-standalone",
      "employmentType": "Full time"
    }
  ]
}
```

## Notes

- Result pages contain 30 jobs each.
- Location filtering is path-based; pass the location as it appears in the site's URLs.
- The CLI parses the public HTML response; if Jobsdb changes its markup, update the anchors recorded in `../url-reference.md`.

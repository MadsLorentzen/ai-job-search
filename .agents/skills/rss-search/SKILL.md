---
name: rss-search
version: 1.0.0
description: >
  Search RSS and Atom job feeds from company career pages and boards that still
  publish XML. Country-agnostic. Use when the user has a jobs RSS URL, wants to
  follow employer feeds, or mentions RSS/Atom job listings.
  Trigger phrases: rss jobs, atom feed jobs, job feed, company rss.
context: fork
enabled: false  # set true after adding job_scraper/rss_feeds.json or passing --feed
allowed-tools: Bash(bun run .agents/skills/rss-search/cli/src/cli.ts *)
---

# RSS / Atom job feeds

Many employers and some boards still publish RSS or Atom. This skill is the generic catch-all when there is no HTML scraper and no ATS JSON API.

## Commands

```bash
bun run .agents/skills/rss-search/cli/src/cli.ts search --feed "https://example.com/jobs/feed.xml" -q "engineer" --format table
bun run .agents/skills/rss-search/cli/src/cli.ts search --feeds-file job_scraper/rss_feeds.json --jobage 14
bun run .agents/skills/rss-search/cli/src/cli.ts detail "https://example.com/jobs/1" --feed "https://example.com/jobs/feed.xml"
```

`--feeds-file` accepts `{ "feeds": ["https://..."] }` or one URL per line.

Copy `feeds.example.json` to `job_scraper/rss_feeds.json`, then set `enabled: true` in this file.

# Xing Jobs URL Reference

## Access rules (checked live, 2026-09-11)

`https://www.xing.com/robots.txt` has three relevant blocks:

```
User-agent: *
...
Disallow: /search/
Disallow: /jobs/search/
Disallow: /jobs/search?*
...
Disallow: /graphql/
Disallow: /graphql/api
Disallow: /xas/api/

User-agent: GPTBot
User-agent: GPTUser
User-agent: ClaudeBot
User-agent: Claude-User
User-agent: PerplexityBot
User-agent: Perplexity-User
Allow: /jobs/search/
Allow: /jobs/search?*
...
Disallow: /graphql/api
Disallow: /graphql/
```

The named-AI-crawler block carves out `/jobs/search/` specifically, but that page
(`GET https://www.xing.com/jobs/search?keywords=...`, 301→`/jobs/search/ki?...`) is a
client-rendered React SPA — the raw HTML response is only loading skeletons, no job
data. The real search results load client-side via Xing's GraphQL API, which is
`Disallow`'d for **every** user-agent group, AI carve-out included. So the carve-out
doesn't unlock anything usable; there is no way to reach Xing's actual keyword search
without violating `robots.txt`.

**Neither `/jobs/<slug>` (detail pages) nor `/jobs/sitemap.xml.gz` (or its shards)
appear in any `Disallow` rule for `User-agent: *`.** That's the path this skill
uses — it is open to any honest crawler, no AI-specific UA needed. The CLI's
User-Agent is the repo's normal convention (`Mozilla/5.0 (compatible;
xing-search-cli/1.0)`), not an AI-crawler identity.

## Sitemap (used for "search")

```
GET https://www.xing.com/jobs/sitemap.xml.gz
```

Returns a gzipped `<sitemapindex>` of per-category sitemaps. Only the numeric shards
(`https://www.xing.com/jobs/<N>-sitemap.xml.gz`, `N` = 1..13 as of 2026-09) are
individual job-posting URLs; the others (`jobs_roles_sitemap`, `jobs_skills_sitemap`,
`jobs_locations_sitemap`, `jobs_companies_sitemap`, `jobs_employment_types_sitemap`,
etc.) are category/faceting sitemaps, not postings, and the CLI filters them out.

Each shard is a gzipped `<urlset>` of ~50,000 `<url><loc>...</loc><lastmod>...</lastmod></url>`
entries, e.g.:

```
<url><loc>https://www.xing.com/jobs/koeln-ot-cyber-security-senior-consultant-122981029</loc><lastmod>2026-09-09T20:13:03+00:00</lastmod></url>
```

**`<lastmod>` is not the posting date and must never be used as one.** Verified live:
a posting with `<lastmod>2026-09-09...` carried `datePosted: 2024-07-22...` in its own
detail page's JSON-LD — over a year older. `<lastmod>` only reflects when Xing's
sitemap generator last touched the entry.

The trailing digits in the slug (e.g. `122981029`) are a much better recency proxy —
Xing's job IDs are issued roughly sequentially (verified live: two postings ~900k IDs
apart were ~24 days apart in `datePosted`) — but it's still only a sort heuristic for
deciding which candidates to probe first, never a substitute for the real
`datePosted`/`validThrough` on the candidate's own detail page.

~650,000 URLs total across all shards as of 2026-09-11 (13 shards × ~50,000). The CLI
downloads and caches the full set (`cli/.cache/sitemap-cache.json`, gitignored,
~50MB) for 24h, then matches the query as an AND-substring test against each URL's
slug (see `slugify()` in `cli/src/helpers.ts` — lowercase, `äöüß` → `ae/oe/ue/ss`,
everything else → `-`, matching Xing's own transliteration).

## Detail page

```
GET https://www.xing.com/jobs/<slug>-<id>
```

Server-rendered. The response's `<head>` carries exactly one
`<script type="application/ld+json">` block, a `schema.org` `JobPosting`:

```json
{
  "@type": "JobPosting",
  "title": "...",
  "description": "<HTML fragment, entity-escaped>",
  "datePosted": "2024-07-22T21:31:42Z",
  "validThrough": "2025-01-21T12:26:18Z",
  "employmentType": "FULL_TIME",
  "industry": "Beratung, Consulting",
  "hiringOrganization": { "name": "...", "url": "...", "logo": "..." },
  "jobLocation": [{ "address": { "addressLocality": "...", "addressRegion": "...", "addressCountry": "DE" } }]
}
```

The CLI parses this block directly (`extractJobPosting` / `parseJobDetail` in
`cli/src/helpers.ts`) rather than scraping visible markup — it's the same data Xing
serves to search engines, and far more stable than CSS class names.

**A bare numeric ID does not resolve reliably.** Verified live:
`https://www.xing.com/jobs/122981029` (no slug words) returned HTTP 200 with a
**completely different job** than
`https://www.xing.com/jobs/koeln-ot-cyber-security-senior-consultant-122981029`. Always
pass the full slug (or full URL) as returned by `search` — never just the trailing
digits.

A removed/expired-from-index posting returns **HTTP 410** (verified live on a
deliberately bogus slug), not 404. The CLI's `fetchText` treats both as "not found."

## Notes

- No authentication required anywhere in this flow.
- Respect rate limits — the CLI backs off on 429/5xx with the same exponential-backoff-with-jitter convention as the other portal skills.
- If Xing changes its sitemap-index structure, its per-shard count, or the JSON-LD shape, update the regexes/paths above accordingly — this file is the map for that.

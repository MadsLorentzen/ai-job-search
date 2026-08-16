# AIJobs.net URL Reference

Public, unauthenticated, server-rendered pages used by this skill. Global — the same
endpoints serve every market. `robots.txt` allows crawling (only `/account/` disallowed;
no AI/Claude bot named).

> Personal use only — keep volume low; no bulk/commercial scraping.

## Search

```
GET https://aijobs.net/?keyword=<text>&page=<n>
```

Query params actually honored via GET:

| Param | Meaning | Example |
|-------|---------|---------|
| `keyword` | Free-text query (title/skill/role, and loosely location) | `data analyst` · `business intelligence india` |
| `page` | 1-indexed page, ~50 results/page | `1`, `2`, … |

Other filter fields exist in the site's advanced UI (`countries`, `regions`, `cities`,
`remote_option`, `experience_level`, `job_types`, `roles`, `skills`, `salary`, …) but they
are JS-populated multi-selects submitted via a **CSRF-protected POST with a session-bound
`search_context`**, and their values are internal IDs — they are **not** usable as simple
GET params (`remote_option` via GET is ignored). This skill therefore uses only `keyword`
+ `page`, and applies `--remote`/`--jobage` client-side.

Returns an HTML `<ul>` of job cards, one `<li class="d-flex justify-content-between
position-relative …">` per posting. Each card exposes:

- **link/slug** — `href="/job/<slug>-<id>/"` (the slug, incl. trailing numeric id, is the result `id`)
- **title** — bare text inside the job anchor (preceded by optional `Featured`/`Feat.` badge spans)
- **salary** — `<span class="text-bg-success …">USD 68K-88K</span>` (a lone `R` in this class is a remote flag, not salary)
- **level** — `<span class="text-bg-warning …">Mid-level</span>`
- **employment type** — `<span class="text-bg-secondary …">Full Time</span>`
- **skills** — a `<div>` of bare `<span>…</span> | …` tags
- **location** — the inner `<div>` immediately before the muted date div
- **date** — `<div class="text-muted">7d ago</div>` (relative → converted to ISO)

Company is **not** present on search cards (aijobs obscures it on listings).

## Detail

```
GET https://aijobs.net/job/<slug>/
```

`<slug>` is the full slug from search (e.g. `data-analyst-richardson-tx-us-231820`). A bare
numeric id (`https://aijobs.net/job/231820/`) returns **404** — no redirect — so the slug is
required.

Returns a single job's HTML:

- **title** — `<h1 class="font-monospace …">`
- **location** — first `<strong>…</strong>`
- **salary / level / type** — `text-bg-success` (first with a digit) / `text-bg-warning` / `text-bg-secondary`
- **company** — `href="/company/<slug>-<id>/"`; the on-page name is obscured, so the real name is title-cased from the slug
- **apply link** — `<a class="btn btn-primary" href="/job/<hash>/apply/">`
- **date** — `Published 20d ago` / `Found 1h ago` (verb varies; the `<n><unit> ago` token is parsed)
- **description** — structured `<h5>` sections (`Tasks`, `Perks/Benefits`, `Skills/Tech-stack`, `Education`); taxonomy sections (`Roles`, `Regions`, `Countries`, `States`, `Cities`) and empty `N/A` sections are dropped

## Notes

- No authentication required.
- No public JSON API — the "Export JSON" button is a CSRF-protected, session-stateful POST, so this skill parses HTML.
- Respect rate limits — the CLI backs off on 429/5xx and returns `""` on 404.

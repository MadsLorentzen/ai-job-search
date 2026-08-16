# Work at a Startup (workatastartup.com) URL Reference

Public, unauthenticated pages used by this skill. The site is a server-rendered
**Inertia.js** app: every page embeds its full props as a single JSON blob inside a
`data-page="..."` attribute on the root element. The CLI extracts that attribute,
XML-unescapes it (`&quot;`,`&amp;`,`&lt;`,`&gt;`,`&#39;`), and `JSON.parse`s it — no
card-markup scraping.

> Personal use only — keep volume low. `robots.txt` (checked 2026-07-16) has an empty
> `Disallow`, so these paths are not crawler-blocked, but this is a private company's
> board; do not use commercially or in bulk.

## Base

```
https://www.workatastartup.com
```

Browser `User-Agent` **and** an `Accept: text/html…` header are required — without the
Accept header the server returns `406`, and some paths (`/companies`) `302`-redirect
unauthenticated users to `/`.

## Search / listings

```
GET /jobs                     # default listing (Software Engineer category)
GET /jobs/l/<role-slug>       # one role category
```

Valid `<role-slug>` values (from the homepage `roleLinks`):

| Slug | Label |
|------|-------|
| `software-engineer` | Engineering |
| `designer` | Design |
| `product-manager` | Product |
| `operations` | Operations |
| `sales-manager` | Sales |
| `marketing` | Marketing |
| `recruiting` | Recruiting |
| `science` | Science |
| `legal` | Legal |
| `finance` | Finance |

**No supported query params.** `?query=…` and `?page=…` are **ignored** — the server
returns the same fixed category set regardless. There is no free-text search and no
pagination on the public board. Any unknown `/jobs/l/<slug>` returns `404`.

Component: `jobs/public/pages/JobsPage`. Props of interest:

- `props.jobs` — array (~25–30). Each item:

  | Field | Notes |
  |-------|-------|
  | `id` | integer job id → detail URL `/jobs/<id>` |
  | `title` | job title |
  | `jobType` | e.g. `Fulltime` |
  | `location` | free text, e.g. `United States (Remote) / Remote (US)` |
  | `roleType` | e.g. `Backend`, `Full stack`, `Research` (may be `null`) |
  | `salary` | e.g. `$150K - $200K` (often `null`) |
  | `companyName`, `companySlug`, `companyBatch` | company + YC batch (e.g. `S23`) |
  | `companyOneLiner` | company tagline |
  | `companyLogoUrl` | logo |
  | `companyLastActiveAt` | relative string, e.g. `7 days ago` — freshness proxy |
  | `applyUrl` | routes to `account.ycombinator.com` (login required to apply) |

  There is **no posting-date field** — the CLI sets each result's `date` to `null`.

- `props.roleLinks` — the 10 category `{label, path}` entries above.

## Detail

```
GET /jobs/<id>
```

Component: `jobs/public/pages/JobDetailPage`. Props of interest:

- `props.job` — `id`, `title`, `salaryRange`, `equityRange`, `location`, `jobType`,
  `sponsorsVisa`, `minExperience`, `skills[]`, `descriptionHtml`, `interviewProcessHtml`.
- `props.company` — `name`, `slug`, `batch`, `location`, `url`, `teamSize`, `industry`,
  `founders[]`, `description`, …
- `props.applyUrl` — apply link (login required).
- `props.otherJobs` — other roles at the same company.

`descriptionHtml` / `interviewProcessHtml` are HTML fragments; the CLI converts
`<p>`/`<br>`/`<li>` to line breaks, strips remaining tags, and decodes entities.

## Company pages (not used by the CLI, but public)

```
GET /companies/<slug>         # e.g. /companies/onesignal
```

Component: `jobs/public/pages/CompanyPage`; `props.company.jobs[]` holds that
company's open roles. Note: `GET /companies` (the search index) `302`-redirects to
`/` unauthenticated — the company **search** page requires login, individual company
pages do not.

## Other notes

- Search/company **search** requires login; **listing, category, detail, and single
  company pages are public**.
- The homepage also embeds an Algolia search key (`window.AlgoliaOpts`, app
  `45BWZJ1SGC`), but the public key is tag-restricted (`tagFilters=[["none"]]`) and
  returns **zero hits** for job queries — it is not usable for public job search. The
  `data-page` JSON approach above is the reliable public path.
- No authentication required for the endpoints this CLI uses. Respect rate limits —
  the CLI backs off on 429/5xx.

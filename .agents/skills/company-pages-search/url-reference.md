# Company Career Page ATS API Reference

Public, unauthenticated JSON APIs behind the three ATS types this skill integrates
directly. All were verified live against real public boards on 2026-08-01 (see
`company_pages.example.json` for the exact boards used: Stripe/Coinbase = Greenhouse,
Palantir = Lever, Visa = SmartRecruiters).

> Personal use only — these are companies' own public career-page APIs; keep volume low
> and respect each site's terms of use.

## Greenhouse

```
GET https://boards-api.greenhouse.io/v1/boards/<board_token>/jobs
GET https://boards-api.greenhouse.io/v1/boards/<board_token>/jobs?content=true
GET https://boards-api.greenhouse.io/v1/boards/<board_token>/jobs/<job_id>?questions=true
```

- `board_token` is the slug in `boards.greenhouse.io/<board_token>` or the company's
  `job-boards.greenhouse.io/<board_token>` embed URL.
- List endpoint returns `{"jobs": [...]}`; each job has `id`, `title`, `absolute_url`,
  `updated_at`, `location.name`. Add `?content=true` to also get the full HTML job
  description inline (this skill's `search` command does not request it, to keep list
  calls light — use `detail` for the full description).
- **Quirk:** `content` (and the `detail` endpoint's `content` field) is HTML with its own
  entities partially escaped — e.g. `&amp;nbsp;` inside already-HTML-tagged text.
  `stripHtml()` in `src/ats.ts` decodes entities, strips tags, then decodes again to
  handle this.
- Detail endpoint job id is numeric (e.g. `7993151`), taken from a search result's `id`
  field or from the `gh_jid=` query param on `absolute_url`.

## Lever

```
GET https://api.lever.co/v0/postings/<company>?mode=json
GET https://api.lever.co/v0/postings/<company>/<job_id>?mode=json
```

- `company` is the slug in `jobs.lever.co/<company>`.
- List endpoint returns a bare JSON array (not wrapped in an object) of postings, or
  `{"ok": false, "error": "Document not found"}` if the company slug is wrong/inactive —
  this skill treats that as zero results rather than an error.
- Each posting has `id`, `text` (title), `hostedUrl`, `createdAt` (epoch ms),
  `categories.location`, `categories.team`, `categories.commitment`,
  `descriptionPlain`/`description` (HTML).
- **Quirk:** an empty array (`[]`) is a valid "no open roles" response, distinct from the
  `{"ok": false}` "no such company" response — don't conflate the two when debugging a
  registry entry that returns nothing.

## SmartRecruiters

```
GET https://api.smartrecruiters.com/v1/companies/<company_id>/postings
GET https://api.smartrecruiters.com/v1/companies/<company_id>/postings/<posting_id>
```

- `company_id` is the slug/identifier in `jobs.smartrecruiters.com/<CompanyId>` (case
  matters — e.g. `Visa`, not `visa`).
- List endpoint returns `{"offset", "limit", "totalFound", "content": [...]}` — paginated
  at up to 100 per page by default (`offset`/`limit` query params); this skill fetches
  only the first page. For a company with `totalFound` > 100, add pagination if needed.
- Each posting has `id`, `name` (title), `releasedDate`, `location.city/region/country`,
  `refNumber`.
- Detail endpoint's full description lives in `jobAd.sections.<key>.text` (HTML) — the
  skill concatenates every section's stripped text in `detail`.
- Public job URL pattern: `https://jobs.smartrecruiters.com/<company_id>/<posting_id>`.

## Oracle Cloud HCM — "Candidate Experience" (Oracle CX)

The ATS behind a large share of European bank and corporate career sites. The portal is
a JS app, but it is backed by an unauthenticated REST API.

**List:**

```
GET https://<host>/hcmRestApi/resources/latest/recruitingCEJobRequisitions
      ?onlyData=true
      &expand=requisitionList
      &finder=findReqs;siteNumber=<siteNumber>,limit=<n>,sortBy=POSTING_DATES_DESC
```

**Detail:**

```
GET https://<host>/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails
      ?onlyData=true
      &finder=ById;Id=<jobId>,siteNumber=<siteNumber>
```

Quirks, all verified live against UBP (`iaadtu.fa.ocs.oraclecloud.eu`, `CX_1`) on
2026-08-05:

- `ats_id` is `"<host>|<siteNumber>"`. The host is the customer's Oracle Fusion tenant
  and cannot be derived from the company name; `siteNumber` is usually `CX_1`.
- The `finder` value must be sent **percent-encoded** — it contains `;` and `,`, which
  otherwise terminate the parameter.
- The list response nests one level deeper than it looks:
  `items[0].requisitionList[]`, not `items[]`.
- The **detail** endpoint rejects the `expand` values the list endpoint accepts, and
  rejects `jobId=` as a finder key (`ById;Id=<jobId>` is correct). Both mistakes return
  HTTP 400 with a readable message rather than an empty result.
- List records often carry only `PrimaryLocationCountry` (an ISO code like `CH`), while
  the detail record carries a human-readable `PrimaryLocation` ("Geneva, Switzerland").
  The adapter prefers `PrimaryLocation` and falls back to the country code.
- Description HTML is split across `ExternalDescriptionStr`, `OrganizationDescriptionStr`,
  and `CorporateDescriptionStr`; `detail` concatenates the stripped text of each.
- Public job URL pattern:
  `https://<host>/hcmUI/CandidateExperience/en/sites/<siteNumber>/job/<jobId>`.
- These sites render listings client-side, so without this adapter they fall to
  `ats: "generic"` and return nothing at all.

## Generic (no known ATS)

No API — `search` does an HTML `GET` on `careers_url`, strips tags, and pattern-matches
`<a>` links for job-ish keywords in the href or link text. This catches simple static
career pages but **will return nothing useful** for JS-rendered SPAs (React/Angular) or
sites behind Cloudflare/bot-protection, which is common for Workday, SAP
SuccessFactors, and custom-built Swiss corporate career pages. See SKILL.md's
"`generic` entries: WebFetch is the primary path" section — the CLI scrape is a cheap
first try, not the guaranteed path, for this ATS type.

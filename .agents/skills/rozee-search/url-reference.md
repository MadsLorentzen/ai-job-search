# Rozee.pk URL Reference

Observed 2026-10-17 using low-volume live searches.

## Search

The search form submits:

```text
GET https://www.rozee.pk/job/jsearch/?job_title=<keywords>&city=<city-id>
```

Rozee redirects this to a canonical route:

```text
GET https://www.rozee.pk/job/jsearch/q/<query-slug>/fc/<city-id>
```

The all-Pakistan search omits `/fc/<city-id>`. Pagination is supplied as
`?fpn=<offset>`; page 1 has offset 1 in the embedded pagination metadata and
page 2 uses `fpn=20`. The result page contains a JSON-shaped search payload in
an inline script. The `jobs.basic` array holds listings and `numFound` is the
total match count.

Search listing fields observed:

| Field | Meaning |
|-------|---------|
| `jid` | Numeric Rozee job ID |
| `title_exact_en` / `title_exact` | Listing title |
| `company_name` / `company_exact_en` | Employer |
| `city` / `city_exact` | Job city |
| `displayDate` / `created` | Posted date |
| `rozeePermaLink` / `permaLink` | Root-level detail permalink slug |

The CLI uses the permalink slug as the actionable `id` and constructs
`https://www.rozee.pk/<slug>` as the `url`. It also includes the numeric ID as
`jobId`.

## Location IDs

These IDs were read from the search form's city selector:

| City | ID |
|------|----|
| Islamabad | `1180` |
| Faisalabad | `1181` |
| Karachi | `1184` |
| Lahore | `1185` |
| Rawalpindi | `1190` |

Other city IDs are not currently mapped by the CLI.

## Detail

```text
GET https://www.rozee.pk/<permaLink>
```

The detail page is a root-level slug URL, not `/job/<slug>`. The page includes
an `application/ld+json` JobPosting object with `title`, `description`,
`datePosted`, `validThrough`, `employmentType`, `hiringOrganization.name`, and
`jobLocation.address.addressLocality`. An observed detail page returned a valid JobPosting object at a canonical
root-level permalink.

## Filters and access

- `city` is supported through the canonical `/fc/<city-id>` route.
- No posting-age or remote-work filter was observed; `--jobage` is rejected
  and the CLI does not claim a remote filter.
- Rozee's `robots.txt` allows `/job/jsearch/` and root-level job detail pages.
  It disallows unrelated paths such as `/people/`, `/hiring/`, and language
  routes `/UR/` and `/ZH/`.
- The fetched terms page did not state a specific automated-access rule. Page
  source does state that reproducing Rozee page material without permission is
  prohibited. The skill therefore warns users to keep use personal and low
  volume, and to seek permission before reuse or redistribution.

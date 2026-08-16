# RemoteOK API Reference

Public, unauthenticated JSON endpoint used by this skill.

> Per RemoteOK's API terms: link back to the source URL and credit RemoteOK when
> displaying results publicly. Keep volume low and personal-use; this is not a bulk
> data-collection tool.

## Listings

```
GET https://remoteok.com/api
```

No query parameters — always returns the current ~100 live postings as a flat JSON
array. **Element `[0]`** is a legal/attribution notice object (no `id` field) and must
be filtered out; every other element is a job posting.

Job object fields used by this skill:

| Field | Meaning |
|-------|---------|
| `id` | Numeric job ID |
| `position` | Job title |
| `company` | Company name |
| `location` | Free-text location hint (often blank — RemoteOK is remote-only) |
| `tags` | Array of skill/category tags |
| `description` | Full HTML job description |
| `date` | ISO posting date |
| `salary_min` / `salary_max` | Salary range in USD, `0` if not listed |
| `apply_url` | Direct application link |
| `url` | Relative path to the RemoteOK job page (prefix with `https://remoteok.com`) |

## Notes

- No authentication required.
- Since there's no server-side search, this skill fetches the full list once per
  invocation and filters by `--query`/`--location` client-side.
- Respect rate limits — the CLI backs off on 429/5xx.

# JustJoin.it API Reference

Public, unauthenticated `v2` endpoints used by this skill. 

> Personal use only — automated access is against JustJoin.it's Terms of Service; keep volume low.

## Search

```
GET https://api.justjoin.it/v2/user-panel/offers?page=1&perPage=100&sortBy=published&orderBy=DESC
```

Query params used by the API:
| Param | Meaning |
|-------|---------|
| `page` | Pagination offset |
| `perPage` | Results per page (up to 100) |
| `sortBy` | Sort criteria (e.g. published) |

Note: The `Version: 2` header is required for this endpoint to work.
The CLI script fetches the latest offers and filters them locally by `query` and `location` parameters since the API doesn't cleanly expose full-text search parameters.

## Detail

```
GET https://api.justjoin.it/v2/user-panel/offers/<slug>
```

Returns a single job's JSON payload containing description (`body`), salary ranges, company info, and required skills.

## Notes

- No authentication required.
- Requires `Version: 2` header.
- Filter operations are performed client-side for precision.

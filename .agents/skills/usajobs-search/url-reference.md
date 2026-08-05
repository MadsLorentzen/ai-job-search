# USAJOBS Search API — endpoint reference

Documented against <https://developer.usajobs.gov/api-reference/get-api-search>,
retrieved 2026-08-04. Auth behaviour verified live; response parsing **not** yet
verified against real data (needs a key — see SKILL.md).

## Endpoints

| Purpose | Method | URL |
|---------|--------|-----|
| Search | GET | `https://data.usajobs.gov/api/search` |
| Detail | — | **No fetch-by-id endpoint on this API.** See below. |
| Code lists | GET | `https://data.usajobs.gov/codelist/<name>` (agencies, occupational series, postal codes, …) |

### Authentication

Three headers, all required:

```
Host: data.usajobs.gov
User-Agent: <the email address you registered>
Authorization-Key: <your API key>
```

Register free at <https://developer.usajobs.gov/apirequest/>. Verified live:
a request with no key, or with a bad key, returns **HTTP 401** with an RFC-9110
problem+json body. The CLI translates 401/403 into an actionable credentials
message rather than surfacing a bare status code.

Credentials come from `USAJOBS_API_KEY` and `USAJOBS_EMAIL` in the environment.

## Query parameters (all genuinely server-side)

| Param | Notes |
|-------|-------|
| `Keyword` | Searches the whole announcement, including synonyms. |
| `PositionTitle` | Title-only, treated as "contains". |
| `LocationName` | City or military installation. **Full state name required** — `Austin, Texas`, not `Austin, TX`. Semicolon-delimited for multiple. |
| `Organization` | Agency subelement code, e.g. `TR` = Treasury. Semicolon-delimited. |
| `RemoteIndicator` | `True` = remote only, `False` = exclude remote. **Omitted ⇒ remote jobs are included by default.** |
| `DatePosted` | Integer **0–60**. Larger values are clamped by the CLI, not rejected. |
| `ResultsPerPage` | Up to **500**. |
| `Page` | 1-indexed. |
| `SortField` | `opendate`, `closedate`, `organizationname`, `jobtitle`, `salarymin`, `location`, … |
| `SortDirection` | `Asc` / `Desc`. |
| `WhoMayApply` | `Public` \| `All` \| `Status`. **`All` and `Status` require additional authorization** a standard key lacks — the CLI always sends `Public`. |
| `JobCategoryCode` | Occupational series, e.g. `2210` (IT). Semicolon-delimited. |
| `PayGradeLow` / `PayGradeHigh` | `01`–`15` (GS scale). |
| `RemunerationMinimumAmount` / `…Maximum…` | Bucketed: $0–24,999, $25k–49,999, … $200k+. A search for $15,500 returns the whole $0–24,999 bucket. |
| `Radius` | Expands `LocationName` by miles. |
| `fields=all` | Returns the full `UserArea.Details` block (job summary, duties, requirements). The CLI uses this for `detail`. |

## Response structure

```jsonc
{
  "SearchResult": {
    "SearchResultCount": 25,
    "SearchResultCountAll": 1420,
    "SearchResultItems": [
      {
        "MatchedObjectId": "828810900",          // control number — the stable id
        "MatchedObjectDescriptor": {
          "PositionID": "ST-12345678-26-XY",     // announcement number
          "PositionTitle": "...",
          "PositionURI": "https://www.usajobs.gov/job/828810900",
          "ApplyURI": ["..."],
          "PositionLocationDisplay": "Anywhere in the U.S. (remote job)",
          "OrganizationName": "...",
          "DepartmentName": "...",
          "JobGrade": [{ "Code": "GS" }],
          "PositionSchedule": [{ "Name": "Full-time" }],
          "PositionRemuneration": [
            { "MinimumRange": "99200", "MaximumRange": "153354", "RateIntervalCode": "Per Year" }
          ],
          "PublicationStartDate": "2026-08-01",
          "ApplicationCloseDate": "2026-08-31",
          "QualificationSummary": "...",
          "UserArea": { "Details": { "JobSummary": "...", "MajorDuties": ["..."], "Requirements": "..." } }
        }
      }
    ]
  }
}
```

## Field mapping

| Contract field | API path |
|----------------|----------|
| `id` | `MatchedObjectId` (falls back to `PositionID`) |
| `title` | `MatchedObjectDescriptor.PositionTitle` |
| `company` | `OrganizationName` → `DepartmentName` |
| `location` | `PositionLocationDisplay` |
| `date` | `PublicationStartDate` |
| `url` | `PositionURI` |
| `positionId` | `PositionID` |
| `salary` | `PositionRemuneration[0]` min/max + `RateIntervalCode` |
| `grade` | `JobGrade[].Code` |
| `schedule` | `PositionSchedule[].Name` |
| `remote` | regex on `PositionLocationDisplay` (`remote`/`telework`/`anywhere`) |
| `closeDate` | `ApplicationCloseDate` |
| `description` | `UserArea.Details.JobSummary` + `MajorDuties[]` + `Requirements` |
| `applyUrl` | `ApplyURI[0]` |

## Quirks

- **No fetch-by-id.** Per-announcement text is a separate `/api/announcementtext?ControlNumber=` API requiring extra authorization. `detail` therefore issues a `Keyword=<id>&fields=all` search and selects the **exact** id match — never a fuzzy keyword hit.
- **Only open announcements.** Closed postings vanish from this API entirely.
- **`RemoteIndicator` omitted ≠ exclude remote.** The default *includes* remote jobs; you must pass `False` to exclude them.
- **`DatePosted` caps at 60 days.** Anything longer must be clamped or the API rejects it.
- **`WhoMayApply=All`/`Status` need extra authorization**, so federal-employee-only postings are invisible with a standard key.
- **Location wants full state names.** Abbreviations silently match nothing.
- Salary is a bucketed band with a rate interval, not a scalar.
- There is no `remote` boolean in the response — it is inferred from the location display string, which is a heuristic and may miss unusual phrasings.

# Hirist — endpoint reference

Data source for `hirist-search`. Update this file if Hirist changes its API.

## Access / terms

- `hirist.com` 301-redirects to `hirist.tech`. The frontend is a Next.js app; job
  listings are **not** server-rendered — they load via XHR from a JSON API.
- API host: `https://gladiator.hirist.tech`. Both the search and detail endpoints
  return full data **anonymously** (no login, no token, no cookie). Applying to a
  job requires an account, but reading listings/descriptions does not.
- `https://www.hirist.tech/robots.txt`: `Crawl-delay: 10`; disallows only backend
  dirs (`/components/`, `/admin/`, `/modules/`, cache/config, etc.); fully blocks
  only `Yandex`. It does **not** disallow `/search`, `/j/`, or `/c/`, and names no
  AI/Claude/GPT bots. The public site carries a `botDetection`/captcha state in
  its Redux store, but the JSON API served results anonymously during
  investigation without any challenge.
- Treat as personal-use only: keep volume low, no bulk/commercial scraping.

## Search — JSON API (primary)

```
GET https://gladiator.hirist.tech/job/search?query=<kw>&pageNo=<n>&loc=<id>&posting=<days>
Accept: application/json
```

| Param     | Maps to CLI flag | Notes |
|-----------|------------------|-------|
| `query`   | `--query` / `-q` | Keyword/skill/role. Required for meaningful results. |
| `pageNo`  | `--page`         | **0-indexed** page. CLI `--page N` → `pageNo = N-1`. Page size 50. |
| `loc`     | `--location`/`-l`| Hirist **canonical** location id (see table). CLI resolves a city name → id. |
| `posting` | `--jobage`       | Posted within N days (cumulative: `3`→~12, `7`→~54, `15`→~164, `30`→~399 for "data analyst"). |
| `minexp`/`maxexp` | (not wired) | Experience band in years — filters server-side, but not exposed as a CLI flag. |

**Gotchas discovered during investigation:**

- There are **two** location id systems. The site's "popular cities" quick-filter
  widget uses one set of ids (Bangalore=1); the `loc` search param and the ids in
  each result's `location[].id` use a **different, canonical** set (Bangalore=3).
  The CLI's map uses the **canonical** ids — verified by confirming every returned
  job's `location[]` contained the requested city.
- `location=<name>` (a text location param) returns HTTP 500 — the API only takes
  the numeric `loc` id.
- `size` defaults to 50 server-side; the frontend sometimes sends `size=20` with a
  `version: 2` header. The CLI omits `size` (uses the 50 default) and trims with
  `--limit` client-side.

### Response shape

```json
{
  "data": [
    {
      "id": 1654660,
      "title": "Avathon - Data Analyst",
      "jobdesignation": "Data Analyst",
      "min": 4, "max": 7,
      "minSal": 0, "maxSal": 0, "hideSal": 1,
      "confidential": 0,
      "workFromHome": 0,
      "companyData": { "companyName": "Avathon", "companyId": 0 },
      "location": [{ "id": 3, "name": "Bangalore" }],
      "createdTime": 1784053800000,
      "jobDetailUrl": "https://www.hirist.tech/j/avathon-data-analyst-1654660"
    }
  ],
  "page": "0", "limit": 50, "count": 50,
  "totalJobs": 929, "totalPages": 18, "hasMore": true
}
```

Field mapping (`data[i]` → JobCard):

| JobCard      | Source |
|--------------|--------|
| `id`         | `id` (stringified) |
| `title`      | `title` (fallback `jobdesignation`) |
| `company`    | `companyData.companyName`; **`null` if `confidential` is truthy** |
| `location`   | `location[].name` joined with ", " |
| `date`       | `createdTime` (epoch ms) → ISO `YYYY-MM-DD` |
| `url`        | `jobDetailUrl` |
| `experience` | `min`/`max` → e.g. `"4-7 yrs"` |

## Detail — JSON API

```
GET https://gladiator.hirist.tech/job/detail?jobcode=<id>
```

The param is **`jobcode`**, not `jobId` (`?jobId=` yields `JOB_NOT_FOUND`).

Response is `{ "data": { …same job fields as search, plus: } }`:

| JobDetail       | Source |
|-----------------|--------|
| `description`   | `introText` (HTML → text: entities decoded, tags stripped, `<p>/<br>/<li>` → newlines) |
| `skills`        | `tags[].name` |
| `workFromHome`  | `workFromHome` (0/1 → boolean) |
| `applyUrl`      | `jobDetailUrl` (applying requires a Hirist login) |

`detail` accepts a numeric id (`1654660`) or a full posting URL
(`https://www.hirist.tech/j/…-1654660`) — the trailing digits are the id.

## Canonical location ids (subset used by the CLI)

Discovered by aggregating `location[].id` across live results:

```
1 Delhi NCR    2 Mumbai      3 Bangalore   4 Hyderabad   5 Kolkata
6 Chennai      7 Pune        9 Maharashtra 11 Jaipur     14 Chandigarh
31 Karnataka   32 Tamil Nadu 33 Rajasthan  34 Andhra Pradesh
36 Delhi       37 Gurgaon/Gurugram   38 Noida   39 Greater Noida   40 Faridabad
51 Udaipur     53 Ahmedabad  56 Vadodara   66 Nagpur    67 Nasik   68 Navi Mumbai
69 Thane       70 Cochin/Kochi   75 Trivandrum   78 Vizag   79 Aurangabad
84 Coimbatore  88 Anywhere in India   89 Overseas/International
91 Dubai       121 Bhopal    130 Indore   131 Mohali   132 Remote
24 Singapore   27 Malaysia
```

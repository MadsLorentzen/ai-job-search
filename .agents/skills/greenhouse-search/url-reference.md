# Greenhouse Job Board API — endpoint reference

Verified live on 2026-08-04 against the `stripe` board (550 jobs).

Official docs: <https://developers.greenhouse.io/job-board.html>

## Endpoints

| Purpose | Method | URL |
|---------|--------|-----|
| List board | GET | `https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs` |
| Job detail | GET | `https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{id}` |

No authentication or API key. Responses are JSON.

Optional: appending `?content=true` to the list endpoint inlines each job's
description. This CLI does **not** use it — it makes the list response very large,
and `detail` fetches content on demand instead.

## The board token

There is **no cross-company search**. Every request is scoped to one company's
board token — the slug in `boards.greenhouse.io/<token>`. Find it via the
employer's careers page URL, its embedded iframe `src`, or a `?gh_jid=` link.

An unknown token returns **404**, which `jsonFetch` maps to `null`. The search
command treats that as a per-board error and continues with the remaining boards.

## Search parameters

**There are none.** The list endpoint takes no query, location, or date filter.
All of `--query`, `--location` and `--jobage` are therefore applied **client-side**
in `helpers.ts`. The whole board arrives in a single response, so `--page` is
client-side pagination over the filtered set (25/page).

## List response structure

```jsonc
{
  "jobs": [ /* RawGreenhouseJob */ ],
  "meta": { "total": 550 }
}
```

## Per-result field paths

Anchors that `helpers.ts:normalizeJob` depends on.

| Contract field | API path | Notes |
|----------------|----------|-------|
| `id` | `id` | number → stringified; **board-scoped**, not globally unique |
| `title` | `title` | |
| `company` | `company_name` | falls back to the board token |
| `location` | `location.name` | free text, e.g. `"US - Remote"`, `"South San Francisco, CA"` |
| `date` | `first_published` → `updated_at` | see quirk below |
| `url` | `absolute_url` | often the company's own domain with `?gh_jid=` |
| `requisitionId` | `requisition_id` | nullable |
| `description` (detail) | `content` | **double-escaped HTML** — see quirk |
| `departments` (detail) | `departments[].name` | |
| `offices` (detail) | `offices[].name` | |

Observed key set on a **list** record:
`absolute_url, application_deadline, company_name, data_compliance,
first_published, id, internal_job_id, language, location, metadata,
requisition_id, title, updated_at`

**Detail** adds: `ai_disclaimer, ai_opt_out_request_url, content, departments,
include_ai_disclaimer, offices`.

## Quirks

- **`content` is double-escaped.** It is an HTML-escaped HTML string: `&lt;p&gt;About&lt;/p&gt;`. `htmlToText` decodes entities **first**, then strips tags. Reversing the order leaves literal `<p>` in the output.
- **`updated_at` overstates freshness.** It moves on any edit to the posting, so a months-old role can look like it was posted today. `first_published` is the honest signal; the parser prefers it.
- **Boards are global.** Filter with `--location` if you only want US or Remote roles.
- `absolute_url` pointing at the company domain (not greenhouse.io) is normal and correct — it is the canonical apply link.
- `location` is unnormalized free text. Remote is spelled at least four ways across boards (`Remote`, `US - Remote`, `US Remote`, `Anywhere`); `matchesLocation` special-cases them.
- A job id alone is not addressable — always carry the board token with it.

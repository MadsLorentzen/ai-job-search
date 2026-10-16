// Data source: the JSearch API (OpenWeb Ninja), sold through RapidAPI. JSearch
// reads Google for Jobs, which aggregates postings from Indeed, LinkedIn,
// Glassdoor and employers' own career sites - so one call covers boards whose
// own pages refuse scripted access (Indeed answers with a Cloudflare 403).
//
// The API is JSON, so there is no markup to parse: the helpers below map one
// JSearch job object onto the portal contract's result shape, keeping the
// publisher and every apply option so /scrape can tell an Indeed listing from
// the employer's own posting and verify against the latter.
//
// Every request is billed against the user's RapidAPI plan. The key is read
// only from the JSEARCH_API_TOKEN environment variable.

export const API_HOST = "jsearch.p.rapidapi.com"
// Literal URLs (not built from API_HOST) so tooling that scans CLI sources for
// a portal's host - /apply's source-host check - can find it.
export const SEARCH_URL = "https://jsearch.p.rapidapi.com/search-v2" // v1 "/search" was retired (404)
export const DETAIL_URL = "https://jsearch.p.rapidapi.com/job-details"
export const TOKEN_ENV = "JSEARCH_API_TOKEN"

const UA = "Mozilla/5.0 (compatible; jsearch-search-cli/1.0)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** A failure with a contract error code, so cli.ts can report it precisely. */
export class ApiError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
  }
}

export function readToken(env: Record<string, string | undefined> = process.env): string {
  const token = env[TOKEN_ENV]?.trim()
  if (!token) {
    throw new ApiError(
      `set the ${TOKEN_ENV} environment variable to your RapidAPI key for JSearch (export ${TOKEN_ENV}=...); it is never read from a flag or a file in the repo`,
      "MISSING_CREDENTIALS",
    )
  }
  return token
}

/**
 * GET a JSearch endpoint with exponential backoff on transient 429/5xx.
 * A 429 that reports an exhausted plan quota is not transient: retrying only
 * burns requests, so it fails at once with QUOTA_EXCEEDED.
 */
export async function apiFetch(url: string, token: string): Promise<unknown> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "X-RapidAPI-Key": token,
        "X-RapidAPI-Host": API_HOST,
      },
      signal: AbortSignal.timeout(30000),
    })
    if (response.status === 401 || response.status === 403) {
      const body = await response.text()
      const notSubscribed = /not subscribed/i.test(body)
      throw new ApiError(
        notSubscribed
          ? "this RapidAPI key is not subscribed to JSearch - subscribe to a JSearch plan (the free Basic plan is enough) on RapidAPI"
          : `JSearch rejected the key (HTTP ${response.status}) - check ${TOKEN_ENV}`,
        notSubscribed ? "NOT_SUBSCRIBED" : "BAD_CREDENTIALS",
      )
    }
    if (response.status === 429) {
      const body = await response.text()
      if (/quota/i.test(body)) {
        throw new ApiError("JSearch plan quota exhausted for this period - wait for the reset or upgrade the plan", "QUOTA_EXCEEDED")
      }
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new ApiError(`Request failed: ${response.status} ${response.statusText}`, "REQUEST_FAILED")
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) {
      // A retired endpoint also answers 404. Returning "no results" for it would
      // look exactly like a quiet week, so a missing endpoint is a hard error.
      const body = await response.text()
      if (/does not exist/i.test(body)) {
        throw new ApiError(`JSearch endpoint missing (${body.slice(0, 120)}) - the API moved; update SEARCH_URL/DETAIL_URL per url-reference.md`, "ENDPOINT_GONE")
      }
      return null
    }
    if (!response.ok) {
      throw new ApiError(`Request failed: ${response.status} ${response.statusText}`, "REQUEST_FAILED")
    }
    return response.json()
  }
  throw new ApiError("Request failed after max retries", "REQUEST_FAILED")
}

/**
 * JSearch filters by bucket (today / 3days / week / month), not by day count.
 * Map N days to the smallest bucket that contains it; filterByAge then trims
 * to the exact window client-side.
 */
export function jobageToDatePosted(days: number | undefined): string {
  if (days === undefined) return "all"
  if (days <= 1) return "today"
  if (days <= 3) return "3days"
  if (days <= 7) return "week"
  if (days <= 30) return "month"
  return "all"
}

export interface ApplyOption {
  publisher: string | null
  url: string
  isDirect: boolean
}

export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string | null
  publisher: string | null
  employerWebsite: string | null
  employmentType: string | null
  isRemote: boolean
  applyOptions: ApplyOption[]
  postedAt: number | null // unix seconds, for the exact-window filter
}

export interface JobDetail extends JobResult {
  description: string | null
  qualifications: string[]
  responsibilities: string[]
}

type Raw = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

function locationOf(j: Raw): string | null {
  const direct = str(j.job_location)
  if (direct) return direct
  const parts = [str(j.job_city), str(j.job_state), str(j.job_country)].filter(Boolean)
  return parts.length ? parts.join(", ") : null
}

function dateOf(j: Raw): { date: string | null; postedAt: number | null } {
  const ts = typeof j.job_posted_at_timestamp === "number" ? j.job_posted_at_timestamp : null
  if (ts !== null) return { date: new Date(ts * 1000).toISOString().slice(0, 10), postedAt: ts }
  const iso = str(j.job_posted_at_datetime_utc)
  if (iso && !Number.isNaN(Date.parse(iso))) {
    return { date: iso.slice(0, 10), postedAt: Math.floor(Date.parse(iso) / 1000) }
  }
  return { date: null, postedAt: null }
}

export function toResult(j: Raw): JobResult | null {
  const id = str(j.job_id)
  const title = str(j.job_title)
  if (!id || !title) return null
  const options = Array.isArray(j.apply_options) ? (j.apply_options as Raw[]) : []
  const applyOptions: ApplyOption[] = options
    .map((o) => ({ publisher: str(o.publisher), url: str(o.apply_link) ?? "", isDirect: o.is_direct === true }))
    .filter((o) => o.url)
  const { date, postedAt } = dateOf(j)
  return {
    id,
    title,
    company: str(j.employer_name),
    location: locationOf(j),
    date,
    url: str(j.job_apply_link),
    publisher: str(j.job_publisher),
    employerWebsite: str(j.employer_website),
    employmentType: str(j.job_employment_type),
    isRemote: j.job_is_remote === true,
    applyOptions,
    postedAt,
  }
}

const lines = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []

export function toDetail(j: Raw): JobDetail | null {
  const base = toResult(j)
  if (!base) return null
  const h = (j.job_highlights && typeof j.job_highlights === "object" ? j.job_highlights : {}) as Raw
  return {
    ...base,
    description: str(j.job_description),
    qualifications: lines(h.Qualifications),
    responsibilities: lines(h.Responsibilities),
  }
}

/**
 * The job objects of a JSearch response, or [] for an empty / null body.
 * search-v2 nests them as `data.jobs` (with a `data.cursor`); job-details and
 * the retired v1 search return a bare `data` array.
 */
export function dataOf(body: unknown): Raw[] {
  if (!body || typeof body !== "object") return []
  const data = (body as Raw).data
  if (Array.isArray(data)) return data as Raw[]
  if (data && typeof data === "object" && Array.isArray((data as Raw).jobs)) return (data as Raw).jobs as Raw[]
  return []
}

/** The next-page cursor from a search-v2 response, or null on the last page. */
export function cursorOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null
  const data = (body as Raw).data
  return data && typeof data === "object" && !Array.isArray(data) ? str((data as Raw).cursor) : null
}

/**
 * Keep results inside the exact N-day window. A result with no timestamp is
 * kept (the scraper flags it "date unknown") rather than silently dropped.
 */
export function filterByAge(results: JobResult[], days: number | undefined, nowSec = Date.now() / 1000): JobResult[] {
  if (days === undefined) return results
  const cutoff = nowSec - days * 86400
  return results.filter((r) => r.postedAt === null || r.postedAt >= cutoff)
}

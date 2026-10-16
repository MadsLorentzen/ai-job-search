// Data source: Indeed, fetched through a third-party Apify actor
// (misceres/indeed-scraper). Indeed answers scripted requests with a Cloudflare
// 403, so this CLI never requests Indeed itself: it asks Apify to run the actor
// on ordinary Indeed search URLs and reads back the dataset.
//
// Personal use only. The actor gets past Indeed's bot protection, which Indeed's
// terms do not allow; the user chose this route knowingly. Keep volume low.
//
// Every run is billed to the user's Apify account (pay per job saved). The
// token is read only from APIFY_API_TOKEN, and every run carries a hard spend
// cap (maxTotalChargeUsd) so a bad query can never run up a bill.

export const ACTOR_ID = "misceres~indeed-scraper"
// Literal hosts (not built from variables) so tooling that scans CLI sources
// for a portal's host - /apply's source-host check - can find them.
export const RUN_URL = "https://api.apify.com/v2/acts/misceres~indeed-scraper/run-sync-get-dataset-items"
export const INDEED_IE = "https://ie.indeed.com"
export const TOKEN_ENV = "APIFY_API_TOKEN"

const UA = "Mozilla/5.0 (compatible; indeed-search-cli/1.0)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export class ApiError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
  }
}

export function readToken(env: Record<string, string | undefined> = process.env): string {
  const token = env[TOKEN_ENV]?.trim()
  if (!token) {
    throw new ApiError(
      `set the ${TOKEN_ENV} environment variable to your Apify API token (export ${TOKEN_ENV}=...); it is never read from a flag or a file in the repo`,
      "MISSING_CREDENTIALS",
    )
  }
  return token
}

/** Indeed's own country sites. The search URL is built on the user's market. */
export function indeedBase(country: string): string {
  const c = country.toLowerCase()
  if (c === "ie") return INDEED_IE
  if (c === "us") return "https://www.indeed.com"
  return `https://${c}.indeed.com`
}

/**
 * An ordinary Indeed search URL, with Indeed's own `fromage` (days) filter.
 *
 * By default the query is an exact job-title phrase (`title:"data engineer"`).
 * Indeed's plain keyword search is loose - live tests for "data engineer" in
 * Dublin returned a Quality Manager, a sales intern and a run of data-centre
 * construction roles - and every returned job is billed. `broad` restores the
 * plain keyword search.
 */
export function searchUrl(query: string, location: string | undefined, country: string, jobage?: number, broad = false): string {
  const params = new URLSearchParams()
  params.set("q", broad ? query : `title:"${query.replace(/"/g, "")}"`)
  if (location) params.set("l", location)
  if (jobage !== undefined) params.set("fromage", String(jobage))
  // No sort=date: fromage already bounds the window, and date order puts the newest
  // loose keyword matches first (a live test returned a "Quality Manager" for
  // "data engineer"). Indeed's default relevance order keeps real matches on top.
  return `${indeedBase(country)}/jobs?${params.toString()}`
}

/**
 * Run the actor synchronously and return its dataset items. Billing errors and
 * a bad token fail at once; transient 429/5xx back off and retry.
 */
export async function runActor(input: Record<string, unknown>, token: string, maxChargeUsd: number): Promise<unknown[]> {
  const url = `${RUN_URL}?timeout=280&maxTotalChargeUsd=${maxChargeUsd}`
  const maxRetries = 3
  let delay = 2000
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(300000),
    })
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(`Apify rejected the token (HTTP ${response.status}) - check ${TOKEN_ENV}`, "BAD_CREDENTIALS")
    }
    if (response.status === 402) {
      throw new ApiError("Apify account has no usage credit left - top up or wait for the monthly reset", "QUOTA_EXCEEDED")
    }
    if (response.status === 408) {
      throw new ApiError("the Apify run did not finish within 280 s - narrow the search (fewer queries or a lower --limit)", "TIMEOUT")
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) throw new ApiError(`Request failed: ${response.status} ${response.statusText}`, "REQUEST_FAILED")
      await new Promise((r) => setTimeout(r, delay + Math.floor(Math.random() * 500)))
      delay = Math.min(delay * 2, 15000)
      continue
    }
    if (!response.ok) {
      const body = await response.text()
      const quota = /usage|credit|limit exceeded|insufficient/i.test(body)
      throw new ApiError(
        quota ? `Apify refused the run for billing reasons: ${body.slice(0, 200)}` : `Request failed: ${response.status} ${body.slice(0, 200)}`,
        quota ? "QUOTA_EXCEEDED" : "REQUEST_FAILED",
      )
    }
    const body = await response.json()
    return Array.isArray(body) ? body : []
  }
  throw new ApiError("Request failed after max retries", "REQUEST_FAILED")
}

export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string | null
  applyUrl: string | null // the employer's own apply link, when Indeed redirects to it
  salary: string | null
  jobType: string | null
  isExpired: boolean
  description: string | null
}

type Raw = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

/**
 * The posting date as YYYY-MM-DD. Prefers the actor's parsed ISO date; falls
 * back to Indeed's relative label ("3 days ago", "Today", "Just posted")
 * counted back from when the item was scraped. "30+ days ago" has no exact
 * date and stays null rather than being guessed.
 */
export function postedDate(j: Raw): string | null {
  const parsed = str(j.postingDateParsed)
  if (parsed && !Number.isNaN(Date.parse(parsed))) return new Date(parsed).toISOString().slice(0, 10)
  const label = str(j.postedAt)?.toLowerCase()
  if (!label) return null
  const scraped = str(j.scrapedAt)
  const base = scraped && !Number.isNaN(Date.parse(scraped)) ? new Date(scraped) : new Date()
  let days: number | null = null
  if (/just posted|today|hour|minute/.test(label)) days = 0
  else if (/\+/.test(label)) days = null
  else {
    const m = label.match(/(\d+)\s*day/)
    if (m) days = parseInt(m[1], 10)
  }
  if (days === null) return null
  return new Date(base.getTime() - days * 86400000).toISOString().slice(0, 10)
}

/** One actor item onto the portal contract shape; error items and blanks drop out. */
export function toResult(j: Raw): JobResult | null {
  if (j.error) return null // the actor pushes {"error":"FOUND_NO_RESULTS"} for an empty search
  const id = str(j.id)
  const title = str(j.positionName) ?? str(j.title)
  if (!id || !title) return null
  const salary = str(j.salary)
  return {
    id,
    title,
    company: str(j.company),
    location: str(j.location),
    date: postedDate(j),
    url: str(j.url),
    applyUrl: str(j.externalApplyLink),
    salary,
    jobType: Array.isArray(j.jobType) ? (j.jobType as unknown[]).filter((x) => typeof x === "string").join(", ") || null : str(j.jobType),
    isExpired: j.isExpired === true,
    description: str(j.description),
  }
}

/** Keep the exact N-day window; undated results stay (the scraper flags them). */
export function filterByAge(rows: JobResult[], days: number | undefined, now = new Date()): JobResult[] {
  if (days === undefined) return rows
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10)
  return rows.filter((r) => r.date === null || r.date >= cutoff)
}

/** The same posting can come back from two queries; keep the first. */
export function dedupe(rows: JobResult[]): JobResult[] {
  const seen = new Set<string>()
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
}

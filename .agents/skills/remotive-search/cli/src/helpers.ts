// Data source: Remotive public jobs API — https://remotive.com/api/remote-jobs
// Public JSON, no API key required.
//
// ⚠️ TERMS (from the API's own `0-legal-notice` field, verified 2026-08-04):
//   - Access is granted so developers can SHARE Remotive's jobs onward.
//   - Do NOT submit Remotive jobs to third-party job sites (Jooble, Neuvoo,
//     Google Jobs, LinkedIn Jobs were named explicitly).
//   - Link back to the Remotive URL and credit Remotive as the source.
//   - Listings are deliberately DELAYED BY 24 HOURS on the free API.
//   - Using the feed to collect signups/emails breaches their ToS.
//   A private paid API exists for commercial use (their stated starting budget
//   is $5k/mo). Reading these listings for your own job search is fine; do not
//   republish them.
//
// ⚠️ SIZE LIMIT (verified 2026-08-04): the free feed currently returns only
// **32 jobs total** (`total-job-count: 32`) and IGNORES every documented filter
// parameter — `search`, `category`, `company_name` and `limit` all return the
// same full 32-record set. So every filter here is applied CLIENT-SIDE, and this
// portal is a small supplementary feed, not a primary source. Use
// themuse-search for volume.

export const API_BASE = "https://remotive.com/api/remote-jobs"
export const CATEGORIES_URL = "https://remotive.com/api/remote-jobs/categories"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

/** Fetch JSON with exponential backoff + jitter on 429/5xx. Returns null on 404. */
export async function jsonFetch<T>(url: string): Promise<T | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return (await response.json()) as T
  }
  throw new Error("Request failed after max retries")
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  category: string | null
  jobType: string | null
  salary: string | null
  tags: string | null
  source: "Remotive"
}

export interface JobDetail extends JobCard {
  description: string | null
  applyUrl: string | null
}

export interface RawRemotiveJob {
  id?: number
  title?: string
  company_name?: string
  candidate_required_location?: string
  publication_date?: string
  url?: string
  job_type?: string
  category?: string
  salary?: string
  tags?: string[] | null
  description?: string
}

export interface RemotiveResponse {
  "job-count"?: number
  "total-job-count"?: number
  jobs?: RawRemotiveJob[]
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim()
}

/**
 * Remotive's `publication_date` is ISO-like but carries NO timezone suffix
 * (`2026-08-02T20:00:46`). Append `Z` so it parses as UTC deterministically
 * instead of being read as local time.
 */
export function toIsoDate(raw: string | undefined): string | null {
  if (!raw || typeof raw !== "string") return null
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`
  const t = Date.parse(normalized)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

export function normalizeJob(raw: RawRemotiveJob): JobCard | null {
  if (raw == null || typeof raw !== "object") return null
  const id = raw.id != null ? String(raw.id) : null
  const title = typeof raw.title === "string" ? raw.title.trim() : ""
  if (!id || !title) return null

  const tags = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => !!t) : []

  return {
    id,
    title,
    // company_name frequently carries a trailing space in this feed.
    company: raw.company_name?.trim() || null,
    location: raw.candidate_required_location?.trim() || null,
    date: toIsoDate(raw.publication_date),
    url: raw.url || `https://remotive.com/remote-jobs/${id}`,
    category: raw.category?.trim() || null,
    jobType: raw.job_type?.trim() || null,
    salary: raw.salary?.trim() || null,
    tags: tags.length ? tags.join(", ") : null,
    source: "Remotive",
  }
}

export function parseJobs(response: RemotiveResponse | null): JobCard[] {
  if (!response || !Array.isArray(response.jobs)) return []
  const out: JobCard[] = []
  for (const raw of response.jobs) {
    const card = normalizeJob(raw)
    if (card) out.push(card)
  }
  return out
}

/** Client-side keyword filter over title, company and tags. */
export function matchesQuery(card: JobCard, query: string | undefined): boolean {
  if (!query) return true
  const haystack = [card.title, card.company, card.tags].filter(Boolean).join(" ").toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

/** Client-side category filter — matches the human-readable `category` field. */
export function matchesCategory(card: JobCard, category: string | undefined): boolean {
  if (!category) return true
  if (!card.category) return false
  // Accept both "Software Development" and a "software-development" slug.
  const want = category.trim().toLowerCase().replace(/[-_]+/g, " ")
  return card.category.toLowerCase().includes(want)
}

/**
 * Client-side location filter over `candidate_required_location`, which holds
 * eligibility regions ("Worldwide", "USA", "USA, Canada") rather than a city.
 */
export function matchesLocation(card: JobCard, location: string | undefined): boolean {
  if (!location) return true
  if (!card.location) return false
  const have = card.location.toLowerCase()
  const want = location.trim().toLowerCase()
  if (/^(usa|us|united states)$/.test(want)) {
    return /\b(usa|u\.s\.|united states|north america|americas|worldwide|anywhere)\b/.test(have)
  }
  return have.includes(want)
}

export function withinJobAge(card: JobCard, days: number, now: number): boolean {
  if (!days || days <= 0 || days >= 9999) return true
  if (!card.date) return false
  const published = Date.parse(card.date)
  if (Number.isNaN(published)) return false
  return now - published <= days * 86400000
}

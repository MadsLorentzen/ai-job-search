// Data source: Greenhouse Job Board API — https://developers.greenhouse.io/job-board.html
// Public JSON, no API key required.
//
// IMPORTANT DESIGN NOTE:
// Greenhouse has NO cross-company search. The API is scoped to one company's
// board at a time, addressed by its board token (the slug in the company's
// job-board URL, e.g. `stripe` in boards.greenhouse.io/stripe). So this CLI
// REQUIRES --company, accepts a comma-separated list, and filters keywords
// CLIENT-SIDE. It is a "target company list" tool, not open-ended discovery —
// use themuse-search for that.

export const API_BASE = "https://boards-api.greenhouse.io/v1/boards"

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
      signal: AbortSignal.timeout(15000),
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
  board: string
  requisitionId: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
  departments: string | null
  offices: string | null
  applyUrl: string | null
}

export interface RawGreenhouseJob {
  id?: number
  internal_job_id?: number
  title?: string
  updated_at?: string
  first_published?: string
  requisition_id?: string | null
  absolute_url?: string
  company_name?: string
  location?: { name?: string } | null
  content?: string
  departments?: Array<{ name?: string }> | null
  offices?: Array<{ name?: string }> | null
}

export interface GreenhouseListResponse {
  jobs?: RawGreenhouseJob[]
  meta?: { total?: number }
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

/**
 * Greenhouse returns `content` as an HTML string that is itself HTML-ESCAPED
 * (`&lt;p&gt;...`). Decode entities FIRST so the tags become real tags, then
 * strip them — doing it the other way round leaves visible `<p>` litter.
 */
export function htmlToText(escapedHtml: string): string {
  const html = decodeHtmlEntities(escapedHtml)
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

/** Parse one raw record defensively; returns null rather than throwing. */
export function normalizeJob(raw: RawGreenhouseJob, board: string): JobCard | null {
  if (raw == null || typeof raw !== "object") return null
  const id = raw.id != null ? String(raw.id) : null
  const title = typeof raw.title === "string" ? raw.title.trim() : ""
  if (!id || !title) return null

  return {
    id,
    title,
    company: raw.company_name?.trim() || board,
    location: raw.location?.name?.trim() || null,
    // first_published is when the posting went live; updated_at moves on any edit.
    date: raw.first_published || raw.updated_at || null,
    url: raw.absolute_url || `https://boards.greenhouse.io/${board}/jobs/${id}`,
    board,
    requisitionId: raw.requisition_id ?? null,
  }
}

export function parseJobs(
  response: GreenhouseListResponse | null,
  board: string,
): JobCard[] {
  if (!response || !Array.isArray(response.jobs)) return []
  const out: JobCard[] = []
  for (const raw of response.jobs) {
    const card = normalizeJob(raw, board)
    if (card) out.push(card)
  }
  return out
}

/**
 * Client-side keyword filter over title only. Greenhouse has no search
 * parameter. Company is deliberately excluded from the haystack: every result
 * on a board shares the same company, so matching it would pass everything.
 */
export function matchesQuery(card: JobCard, query: string | undefined): boolean {
  if (!query) return true
  const haystack = card.title.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

/** Client-side location filter (substring, case-insensitive). */
export function matchesLocation(card: JobCard, location: string | undefined): boolean {
  if (!location) return true
  if (!card.location) return false
  const want = location.trim().toLowerCase()
  const have = card.location.toLowerCase()
  // "Remote" should also catch "Remote - US", "US Remote", "Anywhere".
  if (/^remote$/.test(want)) return /remote|anywhere|distributed/.test(have)
  return have.includes(want)
}

export function withinJobAge(card: JobCard, days: number, now: number): boolean {
  if (!days || days <= 0 || days >= 9999) return true
  if (!card.date) return false
  const published = Date.parse(card.date)
  if (Number.isNaN(published)) return false
  return now - published <= days * 86400000
}

/** Split a comma-separated --company value into board tokens. */
export function parseBoards(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

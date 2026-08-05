// Data source: The Muse public jobs API — https://www.themuse.com/developers/api/v2
// Public JSON, no API key required for the endpoints used here.
//
// IMPORTANT DESIGN NOTE (verified by probing, see url-reference.md):
// The public API has NO free-text search parameter. `q`, `query`, `keyword` and
// `search` are all silently ignored — the reported `total` stays identical
// (405,744) whether they are present or not. Server-side filtering is limited to
// `category`, `level`, `location` and `company`. Therefore `--query` in this CLI
// is applied CLIENT-SIDE across a bounded sweep of pages. That is a real
// limitation, not a parsing bug: narrow with `--category`/`--location` first so
// the sweep covers a relevant slice, then let `--query` refine it.

export const API_BASE = "https://www.themuse.com/api/public/jobs"

/** The Muse's canonical name for its remote bucket. */
export const REMOTE_LOCATION = "Flexible / Remote"

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
  levels: string | null
  categories: string | null
  companyShortName: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
  applyUrl: string | null
}

/** Raw shape of a single result in The Muse's `results` array. */
export interface RawMuseJob {
  id?: number
  name?: string
  contents?: string
  publication_date?: string
  short_name?: string
  company?: { id?: number; name?: string; short_name?: string } | null
  locations?: Array<{ name?: string }> | null
  levels?: Array<{ name?: string; short_name?: string }> | null
  categories?: Array<{ name?: string }> | null
  refs?: { landing_page?: string } | null
}

export interface MuseSearchResponse {
  page?: number
  page_count?: number
  items_per_page?: number
  total?: number
  results?: RawMuseJob[]
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

/** Convert an HTML description block to readable plain text, keeping paragraph breaks. */
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
 * Normalize one raw API result into the portal-skill contract shape. Parsed
 * defensively and independently per record so one malformed entry cannot break
 * the rest of the page.
 */
export function normalizeJob(raw: RawMuseJob): JobCard | null {
  if (raw == null || typeof raw !== "object") return null
  const id = raw.id != null ? String(raw.id) : null
  const title = typeof raw.name === "string" ? raw.name.trim() : ""
  if (!id || !title) return null

  const locations = Array.isArray(raw.locations)
    ? raw.locations.map((l) => l?.name).filter((n): n is string => !!n)
    : []
  const levels = Array.isArray(raw.levels)
    ? raw.levels.map((l) => l?.name).filter((n): n is string => !!n)
    : []
  const categories = Array.isArray(raw.categories)
    ? raw.categories.map((c) => c?.name).filter((n): n is string => !!n)
    : []

  const companyShortName = raw.company?.short_name ?? null
  const url =
    raw.refs?.landing_page ||
    (companyShortName && raw.short_name
      ? `https://www.themuse.com/jobs/${companyShortName}/${raw.short_name}`
      : `https://www.themuse.com/jobs/${id}`)

  return {
    id,
    title,
    company: raw.company?.name?.trim() || null,
    location: locations.length ? locations.join("; ") : null,
    date: raw.publication_date || null,
    url,
    levels: levels.length ? levels.join(", ") : null,
    categories: categories.length ? categories.join(", ") : null,
    companyShortName,
  }
}

export function parseJobs(response: MuseSearchResponse | null): JobCard[] {
  if (!response || !Array.isArray(response.results)) return []
  const out: JobCard[] = []
  for (const raw of response.results) {
    const card = normalizeJob(raw)
    if (card) out.push(card)
  }
  return out
}

/**
 * Client-side keyword filter. The API has no free-text parameter (see the note
 * at the top of this file), so `--query` is matched here.
 *
 * Deliberately matched against title and company ONLY — not category or level.
 * Including the category made `-q` useless: every result inside
 * `--category "Software Engineering"` trivially contains "engineer", so the
 * filter passed everything through unchanged.
 *
 * All whitespace-separated terms must match (AND), case-insensitive.
 */
export function matchesQuery(card: JobCard, query: string | undefined): boolean {
  if (!query) return true
  const haystack = [card.title, card.company].filter(Boolean).join(" ").toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

/** Client-side recency filter: keep postings published within `days` of now. */
export function withinJobAge(card: JobCard, days: number, now: number): boolean {
  if (!days || days <= 0 || days >= 9999) return true
  if (!card.date) return false
  const published = Date.parse(card.date)
  if (Number.isNaN(published)) return false
  return now - published <= days * 86400000
}

/** Map a user-facing location to The Muse's own vocabulary. */
export function normalizeLocation(location: string): string {
  const v = location.trim()
  if (/^(remote|flexible|anywhere|us remote|remote \(us\))$/i.test(v)) return REMOTE_LOCATION
  return v
}

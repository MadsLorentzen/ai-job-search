// Data source: Greenhouse Job Board API — https://developers.greenhouse.io/job-board.html
// Public JSON, no API key required.
//
// IMPORTANT DESIGN NOTE:
// Greenhouse has NO cross-company search. The API is scoped to one company's
// board at a time, addressed by its board token (the slug in the company's
// job-board URL, e.g. `stripe` in boards.greenhouse.io/stripe). Role-first
// search is built on top of that limitation: --registry sweeps every board in
// the shared registry concurrently and filters keywords CLIENT-SIDE. Either
// --registry or --company is required; there is no global search to fall back on.

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

const REMOTE_RE = /remote|anywhere|distributed/

/** Country and region names that, standing alone, indicate a non-US role. */
const NON_US_RE = new RegExp(
  "\\b(" +
    [
      "canada","poland","spain","portugal","germany","france","netherlands","ireland",
      "united kingdom","uk","england","scotland","wales","india","brazil","mexico","argentina",
      "colombia","chile","japan","singapore","australia","new zealand","israel","south africa",
      "nigeria","kenya","philippines","vietnam","indonesia","china","korea","taiwan","sweden",
      "norway","denmark","finland","switzerland","austria","belgium","italy","greece","romania",
      "bulgaria","serbia","croatia","czechia","czech republic","hungary","ukraine","turkey",
      "uae","dubai","emea","apac","latam",
    ].join("|") +
    ")\\b",
  "i",
)

const US_PHRASE_RE = /\b(us|u\.s\.|usa|u\.s\.a\.|united states|america|americas|north america|nationwide|anywhere in the us)\b/i

/** Full US state / territory names. Case-insensitive; matched on word boundaries. */
const US_STATE_NAMES = [
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware",
  "florida","georgia","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky","louisiana",
  "maine","maryland","massachusetts","michigan","minnesota","mississippi","missouri","montana",
  "nebraska","nevada","new hampshire","new jersey","new mexico","new york","north carolina",
  "north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island","south carolina",
  "south dakota","tennessee","texas","utah","vermont","virginia","washington","west virginia",
  "wisconsin","wyoming","district of columbia","puerto rico",
]
const US_STATE_NAME_RE = new RegExp("\\b(" + US_STATE_NAMES.join("|") + ")\\b", "i")

/**
 * Two-letter state codes, matched CASE-SENSITIVELY and only after a comma —
 * i.e. the "Indianapolis, IN" shape. Matching these case-insensitively or
 * without the comma would be a disaster: "Remote in Canada" contains a bare
 * lowercase "in", which would read as Indiana and wrongly admit a Canada role.
 */
const US_STATE_CODE_RE =
  /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR)\b/

/**
 * Match US-eligible remote roles.
 *
 * Plain `--location Remote` cannot express this: US remote is spelled at least
 * four ways ("Remote - US", "Remote US", "Remote - United States", "Remote, USA")
 * so no single substring catches them all, while bare "Remote" wrongly admits
 * "Remote Canada" / "Remote Poland" / "Remote Spain".
 *
 * ORDER MATTERS. US indicators are checked BEFORE the non-US blocklist, because
 * a blocklist over free text produces silent false negatives — the worst failure
 * mode here, since a hidden job gives the user no signal at all. Real examples
 * that a blocklist-first design got wrong:
 *   "Remote - Indiana"          -> "india" matched inside "Indiana"
 *   "Remote - Indianapolis, IN" -> same
 *   "Remote - New Mexico"       -> "mexico" matched inside "New Mexico"
 *   "Remote - Brazil, IN"       -> Brazil, Indiana is a real US town
 *   "Remote - Greece, NY"       -> Greece, New York is a real US town
 * Checking for a US state name or a ", XX" state code first resolves all of these,
 * and also handles multi-region postings ("Remote US; Remote Canada") correctly.
 */
export function matchesUsRemote(card: JobCard): boolean {
  const raw = card.location || ""
  if (!raw) return false
  const lower = raw.toLowerCase()
  if (!REMOTE_RE.test(lower)) return false

  // 1. Any explicit US signal wins outright.
  if (US_PHRASE_RE.test(lower)) return true
  if (US_STATE_NAME_RE.test(lower)) return true
  if (US_STATE_CODE_RE.test(raw)) return true

  // 2. No US signal — reject if a non-US country/region is named.
  if (NON_US_RE.test(lower)) return false

  // 3. Unqualified remote ("Remote", "Anywhere") — assume eligible.
  return true
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

// ---------------------------------------------------------------------------
// Company registry — what makes role-first search possible.
//
// Greenhouse has no cross-company search, so "find me Go roles anywhere" is
// implemented as: sweep every known board, filter titles locally. The registry
// is the list of known boards, shared with lever-search.
// ---------------------------------------------------------------------------

import { join } from "path"

// import.meta.dir is .agents/skills/<skill>/cli/src — four levels up is .agents/
export const REGISTRY_PATH = join(
  import.meta.dir,
  "../../../../ats-registry/companies.json",
)

export interface Registry {
  schema_version?: number
  updated?: string
  greenhouse?: string[]
  lever?: string[]
}

/**
 * Load the shared registry. Returns [] rather than throwing when the file is
 * absent or malformed — a missing registry should degrade `--registry` into a
 * clear error at the call site, not crash the CLI.
 */
export async function loadRegistry(ats: "greenhouse" | "lever"): Promise<string[]> {
  try {
    const file = Bun.file(REGISTRY_PATH)
    if (!(await file.exists())) return []
    const data = (await file.json()) as Registry
    const list = data[ats]
    return Array.isArray(list) ? list.filter((s) => typeof s === "string" && s.trim()) : []
  } catch {
    return []
  }
}

/**
 * Persist an updated slug list, preserving the other ATS's entries and any
 * unknown keys.
 *
 * Not concurrency-safe: this is a read-modify-write with no file lock, so two
 * `discover` runs started at the same moment could clobber each other's
 * additions. Acceptable for a single-user CLI whose registry is tracked in git
 * (recovery is a git checkout away); revisit if this ever runs unattended.
 */
export async function saveRegistry(
  ats: "greenhouse" | "lever",
  slugs: string[],
): Promise<number> {
  let data: Registry = {}
  try {
    const file = Bun.file(REGISTRY_PATH)
    if (await file.exists()) data = (await file.json()) as Registry
  } catch {
    data = {}
  }
  const merged = Array.from(new Set([...(data[ats] ?? []), ...slugs])).sort()
  data[ats] = merged
  data.updated = new Date().toISOString().slice(0, 10)
  await Bun.write(REGISTRY_PATH, JSON.stringify(data, null, 2) + "\n")
  return merged.length
}

/**
 * Run `fn` over `items` with at most `limit` in flight. Sweeping the whole registry
 * sequentially takes minutes; this brings it to seconds while staying polite
 * enough not to trip rate limiting.
 */
export async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

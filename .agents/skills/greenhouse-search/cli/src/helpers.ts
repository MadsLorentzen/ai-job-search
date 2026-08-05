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

const REMOTE_RE = /remote|anywhere|distributed/
/**
 * Countries and regions that, when named, mean the role is NOT US-eligible.
 * Deliberately explicit rather than "anything that isn't the US" — location
 * strings are unnormalized free text and an allowlist would drop valid US roles.
 */
const NON_US_RE = new RegExp(
  [
    "canada","poland","spain","portugal","germany","france","netherlands","ireland","united kingdom",
    "\\buk\\b","england","scotland","india","brazil","mexico","argentina","colombia","chile","japan",
    "singapore","australia","new zealand","israel","south africa","nigeria","kenya","philippines",
    "vietnam","indonesia","china","korea","taiwan","sweden","norway","denmark","finland","switzerland",
    "austria","belgium","italy","greece","romania","bulgaria","serbia","croatia","czech","hungary",
    "ukraine","turkey","\\buae\\b","dubai","emea","apac","latam","\\bemea\\b",
  ].join("|"),
  "i",
)
const US_RE = /\b(us|usa|u\.s\.|united states|america|americas|north america)\b/i

/**
 * Match US-eligible remote roles.
 *
 * Substring matching alone cannot do this: US remote roles are spelled at least
 * four ways ("Remote - US", "Remote US", "Remote - United States", "Remote, USA"),
 * so no single --location value catches them all, while plain "Remote" wrongly
 * admits "Remote Canada" / "Remote Poland" / "Remote Spain".
 *
 * Rule: must read as remote, AND must not name a non-US country — unless it also
 * explicitly names the US (multi-region postings like "Remote US; Remote Canada"
 * are genuinely open to US candidates).
 */
export function matchesUsRemote(card: JobCard): boolean {
  const have = (card.location || "").toLowerCase()
  if (!have) return false
  if (!REMOTE_RE.test(have)) return false
  if (US_RE.test(have)) return true
  return !NON_US_RE.test(have)
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

/** Persist an updated slug list back to the registry, preserving other keys. */
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
 * Run `fn` over `items` with at most `limit` in flight. Sweeping 79 boards
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

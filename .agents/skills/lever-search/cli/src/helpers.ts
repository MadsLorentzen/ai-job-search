// Data source: Lever public postings API — https://github.com/lever/postings-api
// Public JSON, no API key required.
//
// IMPORTANT DESIGN NOTE:
// Like Greenhouse, Lever has NO cross-company search — the API is scoped to one
// company's posting site at a time (the slug in jobs.lever.co/<site>). So
// --company is REQUIRED and keyword filtering happens CLIENT-SIDE. Use
// themuse-search for open-ended discovery.
//
// Verified server-side filters: `team`, `commitment`, `skip`, `limit`.
// `location` IS accepted but requires an EXACT match ("New York, NY" works,
// "New York" returns 0), which is too brittle to expose — so --location is
// filtered client-side instead. See url-reference.md.

export const API_BASE = "https://api.lever.co/v0/postings"

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
  site: string
  team: string | null
  commitment: string | null
  workplaceType: string | null
  country: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
  applyUrl: string | null
}

export interface RawLeverPosting {
  id?: string
  text?: string
  createdAt?: number
  hostedUrl?: string
  applyUrl?: string
  country?: string | null
  workplaceType?: string | null
  descriptionPlain?: string
  additionalPlain?: string
  categories?: {
    location?: string | null
    team?: string | null
    department?: string | null
    commitment?: string | null
    allLocations?: string[] | null
  } | null
  lists?: Array<{ text?: string; content?: string }> | null
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
 * Lever's `createdAt` is epoch MILLISECONDS, not an ISO string. Convert so the
 * contract's `date` field is comparable with the other portal skills.
 */
export function toIsoDate(createdAt: number | undefined): string | null {
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt) || createdAt <= 0) return null
  const d = new Date(createdAt)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function normalizeJob(raw: RawLeverPosting, site: string): JobCard | null {
  if (raw == null || typeof raw !== "object") return null
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : null
  const title = typeof raw.text === "string" ? raw.text.trim() : ""
  if (!id || !title) return null

  const cats = raw.categories ?? {}
  // allLocations is the fuller list when a role is open in several offices.
  const locations = Array.isArray(cats.allLocations) && cats.allLocations.length
    ? cats.allLocations.filter((l): l is string => !!l)
    : cats.location
      ? [cats.location]
      : []

  return {
    id,
    title,
    company: site,
    location: locations.length ? locations.join("; ") : null,
    date: toIsoDate(raw.createdAt),
    url: raw.hostedUrl || `https://jobs.lever.co/${site}/${id}`,
    site,
    team: cats.team ?? null,
    commitment: cats.commitment ?? null,
    workplaceType: raw.workplaceType ?? null,
    country: raw.country ?? null,
  }
}

export function parseJobs(response: RawLeverPosting[] | null, site: string): JobCard[] {
  if (!Array.isArray(response)) return []
  const out: JobCard[] = []
  for (const raw of response) {
    const card = normalizeJob(raw, site)
    if (card) out.push(card)
  }
  return out
}

/**
 * Client-side keyword filter over the title only. Company is excluded — every
 * posting on a site shares it, so matching there would pass everything through.
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

/** Client-side location filter. Lever's server-side one needs exact strings. */
export function matchesLocation(card: JobCard, location: string | undefined): boolean {
  if (!location) return true
  const want = location.trim().toLowerCase()
  if (/^remote$/.test(want)) {
    if (card.workplaceType && card.workplaceType.toLowerCase() === "remote") return true
    return !!card.location && /remote|anywhere|distributed/.test(card.location.toLowerCase())
  }
  if (!card.location) return false
  return card.location.toLowerCase().includes(want)
}

/** Filter on Lever's own workplaceType field: remote | hybrid | onsite. */
export function matchesWorkplace(card: JobCard, mode: string | undefined): boolean {
  if (!mode) return true
  const want = mode.trim().toLowerCase().replace(/^on-site$/, "onsite")
  return (card.workplaceType || "").toLowerCase() === want
}

export function withinJobAge(card: JobCard, days: number, now: number): boolean {
  if (!days || days <= 0 || days >= 9999) return true
  if (!card.date) return false
  const published = Date.parse(card.date)
  if (Number.isNaN(published)) return false
  return now - published <= days * 86400000
}

export function parseSites(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

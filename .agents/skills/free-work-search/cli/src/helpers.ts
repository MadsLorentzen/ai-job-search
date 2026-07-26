// Data source: Free-Work's public JSON API at https://api.free-work.com.
// The site (www.free-work.com) is a Nuxt app; its job data is served by an
// API Platform (Symfony) backend that answers unauthenticated GETs. Because the
// responses are structured JSON, there is no HTML parsing here at all — unlike
// linkedin-search, which has to regex its way through markup.
//
// See url-reference.md for the full endpoint and parameter documentation.

export const API_BASE = "https://api.free-work.com"
export const SEARCH_PATH = "/job_postings"
export const SITE_BASE = "https://www.free-work.com"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

/**
 * Fetch JSON with exponential backoff + jitter on 429/5xx. Returns null on 404
 * rather than throwing, so a missing posting is a normal result, not a crash.
 */
export async function jsonFetch<T>(url: string): Promise<T | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
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

// ---------------------------------------------------------------------------
// Raw API shapes (only the fields we consume)
// ---------------------------------------------------------------------------

interface RawLocation {
  locality?: string | null
  adminLevel1?: string | null
  adminLevel2?: string | null
  country?: string | null
  countryCode?: string | null
  label?: string | null
  shortLabel?: string | null
  key?: string | null
}

interface RawCompany {
  name?: string | null
  slug?: string | null
}

interface RawJobCategory {
  slug?: string | null
  nameForUserSlug?: string | null
  name?: string | null
  shortName?: string | null
}

export interface RawPosting {
  id?: number
  title?: string | null
  slug?: string | null
  description?: string | null
  publishedAt?: string | null
  createdAt?: string | null
  contracts?: string[] | null
  location?: RawLocation | null
  company?: RawCompany | null
  job?: RawJobCategory | null
  minDailySalary?: number | null
  maxDailySalary?: number | null
  minAnnualSalary?: number | null
  maxAnnualSalary?: number | null
  currency?: string | null
  durationValue?: number | null
  durationPeriod?: string | null
  renewable?: boolean | null
  remoteMode?: string | null
  experienceLevel?: string | null
  skills?: unknown[] | null
  applicationUrl?: string | null
  expiredAt?: string | null
  external?: boolean | null
}

// ---------------------------------------------------------------------------
// Normalized output (the portal-skill contract)
// ---------------------------------------------------------------------------

export interface JobCard {
  id: string
  slug: string | null
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  contracts: string[]
  remote: string | null
  experienceLevel: string | null
  /** Daily rate (TJM) in the posting's currency, e.g. "400-580 EUR/day". */
  dailyRate: string | null
  annualSalary: string | null
  duration: string | null
  renewable: boolean | null
}

export interface JobDetail extends JobCard {
  description: string | null
  category: string | null
  applyUrl: string | null
  expiresAt: string | null
}

/** Strip diacritics and punctuation to build a Free-Work location key segment. */
export function slugifyLocation(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Build the `locationKeys` value. Free-Work keys are
 * `country~adminLevel1~adminLevel2~locality` (empty segments widen the match),
 * e.g. `fr~ile-de-france~~` for the whole Île-de-France region.
 *
 * A caller who already has an exact key (from a result's `location.key`) can
 * pass it through verbatim — detected by the presence of a `~`.
 */
export function buildLocationKey(input: string): string {
  if (input.includes("~")) return input
  return `fr~${slugifyLocation(input)}~~`
}

/** Public, human-facing URL for a posting on www.free-work.com. */
export function publicUrl(p: RawPosting): string {
  const postSlug = p.slug
  const catSlug = p.job?.slug ?? p.job?.nameForUserSlug
  if (postSlug && catSlug) {
    return `${SITE_BASE}/fr/tech-it/job-mission/${catSlug}/${postSlug}`
  }
  // Degrade to a site search rather than emitting a URL that would 404.
  const q = encodeURIComponent(postSlug ?? p.title ?? "")
  return `${SITE_BASE}/fr/tech-it/jobs?query=${q}`
}

function formatRange(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string | null | undefined,
  unit: string,
): string | null {
  if (min == null && max == null) return null
  const cur = currency ?? "EUR"
  if (min != null && max != null && min !== max) return `${min}-${max} ${cur}/${unit}`
  return `${min ?? max} ${cur}/${unit}`
}

function formatDuration(p: RawPosting): string | null {
  if (p.durationValue == null || !p.durationPeriod) return null
  const n = p.durationValue
  const unit = p.durationPeriod
  const plural = n > 1 ? "s" : ""
  return `${n} ${unit}${plural}`
}

/** Map a raw API posting onto the portal-skill contract shape. */
export function normalizeCard(p: RawPosting): JobCard {
  const loc = p.location ?? null
  return {
    id: p.id != null ? String(p.id) : "",
    slug: p.slug ?? null,
    title: p.title ?? "(untitled)",
    company: p.company?.name ?? null,
    location: loc?.label ?? loc?.shortLabel ?? loc?.locality ?? null,
    date: p.publishedAt ?? p.createdAt ?? null,
    url: publicUrl(p),
    contracts: p.contracts ?? [],
    remote: p.remoteMode ?? null,
    experienceLevel: p.experienceLevel ?? null,
    dailyRate: formatRange(p.minDailySalary, p.maxDailySalary, p.currency, "day"),
    annualSalary: formatRange(p.minAnnualSalary, p.maxAnnualSalary, p.currency, "year"),
    duration: formatDuration(p),
    renewable: p.renewable ?? null,
  }
}

export function normalizeDetail(p: RawPosting): JobDetail {
  return {
    ...normalizeCard(p),
    description: htmlToText(p.description),
    category: p.job?.name ?? p.job?.shortName ?? null,
    applyUrl: p.applicationUrl ?? null,
    expiresAt: p.expiredAt ?? null,
  }
}

// ---------------------------------------------------------------------------
// Description rendering
// ---------------------------------------------------------------------------

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
    // &amp; last, so "&amp;#43;" does not become "+" in a single pass.
    .replace(/&amp;/g, "&")
}

/**
 * Free-Work descriptions are HTML with heavy `<br />` padding between block
 * elements. Convert to readable plain text, preserving paragraph and list
 * structure, and collapse the runs of blank lines the padding leaves behind.
 */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|li|ul|ol|div|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
  return (
    decodeHtmlEntities(withBreaks)
      .replace(/\u00a0/g, " ")
      // Trim trailing spaces per line before collapsing blank runs.
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || null
  )
}

/** Keep postings published within the last `days` days. */
export function withinJobAge(cards: JobCard[], days: number): JobCard[] {
  if (!days || days <= 0 || days >= 9999) return cards
  const cutoff = Date.now() - days * 86400_000
  return cards.filter((c) => {
    if (!c.date) return true // unknown date: keep and let the caller judge
    const t = Date.parse(c.date)
    return isNaN(t) ? true : t >= cutoff
  })
}

export const CONTRACT_VALUES = [
  "contractor",
  "permanent",
  "fixed-term",
  "apprenticeship",
  "internship",
] as const

export const REMOTE_VALUES = ["full", "partial", "none"] as const

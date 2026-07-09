// Data source: the freehire.dev public REST API (JSON). Reads are unauthenticated
// — no API key — so a search/detail skill needs no credentials, the same bar as
// linkedin-search. The API returns a `{ "data": ..., "meta": {...} }` envelope, so
// unlike the HTML-scraping portal skills there is no markup to parse: we fetch
// JSON and reshape it into the portal-skill contract's result fields.
//
// Hosted-service dependency: this skill talks to freehire.dev, a personal project
// maintained on a best-effort basis (no formal SLA). If the API is unreachable the
// CLI exits non-zero with a clear error rather than hanging, so an outage degrades
// gracefully instead of breaking the caller. The base URL is swappable via the
// FREEHIRE_API_URL env var (see baseUrl) for self-hosting.

export const DEFAULT_BASE_URL = "https://freehire.dev"

/**
 * Resolve the API base URL. Defaults to https://freehire.dev; override with the
 * FREEHIRE_API_URL env var to point at a self-hosted instance (the freehire
 * backend stands up via Docker Compose on the same /api/v1/... paths). Trailing
 * slashes are trimmed so path concatenation stays clean.
 */
export function baseUrl(): string {
  const raw = (process.env.FREEHIRE_API_URL ?? "").trim()
  return (raw || DEFAULT_BASE_URL).replace(/\/+$/, "")
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "freehire-search-skill/1.0 (+https://freehire.dev)"

/** The shared API response envelope: {data, meta, error}. */
export interface Envelope<T> {
  data: T
  meta?: { total?: number; limit?: number; offset?: number }
  error?: string
}

/**
 * GET a JSON envelope from the freehire API with exponential backoff on 429/5xx.
 * Returns `null` on a 404 (caller decides whether that is "no results" or
 * "not found"). A connection failure (API unreachable) fails fast with a clear
 * message — no retry, since a refused connection is not transient server load,
 * and failing fast is what the graceful-degradation contract wants (an outage
 * should degrade this source quickly, never hang the caller). Only 429/5xx —
 * genuine transient server states — are retried.
 */
export async function apiGet<T>(path: string): Promise<Envelope<T> | null> {
  const url = `${baseUrl()}${path}`
  const maxRetries = 6
  let delay = 500

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        redirect: "follow",
      })
    } catch (e) {
      // Connection refused / DNS failure / timeout: the API is unreachable.
      throw new Error(
        `could not reach the freehire API at ${baseUrl()} (${e instanceof Error ? e.message : String(e)})`,
      )
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`freehire API request failed: ${response.status} ${response.statusText}`)
      }
      await sleep(delay + Math.floor(Math.random() * 500))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    if (!response.ok) {
      const body = await safeJson(response)
      throw new Error(body?.error || `freehire API request failed: ${response.status} ${response.statusText}`)
    }
    return (await response.json()) as Envelope<T>
  }
  // Unreachable in practice; the loop returns or throws on the last attempt.
  throw new Error("freehire API request failed after retries")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function safeJson(response: Response): Promise<{ error?: string } | null> {
  try {
    return (await response.json()) as { error?: string }
  } catch {
    return null
  }
}

/**
 * A freehire job as served by the API (the fields this skill reads — the wire
 * shape carries more). The dictionary facets (skills/regions/countries/cities)
 * are always present as arrays; work_mode may be absent.
 */
export interface FreehireJob {
  public_slug: string
  source: string
  external_id: string
  url: string
  title: string
  company: string
  company_slug: string
  location: string
  description: string
  skills: string[]
  work_mode?: string
  regions: string[]
  countries: string[]
  cities: string[]
  posted_at: string | null
  created_at: string | null
  enrichment?: {
    seniority?: string
    category?: string
    employment_type?: string
    salary_min?: number
    salary_max?: number
    salary_currency?: string
  }
}

/**
 * A search result in the portal-skill contract shape. `id` is the freehire
 * public_slug (what `detail <slug>` consumes); `date` is the posting date. The
 * richer facet fields are a superset the contract permits. Missing values are
 * `null`, never omitted.
 */
export interface JobResult {
  id: string
  title: string
  company: string | null
  company_slug: string | null
  location: string | null
  date: string | null
  url: string
  work_mode: string | null
  regions: string[]
  countries: string[]
  skills: string[]
}

/** A job detail: the search result plus the cleaned description and enrichment. */
export interface JobDetailResult extends JobResult {
  cities: string[]
  seniority: string | null
  category: string | null
  employment_type: string | null
  salary: string | null
  description: string | null
}

/** Reshape a freehire job into the contract search-result fields. */
export function toResult(j: FreehireJob): JobResult {
  return {
    id: j.public_slug,
    title: j.title || "(untitled)",
    company: j.company || null,
    company_slug: j.company_slug || null,
    location: j.location || null,
    date: j.posted_at ?? null,
    url: j.url,
    work_mode: j.work_mode || null,
    regions: j.regions ?? [],
    countries: j.countries ?? [],
    skills: j.skills ?? [],
  }
}

/** Reshape a freehire job into the detail result (adds cleaned description + enrichment). */
export function toDetail(j: FreehireJob): JobDetailResult {
  const e = j.enrichment ?? {}
  return {
    ...toResult(j),
    cities: j.cities ?? [],
    seniority: e.seniority || null,
    category: e.category || null,
    employment_type: e.employment_type || null,
    salary: formatSalary(e),
    description: cleanHtml(j.description),
  }
}

/** Human-readable salary line from the enrichment fields, or null when absent. */
function formatSalary(e: NonNullable<FreehireJob["enrichment"]>): string | null {
  if (e.salary_min == null && e.salary_max == null) return null
  const cur = e.salary_currency ? `${e.salary_currency} ` : ""
  if (e.salary_min != null && e.salary_max != null) return `${cur}${e.salary_min}–${e.salary_max}`
  return `${cur}${e.salary_min ?? e.salary_max}`
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

function decodeHtmlEntities(text: string): string {
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
 * freehire descriptions carry HTML (<ul><li>…). Strip tags into readable text,
 * turning block/line-break tags into newlines and decoding entities, so `detail`
 * output reads as prose rather than markup. Returns null for an empty result.
 */
export function cleanHtml(html: string | null | undefined): string | null {
  if (!html) return null
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

/** Extract a freehire public slug from a bare slug or a /jobs/<slug> URL. */
export function normalizeSlug(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const m = trimmed.match(/\/jobs\/([^/?#]+)/)
  if (m) return m[1]
  // A bare slug: lowercase alphanumerics and hyphens (no path/scheme).
  if (/^[a-z0-9][a-z0-9-]*$/i.test(trimmed)) return trimmed
  return null
}

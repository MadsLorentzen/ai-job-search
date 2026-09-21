// Data source: the ENTRA public REST API (entracareers.com/api) — JSON, no API
// key, paginated `{ data, page, limit, total, totalPages }` lists and `{ data }`
// single items. Every posting is ingested straight from the employer's ATS
// (Greenhouse, Lever, Ashby, …) so there is no HTML card parsing here: we fetch
// JSON and reshape it into the portal-skill contract's result fields. The base
// URL is swappable via ENTRA_API_URL; the public site URL via ENTRA_SITE_URL.

export const DEFAULT_BASE_URL = "https://entracareers.com/api"
export const DEFAULT_SITE_URL = "https://entracareers.com"

/** API base URL: ENTRA_API_URL (for a staging/self-hosted instance) or the default. */
export function baseUrl(): string {
  const raw = (process.env.ENTRA_API_URL ?? "").trim()
  return (raw || DEFAULT_BASE_URL).replace(/\/+$/, "")
}

/** Public site URL used to build posting links. */
export function siteUrl(): string {
  const raw = (process.env.ENTRA_SITE_URL ?? "").trim()
  return (raw || DEFAULT_SITE_URL).replace(/\/+$/, "")
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

// The honest, tool-naming User-Agent every shipped portal CLI uses.
const UA = "Mozilla/5.0 (compatible; entra-cli/1.0)"

/** A paginated list response from the ENTRA API. */
export interface ListEnvelope<T> {
  data: T[]
  page: number
  limit: number
  total: number
  totalPages: number
}

/** A single-item response from the ENTRA API. */
export interface ItemEnvelope<T> {
  data: T
}

/** The ENTRA API's error body (Fastify style). */
interface ApiError {
  statusCode?: number
  error?: string
  message?: string
}

/**
 * GET a JSON body from the ENTRA API. Retries 429/5xx (transient server states)
 * with exponential backoff and jitter; returns `null` on a 404. A connection
 * failure fails fast with a clear message — no retry, so an outage degrades this
 * source quickly rather than hanging the caller (the graceful-degradation contract).
 */
export async function apiGet<T>(path: string): Promise<T | null> {
  const url = `${baseUrl()}${path}`
  const maxRetries = 6
  let delay = 500

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      })
    } catch (e) {
      // Connection refused / DNS failure / timeout: the API is unreachable.
      throw new Error(`could not reach the ENTRA API at ${baseUrl()} (${e instanceof Error ? e.message : String(e)})`)
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`ENTRA API request failed: ${response.status} ${response.statusText}`)
      }
      await sleep(delay + Math.floor(Math.random() * 500))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null

    // Read the body once, tolerantly: an error response's JSON gives us its
    // `message`; a 2xx must parse (a malformed one is surfaced, not swallowed).
    const body = (await response.json().catch(() => null)) as (T & ApiError) | null
    if (!response.ok) {
      throw new Error(body?.message || body?.error || `ENTRA API request failed: ${response.status} ${response.statusText}`)
    }
    if (!body) throw new Error("ENTRA API returned an unparseable response body")
    return body
  }
  // Unreachable in practice; the loop returns or throws on the last attempt.
  throw new Error("ENTRA API request failed after retries")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** An ENTRA job — the fields this skill reads (the wire shape carries more). */
export interface EntraJob {
  id: string
  title: string
  description?: string | null
  requirements?: string | null
  employmentType?: string | null
  workLocation?: string | null
  experienceLevel?: string | null
  salaryMin?: number | null
  salaryMax?: number | null
  salaryCurrency?: string | null
  salaryPeriod?: string | null
  source?: string | null
  externalApplyUrl?: string | null
  isActive?: boolean
  publishedAt?: string | null
  expiresAt?: string | null
  company?: { id?: string; name?: string; slug?: string; isVerified?: boolean } | null
  specialization?: { nameEn?: string; slug?: string } | null
  country?: { nameEn?: string; slug?: string } | null
  city?: { nameEn?: string; slug?: string } | null
}

/** An ENTRA company — the fields `--company` resolution reads. */
export interface EntraCompany {
  id: string
  name: string
  slug: string
}

/**
 * A search result in the portal-skill contract shape. `id` is the ENTRA job
 * UUID (what `detail <id>` consumes) and `date` is the publication date;
 * missing values are `null`, never omitted. The extra fields are a permitted
 * superset: `apply_url` is the employer's own ATS apply page, `source` names
 * the ATS the posting was ingested from.
 */
export interface JobResult {
  id: string
  title: string
  company: string | null
  company_slug: string | null
  location: string | null
  date: string | null
  url: string
  apply_url: string | null
  work_mode: string | null
  experience: string | null
  employment_type: string | null
  salary: string | null
  source: string | null
  description: string | null
}

/** A job detail: the search result plus requirements, specialization and lifecycle. */
export interface JobDetailResult extends JobResult {
  requirements: string | null
  specialization: string | null
  expires_at: string | null
  is_active: boolean | null
}

/** The public ENTRA posting page. The site geo-redirects the bare path to a country prefix. */
export function jobUrl(id: string): string {
  return `${siteUrl()}/vacancies/${id}?utm_source=ai-job-search&utm_medium=agent`
}

/** "City, Country" from the API's nested location objects, or null. */
export function formatLocation(j: EntraJob): string | null {
  const parts = [j.city?.nameEn, j.country?.nameEn].map((s) => (s ?? "").trim()).filter(Boolean)
  return parts.length ? parts.join(", ") : null
}

const PERIOD: Record<string, string> = { yearly: "/yr", monthly: "/mo", weekly: "/wk", daily: "/day", hourly: "/hr" }

/** Human-readable salary line, or null when the posting states no salary. */
export function formatSalary(j: EntraJob): string | null {
  const min = j.salaryMin ?? null
  const max = j.salaryMax ?? null
  if (min == null && max == null) return null
  const cur = j.salaryCurrency ? `${j.salaryCurrency} ` : ""
  const range = min != null && max != null ? `${min}–${max}` : String(min ?? max)
  const per = j.salaryPeriod ? (PERIOD[j.salaryPeriod] ?? "") : ""
  return `${cur}${range}${per}`
}

/** Reshape an ENTRA job into the contract search-result fields. */
export function toResult(j: EntraJob): JobResult {
  return {
    id: j.id,
    title: (j.title ?? "").trim() || "(untitled)",
    company: j.company?.name?.trim() || null,
    company_slug: j.company?.slug || null,
    location: formatLocation(j),
    date: j.publishedAt ?? null,
    url: jobUrl(j.id),
    apply_url: j.externalApplyUrl || null,
    work_mode: j.workLocation || null,
    experience: j.experienceLevel || null,
    employment_type: j.employmentType || null,
    salary: formatSalary(j),
    source: j.source || null,
    description: cleanHtml(j.description),
  }
}

/** Reshape an ENTRA job into the detail result. */
export function toDetail(j: EntraJob): JobDetailResult {
  return {
    ...toResult(j),
    requirements: cleanHtml(j.requirements),
    specialization: j.specialization?.nameEn || null,
    expires_at: j.expiresAt ?? null,
    is_active: typeof j.isActive === "boolean" ? j.isActive : null,
  }
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
 * ENTRA descriptions are usually plain text with newlines (normalized at
 * ingest), but some ATS sources deliver HTML. Strip tags into readable prose:
 * block/line-break tags become newlines, entities are decoded. Plain text
 * passes through with whitespace normalized. Null for empty input.
 */
export function cleanHtml(html: string | null | undefined): string | null {
  if (!html) return null
  const withBreaks = html.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  const text = decodeHtmlEntities(withBreaks.replace(/<[a-zA-Z/!][^>]*>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Extract an ENTRA job id from a bare UUID or a .../vacancies/<uuid> URL. */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const m = trimmed.match(/\/vacancies\/([0-9a-f-]{36})/i)
  if (m && UUID.test(m[1])) return m[1].toLowerCase()
  if (UUID.test(trimmed)) return trimmed.toLowerCase()
  return null
}

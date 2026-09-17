// Data source: ArtStation's public jobs API (JSON), the same endpoint the
// artstation.com/jobs Angular app calls. No authentication required — reads
// are public. Confirmed via live browser network capture on 2026-07-31:
// static analysis of the minified JS bundles did not reveal the endpoint
// (it is built at runtime), so this was found by watching real requests.

export const API_BASE = "https://www.artstation.com/api/v2/jobs/public"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

/**
 * GET JSON from the ArtStation jobs API. Retries 429/5xx with backoff;
 * returns `null` on a 404. A connection failure fails fast with a clear
 * message rather than retrying into a hang.
 */
export async function apiGet<T>(path: string): Promise<T | null> {
  const url = `${API_BASE}${path}`
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
      throw new Error(
        `could not reach the ArtStation jobs API (${e instanceof Error ? e.message : String(e)})`,
      )
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`ArtStation API request failed: ${response.status} ${response.statusText}`)
      }
      await sleep(delay + Math.floor(Math.random() * 500))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null

    const body = (await response.json().catch(() => null)) as T | { message?: string } | null
    if (!response.ok) {
      const msg = (body as { message?: string } | null)?.message
      throw new Error(msg || `ArtStation API request failed: ${response.status} ${response.statusText}`)
    }
    if (body === null) throw new Error("ArtStation API returned an unparseable response body")
    return body as T
  }
  throw new Error("ArtStation API request failed after retries")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** A locality entry as returned by the API's `recruitment_localities`. */
interface Locality {
  locality: {
    formatted_name: string | null
    city_name: string | null
    country_name: string | null
  }
}

interface SalaryRange {
  min_salary: number | null
  max_salary: number | null
  currency: string | null
  period: string | null
  currency_symbol: string | null
}

/** An ArtStation job — the fields this skill reads (the wire shape carries more). */
export interface ArtStationJob {
  id: number
  hash_id: string
  title: string
  description: string | null
  about: string | null
  company_name: string | null
  company_url: string | null
  apply_link: string | null
  recruitment_localities: Locality[]
  skills: string | string[] | null
  salary_range: SalaryRange | null
  work_remotely: boolean
  offer_relocation: boolean
  level: string | null
  job_type: string | null
  job_state: string | null
  created_at: string | null
  updated_at: string | null
}

/** A search result in the portal-skill contract shape. `id` is the hash_id
 * (what `detail <id>` consumes) — the numeric `id` is not usable for lookups. */
export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  remote: boolean
  level: string | null
  job_type: string | null
}

export interface JobDetailResult extends JobResult {
  description: string | null
  applyUrl: string | null
  salary: string | null
  skills: string[]
  offerRelocation: boolean
}

/** Join recruitment localities into a single readable string, or null if none. */
function formatLocation(localities: Locality[]): string | null {
  if (!localities || localities.length === 0) return null
  const names = localities.map((l) => l.locality?.formatted_name).filter((n): n is string => !!n)
  if (names.length === 0) return null
  if (names.length <= 3) return names.join(" | ")
  return `${names.slice(0, 3).join(" | ")} + ${names.length - 3} more`
}

function formatSalary(s: SalaryRange | null): string | null {
  if (!s || (s.min_salary == null && s.max_salary == null)) return null
  const sym = s.currency_symbol || s.currency || ""
  const period = s.period ? `/${s.period}` : ""
  if (s.min_salary != null && s.max_salary != null) return `${sym}${s.min_salary}-${s.max_salary}${period}`
  return `${sym}${s.min_salary ?? s.max_salary}${period}`
}

function toSkillsList(skills: string | string[] | null): string[] {
  if (!skills) return []
  if (Array.isArray(skills)) return skills.filter(Boolean)
  return skills
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

export function toResult(j: ArtStationJob): JobResult {
  return {
    id: j.hash_id,
    title: j.title || "(untitled)",
    company: j.company_name || null,
    location: formatLocation(j.recruitment_localities),
    date: j.created_at,
    url: `https://www.artstation.com/jobs/${j.hash_id}`,
    remote: !!j.work_remotely,
    level: j.level || null,
    job_type: j.job_type || null,
  }
}

export function toDetail(j: ArtStationJob): JobDetailResult {
  return {
    ...toResult(j),
    description: cleanHtml(j.description),
    applyUrl: j.apply_link || null,
    salary: formatSalary(j.salary_range),
    skills: toSkillsList(j.skills),
    offerRelocation: !!j.offer_relocation,
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

/** Strip a job description's HTML into readable prose: block/line-break tags
 * become newlines, entities are decoded, tags removed. Null for empty input. */
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

/** Extract an ArtStation job hash_id from a bare hash_id or a /jobs/<hash_id> URL. */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const m = trimmed.match(/\/jobs\/([^/?#]+)/)
  if (m) return m[1]
  // A bare hash_id: alphanumeric, no path/scheme.
  if (/^[a-zA-Z0-9]+$/.test(trimmed)) return trimmed
  return null
}

/** True if `dateStr` (ISO timestamp) falls within the last `days` days. Missing
 * dates and a non-positive/huge `days` (meaning "no filter") always pass. */
export function withinJobAge(dateStr: string | null, days: number): boolean {
  if (!dateStr || days <= 0 || days >= 9999) return true
  const posted = Date.parse(dateStr)
  if (isNaN(posted)) return true
  const cutoff = Date.now() - days * 86400000
  return posted >= cutoff
}

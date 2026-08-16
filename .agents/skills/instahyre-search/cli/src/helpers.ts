// Data source: Instahyre's public job_search JSON API (no authentication) plus
// the public posting HTML pages for full descriptions.
//
//   Search:  GET /api/v1/job_search/?skills=<kw>&jobLocations=<city>&offset=<n>
//   Detail:  GET /api/v1/job_search/<id>            (basic fields + public_url)
//            + GET <public_url>                     (JobPosting JSON-LD: description, date)
//
// The API returns JSON, so search parsing is trivial. Detail descriptions live
// only in the JobPosting ld+json embedded in the public HTML page, so detail
// pulls that page and parses the ld+json block.

export const API_BASE = "https://www.instahyre.com/api/v1/job_search"
export const PAGE_SIZE = 35 // server-fixed page size; --limit caps client-side

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; instahyre-search-cli/1.0)"

async function fetchWithBackoff(
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, { headers, redirect: "follow" })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    return response
  }
  throw new Error("Request failed after max retries")
}

/** Fetch JSON from the API. Returns null on 404. */
export async function jsonFetch<T = unknown>(url: string): Promise<T | null> {
  const response = await fetchWithBackoff(url, {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "X-Requested-With": "XMLHttpRequest",
  })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

/** Fetch HTML. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  // The posting pages sit behind Cloudflare, which 403s a spoofed Chrome
  // User-Agent but allows the runtime's native UA. So send only a wildcard
  // Accept and let bun set its own User-Agent.
  const response = await fetchWithBackoff(url, { Accept: "*/*" })
  if (response.status === 404) return ""
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`)
  }
  return response.text()
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  keywords: string[]
}

export interface JobDetail extends JobCard {
  description: string | null
  employmentType: string | null
  applyUrl: string | null
}

interface ApiEmployer {
  company_name?: string | null
}
interface ApiJob {
  id: number | string
  title?: string | null
  candidate_title?: string | null
  locations?: string | null
  public_url?: string | null
  employer?: ApiEmployer | null
  keywords?: string[] | null
}
export interface ApiSearchResponse {
  objects: ApiJob[]
  meta: { total_count?: number; offset?: number; limit?: number }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&nbsp;/g, " ")
}

function cleanLocations(raw: string | null | undefined): string | null {
  if (!raw) return null
  return raw.split(",").map((s) => s.trim()).filter(Boolean).join(", ") || null
}

/** Map one API job object to the shared JobCard shape. */
export function toCard(job: ApiJob): JobCard {
  return {
    id: String(job.id),
    title: (job.title || job.candidate_title || "(untitled)").trim(),
    company: job.employer?.company_name?.trim() || null,
    location: cleanLocations(job.locations),
    date: null, // not present in the search API; the detail page carries datePosted
    url: job.public_url || `https://www.instahyre.com/api/v1/job_search/${job.id}`,
    keywords: Array.isArray(job.keywords) ? job.keywords : [],
  }
}

/** Parse the search API response into cards. Bad objects are skipped, not fatal. */
export function parseSearch(data: ApiSearchResponse): JobCard[] {
  if (!data || !Array.isArray(data.objects)) return []
  const cards: JobCard[] = []
  for (const job of data.objects) {
    try {
      if (job && job.id != null) cards.push(toCard(job))
    } catch {
      // skip a malformed object rather than break the whole page
    }
  }
  return cards
}

/** Pull the first JobPosting JSON-LD block out of a posting's HTML page. */
function extractJobPostingLd(html: string): Record<string, unknown> | null {
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim()
    if (!raw.includes("JobPosting")) continue
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (parsed && parsed["@type"] === "JobPosting") return parsed
    } catch {
      // malformed block; keep scanning
    }
  }
  return null
}

function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function ldLocation(ld: Record<string, unknown>): string | null {
  const jl = ld["jobLocation"]
  const arr = Array.isArray(jl) ? jl : jl ? [jl] : []
  const parts: string[] = []
  for (const entry of arr) {
    const addr = (entry as Record<string, unknown>)?.["address"] as
      | Record<string, unknown>
      | undefined
    const city = addr?.["addressLocality"] as string | undefined
    const region = addr?.["addressRegion"] as string | undefined
    const label = [city, region].filter(Boolean).join(", ")
    if (label) parts.push(label)
  }
  return parts.length ? [...new Set(parts)].join(" | ") : null
}

/**
 * Build a JobDetail by combining the API object (basic fields) with the
 * JobPosting ld+json from the public HTML page (description, date, type).
 */
export function buildDetail(
  id: string,
  apiJob: ApiJob | null,
  html: string,
): JobDetail {
  const base: JobCard = apiJob
    ? toCard(apiJob)
    : {
        id,
        title: "(untitled)",
        company: null,
        location: null,
        date: null,
        url: `https://www.instahyre.com/api/v1/job_search/${id}`,
        keywords: [],
      }

  const ld = html ? extractJobPostingLd(html) : null
  let description: string | null = null
  let employmentType: string | null = null
  if (ld) {
    if (typeof ld["title"] === "string" && base.title === "(untitled)") {
      base.title = (ld["title"] as string).trim()
    }
    const org = ld["hiringOrganization"] as Record<string, unknown> | undefined
    if (!base.company && typeof org?.["name"] === "string") {
      base.company = (org["name"] as string).trim()
    }
    const ldLoc = ldLocation(ld)
    if (ldLoc) base.location = ldLoc
    if (typeof ld["datePosted"] === "string") base.date = ld["datePosted"] as string
    if (typeof ld["employmentType"] === "string") {
      employmentType = ld["employmentType"] as string
    }
    if (typeof ld["description"] === "string") {
      description = htmlToText(ld["description"] as string) || null
    }
  }

  return {
    ...base,
    description,
    employmentType,
    applyUrl: base.url.startsWith("http") ? base.url : null,
  }
}

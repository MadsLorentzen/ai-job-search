// Data source: Himalayas' public JSON API. No authentication required.
// GET https://himalayas.app/jobs/api?limit=20&offset=N — the server caps page size at
// 20 regardless of the requested --limit, and there is no server-side keyword search
// (searchTerm/keywords/q/search params are all silently ignored), so this CLI pages
// through with --pages and filters client-side. The site's own job-detail HTML pages
// return 403 to non-browser clients, but the list API already embeds each job's full
// HTML description, so no separate detail request is needed.

export const API_URL = "https://himalayas.app/jobs/api"
export const PAGE_SIZE = 20

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; himalayas-search-cli/1.0)"

export interface HimalayasRaw {
  title: string
  excerpt?: string
  companyName?: string
  companySlug?: string
  employmentType?: string
  minSalary?: number | null
  maxSalary?: number | null
  salaryPeriod?: string | null
  seniority?: string[]
  currency?: string | null
  locationRestrictions?: string[]
  categories?: string[]
  parentCategories?: string[]
  description?: string
  pubDate?: number
  applicationLink?: string
  guid?: string
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string
  categories: string[]
  employmentType: string | null
  salary: string | null
  date: string | null
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
}

/** Fetch one page (fixed page size of 20) with exponential backoff on 429/5xx. */
async function fetchPage(offset: number): Promise<HimalayasRaw[]> {
  const maxRetries = 6
  let delay = 500
  const url = `${API_URL}?limit=${PAGE_SIZE}&offset=${offset}`
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
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
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    const data = (await response.json()) as { jobs: HimalayasRaw[] }
    return data.jobs || []
  }
  throw new Error("Request failed after max retries")
}

/** Fetch `pages` pages sequentially starting at offset 0. */
export async function fetchJobs(pages: number): Promise<HimalayasRaw[]> {
  const all: HimalayasRaw[] = []
  for (let p = 0; p < pages; p++) {
    const batch = await fetchPage(p * PAGE_SIZE)
    if (batch.length === 0) break
    all.push(...batch)
  }
  return all
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

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

/** Job ID: "<companySlug>/<jobSlug>" derived from the guid URL, stable and unique. */
function idFromGuid(guid: string | undefined, fallbackTitle: string, fallbackCompany: string): string {
  const m = (guid || "").match(/\/companies\/([^/]+)\/jobs\/([^/?]+)/)
  if (m) return `${m[1]}/${m[2]}`
  return `${fallbackCompany}/${fallbackTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, "-")
}

function formatSalary(raw: HimalayasRaw): string | null {
  if (raw.minSalary == null && raw.maxSalary == null) return null
  const cur = raw.currency || "USD"
  const period = raw.salaryPeriod || "annual"
  const min = raw.minSalary != null ? raw.minSalary.toLocaleString() : "?"
  const max = raw.maxSalary != null ? raw.maxSalary.toLocaleString() : "?"
  return `${cur} ${min}-${max}/${period}`
}

function locationLabel(restrictions: string[] | undefined): string {
  if (!restrictions || restrictions.length === 0) return "Anywhere"
  return restrictions.join(", ")
}

export function toJobCard(raw: HimalayasRaw): JobCard {
  return {
    id: idFromGuid(raw.guid, raw.title, raw.companyName || ""),
    title: raw.title,
    company: raw.companyName || null,
    location: locationLabel(raw.locationRestrictions),
    categories: raw.parentCategories || [],
    employmentType: raw.employmentType || null,
    salary: formatSalary(raw),
    date: raw.pubDate ? new Date(raw.pubDate * 1000).toISOString() : null,
    url: raw.guid || raw.applicationLink || "https://himalayas.app/jobs",
  }
}

export function toJobDetail(raw: HimalayasRaw): JobDetail {
  const withBreaks = (raw.description || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  const description = decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim() || null
  return { ...toJobCard(raw), description }
}

/** Client-side keyword match across title, company, categories, and description. */
export function matchesQuery(raw: HimalayasRaw, query: string): boolean {
  const q = query.toLowerCase()
  const haystack = [
    raw.title,
    raw.companyName || "",
    (raw.categories || []).join(" "),
    (raw.parentCategories || []).join(" "),
    raw.description || "",
  ]
    .join(" ")
    .toLowerCase()
  return haystack.includes(q)
}

/** Client-side location match. Unrestricted (empty array) postings always match. */
export function matchesLocation(raw: HimalayasRaw, location: string): boolean {
  const loc = location.trim().toLowerCase()
  if (!loc || loc === "remote" || loc === "anywhere" || loc === "worldwide") return true
  const restrictions = raw.locationRestrictions || []
  if (restrictions.length === 0) return true
  return restrictions.some((r) => r.toLowerCase().includes(loc))
}

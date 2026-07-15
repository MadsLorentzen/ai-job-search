export const API_URL = "https://www.arbeitnow.com/api/job-board-api"
export const MAX_PAGES = 10

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export interface RawJob {
  slug: string
  company_name?: string
  title?: string
  description?: string
  remote?: boolean
  url?: string
  tags?: string[]
  job_types?: string[]
  location?: string
  created_at?: number
}

export interface ApiPage {
  data?: RawJob[]
  links?: { next?: string | null }
}

export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  remote: boolean | null
  tags: string[]
}

export async function fetchPage(page: number): Promise<ApiPage> {
  const url = `${API_URL}?page=${page}`
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; arbeitnow-cli/1.0)",
      },
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((resolve) => setTimeout(resolve, delay + jitter))
      delay = Math.min(delay * 2, 5000)
      continue
    }
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`)
    }
    return response.json() as Promise<ApiPage>
  }
  throw new Error("API request failed after max retries")
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(br|\/p|\/li|\/h[1-6])[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function toIsoDate(unixSeconds?: number): string | null {
  if (!unixSeconds) return null
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}

export function mapJob(raw: RawJob): JobResult {
  return {
    id: raw.slug,
    title: raw.title || "(no title)",
    company: raw.company_name || null,
    location: raw.location || null,
    date: toIsoDate(raw.created_at),
    url: raw.url || `https://www.arbeitnow.com/jobs/${raw.slug}`,
    remote: raw.remote ?? null,
    tags: raw.tags ?? [],
  }
}

export interface FilterOpts {
  query?: string
  location?: string
  remote?: boolean
  jobageDays?: number
}

export function matchesFilters(raw: RawJob, f: FilterOpts): boolean {
  if (f.remote !== undefined && (raw.remote ?? false) !== f.remote) return false
  if (f.location) {
    const loc = (raw.location || "").toLowerCase()
    if (!loc.includes(f.location.toLowerCase())) return false
  }
  if (f.jobageDays !== undefined && raw.created_at) {
    const ageDays = (Date.now() / 1000 - raw.created_at) / 86400
    if (ageDays > f.jobageDays) return false
  }
  if (f.query) {
    const q = f.query.toLowerCase()
    const haystack = [raw.title, raw.company_name, raw.location, (raw.tags ?? []).join(" "), raw.description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
    if (!haystack.includes(q)) return false
  }
  return true
}

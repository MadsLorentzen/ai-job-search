// Data source: RemoteOK's public JSON API. No authentication required.
// GET https://remoteok.com/api returns a flat array; element [0] is a legal/attribution
// notice (no "id" field), the rest are job postings. There is no server-side search or
// pagination — it always returns the current ~100 live postings, so we fetch once and
// filter client-side by query/location/tag.

export const API_URL = "https://remoteok.com/api"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; remoteok-search-cli/1.0)"

export interface RemoteOKRaw {
  id?: string
  slug?: string
  epoch?: number
  date?: string
  company?: string
  company_logo?: string
  position?: string
  tags?: string[]
  description?: string
  location?: string
  apply_url?: string
  salary_min?: number
  salary_max?: number
  logo?: string
  url?: string
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  tags: string[]
  date: string | null
  salaryMin: number | null
  salaryMax: number | null
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  applyUrl: string | null
}

/** Fetch the live postings list with exponential backoff on 429/5xx. */
export async function fetchJobs(): Promise<RemoteOKRaw[]> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(API_URL, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
      },
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
    const data = (await response.json()) as RemoteOKRaw[]
    // First element is a legal notice with no "id" — drop it.
    return data.filter((j) => j.id)
  }
  throw new Error("Request failed after max retries")
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

export function toJobCard(raw: RemoteOKRaw): JobCard {
  return {
    id: raw.id as string,
    title: raw.position || "(untitled)",
    company: raw.company || null,
    location: raw.location || null,
    tags: raw.tags || [],
    date: raw.date || null,
    salaryMin: raw.salary_min || null,
    salaryMax: raw.salary_max || null,
    url: raw.url
      ? raw.url.startsWith("http")
        ? raw.url
        : `https://remoteok.com${raw.url}`
      : `https://remoteok.com/remote-jobs/${raw.id}`,
  }
}

export function toJobDetail(raw: RemoteOKRaw): JobDetail {
  const withBreaks = (raw.description || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  const description = decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim() || null
  return {
    ...toJobCard(raw),
    description,
    applyUrl: raw.apply_url || null,
  }
}

/** Client-side keyword match across title, company, tags, and description. */
export function matchesQuery(raw: RemoteOKRaw, query: string): boolean {
  const q = query.toLowerCase()
  const haystack = [
    raw.position || "",
    raw.company || "",
    (raw.tags || []).join(" "),
    raw.description || "",
  ]
    .join(" ")
    .toLowerCase()
  return haystack.includes(q)
}

/** Client-side location match: "remote" always matches (RemoteOK is remote-only);
 *  otherwise substring-match against the location field. */
export function matchesLocation(raw: RemoteOKRaw, location: string): boolean {
  const loc = location.trim().toLowerCase()
  if (!loc || loc === "remote" || loc === "anywhere") return true
  return (raw.location || "").toLowerCase().includes(loc)
}

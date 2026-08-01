// Data source: RemoteOK's public JSON feed (https://remoteok.com/api). No
// authentication required. robots.txt explicitly allows ClaudeBot/anthropic-ai/
// Claude-Web to crawl public job listings (see ../url-reference.md). The feed's
// first array element is always a legal/attribution notice, not a job — every
// caller here strips it before returning results.

export const API_URL = "https://remoteok.com/api"
export const JOB_PAGE_URL = "https://remoteok.com/remote-jobs"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

/** Fetch text with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function textFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/html;q=0.9, */*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
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
    if (response.status === 404) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
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
  tags: string[]
  salaryMin: number | null
  salaryMax: number | null
}

export interface JobDetail extends JobCard {
  description: string | null
  applyUrl: string | null
}

interface RawJob {
  id?: string
  slug?: string
  position?: string
  company?: string
  location?: string
  tags?: string[]
  description?: string
  apply_url?: string
  url?: string
  salary_min?: number
  salary_max?: number
  date?: string
  epoch?: number
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

export function stripTags(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim()
}

function rawToCard(raw: RawJob): JobCard | null {
  if (!raw.id || !raw.position) return null
  return {
    id: String(raw.id),
    title: decodeHtmlEntities(raw.position),
    company: raw.company ? decodeHtmlEntities(raw.company) : null,
    location: raw.location ? decodeHtmlEntities(raw.location) : null,
    date: raw.date ?? null,
    url: raw.url || raw.apply_url || `${JOB_PAGE_URL}/${raw.id}`,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    salaryMin: typeof raw.salary_min === "number" && raw.salary_min > 0 ? raw.salary_min : null,
    salaryMax: typeof raw.salary_max === "number" && raw.salary_max > 0 ? raw.salary_max : null,
  }
}

/**
 * Fetch the feed (optionally narrowed to one tag) and return job cards with
 * the leading legal/attribution element stripped out.
 */
export async function fetchFeed(tag?: string): Promise<JobCard[]> {
  const url = tag ? `${API_URL}?tags=${encodeURIComponent(tag)}` : API_URL
  const text = await textFetch(url)
  if (!text) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error("Feed did not return valid JSON")
  }
  if (!Array.isArray(parsed)) return []
  const cards: JobCard[] = []
  for (const raw of parsed as RawJob[]) {
    const card = rawToCard(raw)
    if (card) cards.push(card)
  }
  return cards
}

/** Fetch full job detail: prefer the feed (has full description), fall back to the HTML page. */
export async function fetchDetail(id: string): Promise<JobDetail | null> {
  const cards = await fetchFeed()
  const text = await textFetch(API_URL)
  let raw: RawJob | undefined
  if (text) {
    try {
      const parsed = JSON.parse(text) as RawJob[]
      raw = parsed.find((j) => String(j.id) === id)
    } catch {
      raw = undefined
    }
  }
  const card = cards.find((c) => c.id === id)
  if (raw && card) {
    return {
      ...card,
      description: raw.description ? stripTags(decodeHtmlEntities(raw.description)) : null,
      applyUrl: raw.apply_url ? decodeHtmlEntities(raw.apply_url) : card.url,
    }
  }
  return fetchDetailFromPage(id)
}

/**
 * Extract the inner HTML of the first element matching a class name, tracking
 * <div> nesting depth so we don't stop at the first nested closing tag.
 */
export function extractDivContent(html: string, className: string): string | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const openRe = new RegExp(`<div[^>]*class="[^"]*${escaped}[^"]*"[^>]*>`, "i")
  const open = openRe.exec(html)
  if (!open) return null

  let i = open.index + open[0].length
  let depth = 1

  while (depth > 0 && i < html.length) {
    const nextOpen = html.indexOf("<div", i)
    const nextClose = html.indexOf("</div>", i)

    if (nextClose === -1) return null

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
    } else {
      depth--
      i = nextClose + 6
    }
  }

  return html.slice(open.index + open[0].length, i - 6)
}

/** Fallback: fetch the job's own page (bare numeric ID 301-redirects to the full slug URL). */
async function fetchDetailFromPage(id: string): Promise<JobDetail | null> {
  const html = await textFetch(`${JOB_PAGE_URL}/${id}`)
  if (!html) return null

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i)
  let title = "(untitled)"
  let company: string | null = null
  if (titleMatch) {
    const raw = decodeHtmlEntities(titleMatch[1]).replace(/^Remote\s+/i, "")
    const parts = raw.split(/\s+at\s+/i)
    title = parts[0]?.trim() || raw.trim()
    company = parts[1]?.trim() || null
  }

  const descHtml = extractDivContent(html, "description")
  const description = descHtml ? stripTags(decodeHtmlEntities(descHtml)) || null : null

  return {
    id,
    title,
    company,
    location: null,
    date: null,
    url: `${JOB_PAGE_URL}/${id}`,
    tags: [],
    salaryMin: null,
    salaryMax: null,
    description,
    applyUrl: `${JOB_PAGE_URL}/${id}`,
  }
}

/** Days since a job's posting date (or Infinity if the date can't be parsed). */
export function daysSince(dateStr: string | null): number {
  if (!dateStr) return Infinity
  const posted = new Date(dateStr).getTime()
  if (isNaN(posted)) return Infinity
  return (Date.now() - posted) / 86400000
}

/** First whitespace-free token of a free-text query, lowercased — used as the single API `tags` filter. */
export function primaryTag(query: string | undefined): string | undefined {
  if (!query) return undefined
  const token = query.trim().split(/\s+/)[0]
  return token ? token.toLowerCase() : undefined
}

export function matchesQuery(card: JobCard, query: string | undefined): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const haystack = `${card.title} ${card.company ?? ""} ${card.tags.join(" ")}`.toLowerCase()
  return q.split(/\s+/).every((term) => haystack.includes(term))
}

export function matchesLocation(card: JobCard, location: string | undefined): boolean {
  if (!location) return true
  const loc = location.toLowerCase()
  if (loc === "remote" || loc === "worldwide") {
    return !card.location || /remote|worldwide|anywhere/i.test(card.location)
  }
  return !!card.location && card.location.toLowerCase().includes(loc)
}

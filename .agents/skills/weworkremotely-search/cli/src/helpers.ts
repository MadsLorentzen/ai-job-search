// Data source: We Work Remotely's public RSS feeds (weworkremotely.com/*.rss).
// No authentication required; robots.txt is fully open. Individual job HTML
// pages are behind an active Cloudflare bot-challenge, so this CLI never
// fetches them — the RSS <description> is already the complete posting (see
// ../url-reference.md), so search and detail both work off the feed alone.

export const BASE_URL = "https://weworkremotely.com"
export const ALL_JOBS_FEED = `${BASE_URL}/remote-jobs.rss`

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
        Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
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
  region: string | null
  category: string | null
  date: string | null
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
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

/** RSS description is HTML-entity-encoded HTML: decode once, then strip tags. */
export function cleanDescription(raw: string): string {
  return stripTags(decodeHtmlEntities(raw))
}

/** Split a WWR item title of the form "Company: Job Title" into its parts. */
export function splitTitle(title: string): { company: string | null; position: string } {
  const idx = title.indexOf(": ")
  if (idx === -1) return { company: null, position: title.trim() }
  return { company: title.slice(0, idx).trim(), position: title.slice(idx + 2).trim() }
}

/** The trailing path segment of a weworkremotely.com job URL doubles as this CLI's id. */
export function slugFromUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, "")
  const parts = trimmed.split("/")
  return parts[parts.length - 1] || trimmed
}

function tagText(chunk: string, tag: string): string | null {
  const m = chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"))
  return m ? m[1].trim() : null
}

/** Parse an RSS 2.0 feed into job cards, splitting each <item> independently. */
export function parseFeed(xml: string): JobCard[] {
  const cards: JobCard[] = []
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || []
  for (const chunk of items) {
    const rawTitle = tagText(chunk, "title")
    const link = tagText(chunk, "link")
    if (!rawTitle || !link) continue
    const { company, position } = splitTitle(decodeHtmlEntities(rawTitle))
    cards.push({
      id: slugFromUrl(link),
      title: position,
      company,
      region: tagText(chunk, "region"),
      category: tagText(chunk, "category"),
      date: tagText(chunk, "pubDate"),
      url: link,
    })
  }
  return cards
}

/** Parse an RSS feed into full job details (description included, already complete per the source). */
export function parseFeedDetail(xml: string): JobDetail[] {
  const details: JobDetail[] = []
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || []
  for (const chunk of items) {
    const rawTitle = tagText(chunk, "title")
    const link = tagText(chunk, "link")
    if (!rawTitle || !link) continue
    const { company, position } = splitTitle(decodeHtmlEntities(rawTitle))
    const rawDesc = tagText(chunk, "description")
    details.push({
      id: slugFromUrl(link),
      title: position,
      company,
      region: tagText(chunk, "region"),
      category: tagText(chunk, "category"),
      date: tagText(chunk, "pubDate"),
      url: link,
      description: rawDesc ? cleanDescription(rawDesc) : null,
    })
  }
  return details
}

/** Days since an RFC 822 pubDate (or Infinity if unparseable). */
export function daysSince(dateStr: string | null): number {
  if (!dateStr) return Infinity
  const posted = new Date(dateStr).getTime()
  if (isNaN(posted)) return Infinity
  return (Date.now() - posted) / 86400000
}

export function matchesQuery(card: JobCard, query: string | undefined): boolean {
  if (!query) return true
  const haystack = `${card.title} ${card.company ?? ""} ${card.category ?? ""}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((term) => haystack.includes(term))
}

export function matchesRegion(card: JobCard, region: string | undefined): boolean {
  if (!region) return true
  return !!card.region && card.region.toLowerCase().includes(region.toLowerCase())
}

/** Build the feed URL for a category slug, or the all-jobs feed when omitted. */
export function feedUrlForCategory(category: string | undefined): string {
  if (!category) return ALL_JOBS_FEED
  const slug = category.startsWith("remote-") ? category : `remote-${category}`
  const withSuffix = slug.endsWith("-jobs") ? slug : `${slug}-jobs`
  return `${BASE_URL}/categories/${withSuffix}.rss`
}

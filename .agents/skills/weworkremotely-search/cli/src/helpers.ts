// Data source: We Work Remotely's public RSS feeds. No authentication required.
// The all-jobs feed and each category feed return the ~99 most recent live postings as
// RSS <item> elements. There is no server-side keyword search, so we fetch once and
// filter client-side by query.

export const ALL_JOBS_FEED = "https://weworkremotely.com/remote-jobs.rss"

/** Known category slugs -> RSS feed URL. Pass any of these keys to --category. */
export const CATEGORY_FEEDS: Record<string, string> = {
  programming: "https://weworkremotely.com/categories/remote-programming-jobs.rss",
  "full-stack-programming": "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
  "front-end-programming": "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
  "back-end-programming": "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
  design: "https://weworkremotely.com/categories/remote-design-jobs.rss",
  "devops-sysadmin": "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
  "sales-and-marketing": "https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss",
  "customer-support": "https://weworkremotely.com/categories/remote-customer-support-jobs.rss",
  "business-exec": "https://weworkremotely.com/categories/remote-business-exec-jobs.rss",
  copywriting: "https://weworkremotely.com/categories/remote-copywriting-jobs.rss",
  "finance-legal": "https://weworkremotely.com/categories/remote-finance-legal-jobs.rss",
  "all-other": "https://weworkremotely.com/categories/remote-all-other-jobs.rss",
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; weworkremotely-search-cli/1.0)"

/** Fetch RSS XML with exponential backoff on 429/5xx. */
export async function fetchFeed(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/rss+xml, application/xml, text/xml",
      },
      redirect: "follow",
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
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  category: string | null
  type: string | null
  region: string | null
  date: string | null
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
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

function tag(chunk: string, name: string): string | null {
  const m = chunk.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"))
  if (!m) return null
  const inner = m[1].trim()
  if (!inner) return null
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/)
  return decodeHtmlEntities(cdata ? cdata[1] : inner)
}

/** Slugified job ID derived from the WWR job URL, e.g. "mathmo-maths-coach". */
function idFromUrl(url: string): string {
  const m = url.match(/\/remote-jobs\/([^/?]+)/)
  return m ? m[1] : url
}

/** Parse the RSS <item> list into structured job cards. */
export function parseItems(xml: string): { chunk: string; card: JobCard }[] {
  const items = xml.split(/<item>/).slice(1).map((c) => c.split(/<\/item>/)[0])
  const results: { chunk: string; card: JobCard }[] = []

  for (const chunk of items) {
    const rawTitle = tag(chunk, "title")
    if (!rawTitle) continue
    const url = tag(chunk, "link") || tag(chunk, "guid") || ""
    if (!url) continue

    let company: string | null = null
    let title = rawTitle
    const sep = rawTitle.indexOf(": ")
    if (sep > 0) {
      company = rawTitle.slice(0, sep).trim()
      title = rawTitle.slice(sep + 2).trim()
    }

    results.push({
      chunk,
      card: {
        id: idFromUrl(url),
        title,
        company,
        category: tag(chunk, "category"),
        type: tag(chunk, "type"),
        region: tag(chunk, "region"),
        date: tag(chunk, "pubDate"),
        url,
      },
    })
  }

  return results
}

export function parseDescription(chunk: string): string | null {
  const raw = tag(chunk, "description")
  if (!raw) return null
  const withBreaks = raw
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim() || null
}

/** Client-side keyword match across title, company, category, type, and description. */
export function matchesQuery(card: JobCard, chunk: string, query: string): boolean {
  const q = query.toLowerCase()
  const haystack = [card.title, card.company || "", card.category || "", card.type || "", parseDescription(chunk) || ""]
    .join(" ")
    .toLowerCase()
  return haystack.includes(q)
}

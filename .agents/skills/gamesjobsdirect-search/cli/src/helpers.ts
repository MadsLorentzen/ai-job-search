// Data source: https://www.gamesjobsdirect.com (UK-headquartered, international
// games-industry job board). No API found — `/results` and `/job/.../.../<id>` are
// plain server-rendered HTML (ASP.NET MVC). See url-reference.md for how the search
// URL and the JobPosting JSON-LD block on detail pages were found, and for the two
// quirks this file works around: the detail JSON-LD is not valid JSON, and invalid
// job ids return HTTP 200 (an "expired" page) instead of 404.

export const BASE_URL = "https://www.gamesjobsdirect.com"
export const SEARCH_URL = `${BASE_URL}/results`

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// robots.txt sets `Crawl-Delay: 5` for the generic user-agent this CLI matches.
// Enforced as a minimum gap between the *start* of any two requests this process
// makes (search and detail alike), on top of the retry backoff below.
const CRAWL_DELAY_MS = 5000
let lastRequestAt = 0

async function respectCrawlDelay(): Promise<void> {
  const wait = lastRequestAt + CRAWL_DELAY_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastRequestAt = Date.now()
}

/** Fetch HTML with exponential backoff on 429/5xx. The site does not 404 on bad
 * ids (see url-reference.md), so a non-2xx here means a real transport/server error. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await respectCrawlDelay()
    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      })
    } catch (e) {
      throw new Error(`could not reach ${url} (${e instanceof Error ? e.message : String(e)})`)
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await sleep(delay + jitter)
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
  location: string | null
  date: string | null
  url: string
  category: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
  employmentType: string | null
  workHours: string | null
  deadline: string | null
  industry: string | null
  applyUrl: string | null
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

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html))
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
}

/** "Posted - 16 Jun 2026" -> "2026-06-16". Returns null if the format doesn't match. */
function parsePostedDate(text: string): string | null {
  const m = text.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/)
  if (!m) return null
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()]
  if (!month) return null
  return `${m[3]}-${month}-${m[1].padStart(2, "0")}`
}

/** Map a requested "posted within N days" window to the site's fixed age buckets
 * (0, 1, 7, 14, 30 — 999 means "older than 30 days" and is never used here). */
export function mapJobAge(days: number | undefined): string {
  if (!days || days <= 0) return "0"
  if (days <= 1) return "1"
  if (days <= 7) return "7"
  if (days <= 14) return "14"
  return "30"
}

/** Absolute job-detail URL. The two slug segments are cosmetic (see url-reference.md). */
export function detailUrl(id: string): string {
  return `${BASE_URL}/job/listing/listing/${id}`
}

/**
 * Parse the search results page: a flat list of job cards. Splits on each card's
 * opening `<li class="list-group-item job-list` and parses chunks independently so
 * one malformed card cannot break the rest.
 */
export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []
  const chunks = html.split(/<li class="list-group-item job-list/).slice(1)

  for (const chunk of chunks) {
    const linkMatch = chunk.match(/href="([^"]+)"[^>]*class="job-title"/i)
    if (!linkMatch) continue
    const href = decodeHtmlEntities(linkMatch[1])
    const idMatch = href.match(/\/job\/[^/]+\/[^/]+\/(\d+)/)
    if (!idMatch) continue
    const id = idMatch[1]

    const titleAttr = chunk.match(/class="job-title"[^>]*title="([^"]*)"/i)
    const titleText = chunk.match(/class="job-title"[^>]*>([\s\S]*?)<\/a>/i)
    const title = titleAttr ? clean(titleAttr[1]) : titleText ? clean(titleText[1]) : null
    if (!title) continue

    const location = chunk.match(/class="job-location"[^>]*>([\s\S]*?)<\/span>/i)
    const company = chunk.match(/class="job-company"[^>]*>([\s\S]*?)<\/span>/i)
    const category = chunk.match(/class="job-sector"[^>]*>([\s\S]*?)<\/span>/i)
    const posted = chunk.match(/class="job-posteddate"[^>]*>([\s\S]*?)<\/p>/i)

    results.push({
      id,
      title,
      company: company ? clean(company[1]) || null : null,
      location: location ? clean(location[1]) || null : null,
      date: posted ? parsePostedDate(clean(posted[1])) : null,
      url: href.startsWith("http") ? href : `${BASE_URL}${href}`,
      category: category ? clean(category[1]) || null : null,
    })
  }

  return results
}

/** Extract the `<script type="application/ld+json">...</script>` JobPosting block's
 * raw text, or null if the page has none (bad/expired id — see url-reference.md). */
function extractJobPostingBlock(html: string): string | null {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)
  if (!m) return null
  return m[1].includes('"@type": "JobPosting"') || m[1].includes('"@type":"JobPosting"') ? m[1] : null
}

/** The JSON-LD block is not valid JSON (stray semicolons — see url-reference.md), so
 * fields are pulled out with targeted regexes scoped to the block's own text. */
export function parseJobDetail(html: string, id: string): JobDetail | null {
  const block = extractJobPostingBlock(html)
  if (!block) return null

  const field = (name: string): string | null => {
    const m = block.match(new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`))
    return m ? m[1] : null
  }

  const title = field("title")
  const rawDescription = block.match(/"description"\s*:\s*"([\s\S]*?)",?\s*\n\s*"employmentType"/)
  let description: string | null = null
  if (rawDescription) {
    const withBreaks = decodeHtmlEntities(rawDescription[1])
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|h\d|strong)>/gi, "\n")
    description = stripTags(withBreaks).replace(/\n{3,}/g, "\n\n").trim() || null
  }

  const localityMatch = block.match(/"addressLocality"\s*:\s*"([^"]*)"/)
  const orgMatch = block.match(/"hiringOrganization"\s*:\s*\{[\s\S]*?"name"\s*:\s*"([^"]*)"/)

  // The apply button's href carries the job's real slug even when this page was
  // fetched via the cosmetic /job/listing/listing/<id> URL (see url-reference.md).
  const applyMatch = html.match(/href="(\/details\/redirect\/[^"]+)"/i)
  const applyUrl = applyMatch ? `${BASE_URL}${decodeHtmlEntities(applyMatch[1])}` : null

  return {
    id,
    title: title ? clean(title) : "(untitled)",
    company: orgMatch ? clean(orgMatch[1]) || null : null,
    location: localityMatch ? clean(localityMatch[1]) || null : null,
    date: field("datePosted"),
    url: detailUrl(id),
    category: field("industry"),
    description,
    employmentType: field("employmentType"),
    workHours: field("workHours"),
    deadline: field("validThrough"),
    industry: field("industry"),
    applyUrl,
  }
}

// Data source: Jobsdb Hong Kong public search and job-detail pages.
// No authentication required. Both pages are server-rendered HTML with stable
// data-* attributes, so we parse them with regex. A DOM parser is unnecessary
// and would add a runtime dependency.

export const BASE_URL = "https://hk.jobsdb.com"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
  employmentType: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
  salary: string | null
  applyUrl: string | null
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

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html))
}

/**
 * Extract the inner HTML of a <div> identified by a `data-automation` value,
 * correctly handling nested <div> elements by tracking tag depth.
 */
export function extractDivByAutomation(html: string, automation: string): string | null {
  const openRe = new RegExp(`<div[^>]*data-automation="${automation}"[^>]*>`, "i")
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

export function slugifyQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function slugifyLocation(location: string): string {
  const slug = location.trim().replace(/\s+/g, "-")
  return slug ? `in-${slug}` : ""
}

/** Map a free-form job-age request to Jobsdb's supported daterange values. */
export function jobageToDateRange(days: number): number | null {
  if (!days || days <= 0) return null
  if (days <= 1) return 1
  if (days <= 3) return 3
  if (days <= 7) return 7
  if (days <= 14) return 14
  if (days <= 31) return 31
  return null
}

/**
 * Extract id -> listing date (ISO, YYYY-MM-DD) from the embedded JSON state
 * blob: "id":"93743418","isFeatured":false,"listingDate":"2026-08-04T03:12:07.000Z".
 * The visible card text only carries spelled-out relative dates
 * ("Listed forty nine minutes ago"), which do not sort or dedup well, so the
 * JSON blob is the primary date source and the card text is the fallback.
 */
export function parseListingDates(html: string): Map<string, string> {
  const map = new Map<string, string>()
  const re = /"id":"(\d+)","isFeatured":(?:true|false),"listingDate":"([^"]+)"/g
  for (const m of html.matchAll(re)) {
    map.set(m[1], m[2].slice(0, 10))
  }
  return map
}

/**
 * Parse the search response: split into per-card chunks on data-testid="job-card"
 * so one malformed card cannot break the rest.
 */
export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []
  const listingDates = parseListingDates(html)
  // Use a zero-width lookahead so the opening <article ...> tag (with id/title
  // attributes) stays inside each chunk.
  const chunks = html.split(/(?=<article[^>]*data-testid="job-card"[^>]*>)/i).slice(1)

  for (const chunk of chunks) {
    const idMatch = chunk.match(/data-job-id="(\d+)"/)
    if (!idMatch) continue
    const id = idMatch[1]

    const title =
      chunk.match(/aria-label="([^"]+)"/)?.[1] ??
      chunk.match(/data-automation="jobTitle"[^>]*>([^<]+)</i)?.[1] ??
      null
    if (!title) continue

    let url: string | null = null
    const linkMatch = chunk.match(/data-automation="job-list-view-job-link"[^>]*href="([^"]+)"/i)
    if (linkMatch) {
      url = `${BASE_URL}${decodeHtmlEntities(linkMatch[1]).replace(/&amp;/g, "&")}`
    } else {
      url = `${BASE_URL}/job/${id}?type=standard&ref=search-standalone`
    }

    const company =
      chunk.match(/data-automation="jobCompany"[^>]*>([^<]+)</i)?.[1] ?? null
    const location =
      chunk.match(/data-automation="jobLocation"[^>]*>([^<]+)</i)?.[1] ?? null
    const date =
      listingDates.get(id) ??
      (chunk.match(/>Listed\s+([^<]+)</i)?.[1] ?? null)
    const employmentType = chunk.match(/>This is a ([^<]+) job</i)?.[1] ?? null

    results.push({
      id,
      title: clean(title),
      company: company ? clean(company) : null,
      location: location ? clean(location) : null,
      // ISO date from the JSON blob when available, else the card's "Listed ..." text
      date: date ? (/^\d{4}-/.test(date) ? date : `Listed ${clean(date)}`) : null,
      url,
      employmentType: employmentType ? clean(employmentType) : null,
    })
  }

  return results
}

/** Parse the single-job detail page. */
export function parseJobDetail(html: string, id: string): JobDetail {
  const title =
    html.match(/data-automation="job-detail-title"[^>]*>([^<]+)</i)?.[1] ?? null
  const company =
    html.match(/data-automation="advertiser-name"[^>]*>([^<]+)</i)?.[1] ?? null
  const location =
    clean(html.match(/data-automation="job-detail-location"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "") || null
  const employmentType =
    clean(html.match(/data-automation="job-detail-work-type"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "") || null
  const salary =
    clean(html.match(/data-automation="job-detail-salary"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "") || null

  let description: string | null = null
  const descHtml = extractDivByAutomation(html, "jobAdDetails")
  if (descHtml) {
    const withBreaks = descHtml
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
    description = clean(withBreaks)
      .replace(/\n{3,}/g, "\n\n")
      .trim()
    if (!description) description = null
  }

  const applyMatch = html.match(/href="(\/job\/\d+\/apply)"/)
  const applyUrl = applyMatch ? `${BASE_URL}${applyMatch[1]}` : `${BASE_URL}/job/${id}/apply`

  return {
    id,
    title: title ? clean(title) : "(untitled)",
    company: company ? clean(company) : null,
    location: location ? clean(location) : null,
    date: null,
    url: `${BASE_URL}/job/${id}?type=standard`,
    employmentType: employmentType ? clean(employmentType) : null,
    description,
    salary: salary ? clean(salary) : null,
    applyUrl,
  }
}

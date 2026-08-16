// Data source: Randstad India public job board (https://www.randstad.in/jobs/).
// The site is a Next.js app; the search-results page server-renders its job list
// inside an RSC (React Server Components) stream. We locate the embedded
// `"results":[ ... ]` payload, split it into per-job chunks on the `languageCode`
// marker, and parse each chunk independently so one malformed job cannot break
// the rest. No authentication and zero runtime dependencies.

export const BASE_URL = "https://www.randstad.in"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; randstad-india-search-cli/1.0)"

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
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
  employmentType: string | null
  url: string
}

export interface JobDetail extends JobCard {
  displayId: string | null
  description: string | null
}

function decodeUnicode(text: string): string {
  return text
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u0027/gi, "'")
    .replace(/\\u0022/gi, '"')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, c) => String.fromCharCode(parseInt(c, 16)))
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

/** Extract the UUID that ends a Randstad job-detail URL. */
export function idFromUrl(url: string): string | null {
  const m = url.match(/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?/i)
  return m ? m[1] : null
}

function firstMatch(chunk: string, re: RegExp): string | null {
  const m = chunk.match(re)
  return m ? m[1] : null
}

/**
 * Parse the search-results RSC payload. We unescape the stream's `\"` quoting,
 * locate the `"results":[` array, then split into per-job chunks on the
 * `{"languageCode":` object marker and parse each chunk with independent regexes.
 */
export function parseJobCards(html: string): JobCard[] {
  const unescaped = html.replace(/\\"/g, '"')
  const anchor = unescaped.indexOf('"results":[{"languageCode"')
  if (anchor === -1) return []
  const region = unescaped.slice(anchor)
  const chunks = region.split('{"languageCode":').slice(1)

  const results: JobCard[] = []
  for (const chunk of chunks) {
    const url = firstMatch(chunk, /"postedUrl":\[\{"href":"([^"]+)"/)
    if (!url) continue
    const id = idFromUrl(url)
    if (!id) continue

    const title = firstMatch(chunk, /"jobTitle":"([^"]*)"/)
    if (!title) continue

    const company = firstMatch(chunk, /"clientDetail":\{[^}]*?"name":"([^"]*)"/)
    const locality = firstMatch(chunk, /"locality":"([^"]*)"/)
    const area = firstMatch(chunk, /"administrativeArea":"([^"]*)"/)
    const location = [locality, area].filter(Boolean).join(", ") || null
    const date = firstMatch(chunk, /"postingTime":"([^"]*)"/)
    const employmentType = firstMatch(chunk, /"jobTypes":\["([^"]*)"/)

    results.push({
      id,
      title: title.trim(),
      company: company ? company.trim() : null,
      location: location ? titleCase(location) : null,
      date,
      employmentType,
      url: url.split("?")[0],
    })
  }
  return results
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Parse a single job-detail page. The rich description lives in a lazily-referenced
 * RSC text row: `description":{"description":"$<ref>"` points to a row
 * `<ref>:T<hexlen>,<html>`. We resolve the reference and clean the HTML to text.
 */
export function parseJobDetail(html: string, fallbackUrl: string): JobDetail {
  const u = html.replace(/\\"/g, '"')

  const title = firstMatch(u, /"jobTitle":"([^"]*)"/)
  const company = firstMatch(u, /"clientDetail":\{[^}]*?"name":"([^"]*)"/)
  const locality = firstMatch(u, /"locality":"([^"]*)"/)
  const area = firstMatch(u, /"administrativeArea":"([^"]*)"/)
  const location = [locality, area].filter(Boolean).join(", ") || null
  const date = firstMatch(u, /"postingTime":"([^"]*)"/)
  const employmentType = firstMatch(u, /"jobTypes":\["([^"]*)"/)
  const displayId = firstMatch(u, /"displayId":"([^"]*)"/)

  let description: string | null = null
  const ref = firstMatch(u, /"description":\{"description":"\$([0-9a-f]+)"/i)
  if (ref) {
    const rowRe = new RegExp("\\\\n" + ref + ":T[0-9a-f]+,")
    const rowMatch = html.match(rowRe)
    if (rowMatch && rowMatch.index !== undefined) {
      const start = rowMatch.index + rowMatch[0].length
      const rest = html.slice(start)
      const endMatch = rest.match(/"\]\)<\/script>|\\n[0-9a-f]+:[T\[I{]/)
      const raw = endMatch && endMatch.index !== undefined ? rest.slice(0, endMatch.index) : rest
      const withBreaks = decodeUnicode(raw)
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/<\s*br\s*\/?>/gi, "\n")
        .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
      description =
        decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim() || null
    }
  }
  if (!description) {
    const short = firstMatch(u, /"shortDescription":"((?:[^"\\]|\\.)*)"/)
    if (short) description = decodeHtmlEntities(decodeUnicode(short).replace(/\\n/g, "\n")).trim()
  }

  const id = idFromUrl(fallbackUrl) || "(unknown)"
  return {
    id,
    title: title ? title.trim() : "(untitled)",
    company: company ? company.trim() : null,
    location: location ? titleCase(location) : null,
    date,
    employmentType,
    url: fallbackUrl.split("?")[0],
    displayId,
    description,
  }
}

/** Slugify a location for the `ci-<city>` path segment. */
export function citySlug(location: string): string {
  return location
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

/** Client-side filter: keep jobs posted within `days` days. */
export function withinJobAge(cards: JobCard[], days: number): JobCard[] {
  if (!days || days <= 0 || days >= 9999) return cards
  const cutoff = Date.now() - days * 86400_000
  return cards.filter((c) => {
    if (!c.date) return false
    const t = Date.parse(c.date)
    return isNaN(t) ? true : t >= cutoff
  })
}

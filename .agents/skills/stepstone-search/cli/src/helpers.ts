// Data source: stepstone.de's public search-results pages and job-detail pages
// (SSR'd HTML, no JSON API exposed to unauthenticated clients). robots.txt allows
// GET /jobs/<any-slug>[/in-<city>]?q=<query> (a single "q" param only — no extra
// query params) and GET /stellenangebote--<any-slug>--<id>-inline.html (slug is
// ignored server-side; only the trailing numeric id matters). We parse both with
// regex: the markup is deeply nested CSS-in-JS noise, but every field of interest
// sits behind a stable `data-at="..."` marker, so we locate the marker and then
// grab the first plain-text leaf that follows it rather than modeling the nesting.

export const SEARCH_BASE = "https://www.stepstone.de/jobs"
export const DETAIL_BASE = "https://www.stepstone.de/stellenangebote"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
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
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
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

/**
 * Build the search URL. robots.txt only allows a bare `?q=` query string on
 * `/jobs/*` paths (no `&page=`, `&age=`, etc.), so location is folded into the
 * path as `/in-<city-slug>` (Stepstone resolves this server-side to a ~30km
 * radius search) rather than passed as a second query param.
 */
export function buildSearchUrl(query: string, location?: string): string {
  const querySlug = slugify(query) || "jobs"
  const locationSegment = location ? `/in-${slugify(location)}` : ""
  return `${SEARCH_BASE}/${querySlug}${locationSegment}?q=${encodeURIComponent(query)}`
}

/** Build the detail URL. The slug is decorative — only the numeric id resolves. */
export function buildDetailUrl(id: string): string {
  return `${DETAIL_BASE}--job--${id}-inline.html`
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
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

/**
 * From `fromIndex`, scan forward for the first inter-tag text run (`>text<`)
 * that isn't just whitespace. Every field of interest on this markup sits a
 * few empty wrapper tags (icons, style blocks, layout divs) below its
 * `data-at="..."` marker with no other text in between, so the first non-empty
 * leaf is reliably the field's value — this avoids hand-modeling the nesting
 * depth, which varies field to field and breaks whenever Stepstone's component
 * library changes a wrapper.
 */
export function firstLeafText(html: string, fromIndex: number, maxWindow = 4000): string | null {
  // Strip <style>...</style> blocks first — this markup inlines a CSS-in-JS
  // <style> tag before almost every field's actual content, and raw CSS text
  // routinely contains bare ">" (child combinator) and "<" characters that
  // otherwise get mistaken for a leaf text node.
  const window = html.slice(fromIndex, fromIndex + maxWindow).replace(/<style[\s\S]*?<\/style>/gi, "")
  const re = />([^<>]+)</g
  let m: RegExpExecArray | null
  while ((m = re.exec(window)) !== null) {
    const text = decodeHtmlEntities(m[1]).trim()
    if (text) return text
  }
  return null
}

/**
 * Parse "vor 4 Tagen" / "vor 2 Wochen" / "Heute" / "Gestern" style relative
 * timestamps into an ISO date. Stepstone does not expose an absolute posting
 * date in the search-results markup.
 */
export function parseGermanRelativeDate(text: string | null, now: Date = new Date()): string | null {
  if (!text) return null
  const t = text.trim().toLowerCase()
  const daysAgo = (n: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() - n)
    return d.toISOString().slice(0, 10)
  }
  if (/^heute|gerade\s+veröffentlicht|jetzt/.test(t)) return daysAgo(0)
  if (/^gestern/.test(t)) return daysAgo(1)
  let m = t.match(/vor\s+(\d+)\s+stunde/)
  if (m) return daysAgo(0)
  m = t.match(/vor\s+(\d+)\s+tag/)
  if (m) return daysAgo(parseInt(m[1], 10))
  m = t.match(/vor\s+(\d+)\s+woche/)
  if (m) return daysAgo(parseInt(m[1], 10) * 7)
  m = t.match(/vor\s+(\d+)\s+monat/)
  if (m) return daysAgo(parseInt(m[1], 10) * 30)
  return null
}

/**
 * Parse the search-results page. Each result is an `<article data-at="job-item"
 * id="job-item-<id>">`; we split on that marker so one malformed card cannot
 * break the rest, then locate each field's `data-at="job-item-*"` marker within
 * the card and read the first leaf text after it.
 */
export function parseSearchResults(html: string): { total: number | null; results: JobCard[] } {
  const totalMatch = html.match(/data-resultlist-offers-total="(\d+)"/)
  const total = totalMatch ? parseInt(totalMatch[1], 10) : null

  const results: JobCard[] = []
  const cardRe = /<article[^>]*\bid="job-item-(\d+)"[^>]*\bdata-at="job-item"[^>]*>/g
  const starts: { id: string; index: number }[] = []
  let cm: RegExpExecArray | null
  while ((cm = cardRe.exec(html)) !== null) {
    starts.push({ id: cm[1], index: cm.index })
  }

  for (let i = 0; i < starts.length; i++) {
    const { id, index } = starts[i]
    const end = i + 1 < starts.length ? starts[i + 1].index : html.length
    const chunk = html.slice(index, end)

    const titleMatch = chunk.match(/<a[^>]*\bhref="([^"]+)"[^>]*\bdata-at="job-item-title"[^>]*>/)
    if (!titleMatch) continue
    const href = decodeHtmlEntities(titleMatch[1])
    const url = href.startsWith("http") ? href : `https://www.stepstone.de${href}`
    const title = firstLeafText(chunk, titleMatch.index! + titleMatch[0].length)
    if (!title) continue

    const companyIdx = chunk.indexOf('data-at="job-item-company-name"')
    const company = companyIdx >= 0 ? firstLeafText(chunk, companyIdx) : null

    const locationIdx = chunk.indexOf('data-at="job-item-location"')
    const location = locationIdx >= 0 ? firstLeafText(chunk, locationIdx) : null

    const timeagoIdx = chunk.indexOf('data-at="job-item-timeago"')
    const timeagoText = timeagoIdx >= 0 ? firstLeafText(chunk, timeagoIdx) : null

    const badgeIdx = chunk.indexOf('data-at="job-item-badge"')
    const employmentType = badgeIdx >= 0 ? firstLeafText(chunk, badgeIdx) : null

    results.push({
      id,
      title,
      company,
      location,
      date: parseGermanRelativeDate(timeagoText),
      url,
      employmentType,
    })
  }

  return { total, results }
}

/** Parse a single job's detail page (the `-inline.html` variant). */
export function parseJobDetail(html: string, id: string): JobDetail {
  const titleIdx = html.indexOf('data-at="header-job-title"')
  const title = titleIdx >= 0 ? firstLeafText(html, titleIdx) : null

  const companyIdx = html.indexOf('data-at="metadata-company-name"')
  const company = companyIdx >= 0 ? firstLeafText(html, companyIdx) : null

  const locationIdx = html.indexOf('data-at="metadata-location"')
  const location = locationIdx >= 0 ? firstLeafText(html, locationIdx) : null

  // The "Gehalt" (salary) section, when Stepstone estimates one, renders a
  // heading ("Gehalt") before the actual value — search from the value's own
  // content marker, not the section's outer marker, or firstLeafText would
  // just return the heading text every time. Most postings don't have a
  // computed estimate at all and show a "reveal salary" teaser CTA instead
  // (e.g. "Neugierig auf das Gehalt für diesen Job?") — that's not a value.
  const salaryIdx = html.indexOf('data-at="section-text-gehalt-content"')
  const rawSalary = salaryIdx >= 0 ? firstLeafText(html, salaryIdx, 6000) : null
  const salary = rawSalary && !/neugierig|gehalt anzeigen/i.test(rawSalary) ? rawSalary : null

  let description: string | null = null
  const contentIdx = html.indexOf('data-at="job-ad-content"')
  if (contentIdx >= 0) {
    // Skip past the opening tag itself (slicing from the attribute string
    // would leave `data-at="job-ad-content">` as orphaned literal text once
    // tags are stripped, since it isn't preceded by its own "<").
    const contentTagEnd = html.indexOf(">", contentIdx) + 1
    // Bound the slice at whichever known section follows content first — the
    // salary teaser and the company card both sit after it in document order.
    // Back up to that section's own opening "<" (not the attribute string's
    // index) so the slice doesn't end mid-tag and leave an unclosed `<div
    // ...` as orphaned literal text once tags are stripped.
    const boundaries = [
      html.indexOf('data-at="job-ad-salary"', contentTagEnd),
      html.indexOf('data-at="job-ad-company-card"', contentTagEnd),
    ]
      .filter((i) => i > contentTagEnd)
      .map((i) => html.lastIndexOf("<", i))
    const rawEnd = boundaries.length > 0 ? Math.min(...boundaries) : contentTagEnd + 40000
    const raw = html.slice(contentTagEnd, rawEnd)
    const withoutStyles = raw.replace(/<style[\s\S]*?<\/style>/gi, " ")
    const withBreaks = withoutStyles
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|h\d|article)>/gi, "\n")
    description =
      decodeHtmlEntities(stripTags(withBreaks)).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() || null
  }

  return {
    id,
    title: title || "(untitled)",
    company,
    location,
    date: null,
    url: buildDetailUrl(id),
    employmentType: null,
    description,
    salary,
    applyUrl: buildDetailUrl(id),
  }
}

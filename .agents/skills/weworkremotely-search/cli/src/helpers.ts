// Data source: We Work Remotely public RSS feeds.
//   https://weworkremotely.com/remote-jobs.rss           (all categories, 100 items)
//   https://weworkremotely.com/categories/<slug>.rss     (per-category)
//
// This is the one portal here with real SERVER-SIDE filtering: choosing a
// category feed genuinely narrows the source. Keyword and region filtering are
// still client-side, since RSS offers no query parameters.
//
// Parsing is regex over per-<item> chunks (no XML dependency): the feed is
// shallow and stable, and each item is parsed independently so one malformed
// entry cannot break the rest.

export const ALL_FEED = "https://weworkremotely.com/remote-jobs.rss"
export const CATEGORY_FEED = "https://weworkremotely.com/categories"

/** Category slugs verified live on 2026-08-04 (all returned HTTP 200). */
export const CATEGORIES = [
  "remote-programming-jobs",
  "remote-design-jobs",
  "remote-devops-sysadmin-jobs",
  "remote-customer-support-jobs",
  "remote-sales-and-marketing-jobs",
  "remote-product-jobs",
  "remote-management-and-finance-jobs",
  "all-other-remote-jobs",
] as const

/** Accept a bare word ("programming") as well as the full slug. */
export function resolveCategory(input: string): string | null {
  const v = input.trim().toLowerCase()
  if ((CATEGORIES as readonly string[]).includes(v)) return v
  const guess = `remote-${v}-jobs`
  if ((CATEGORIES as readonly string[]).includes(guess)) return guess
  const partial = CATEGORIES.find((c) => c.includes(v))
  return partial ?? null
}

export function feedUrl(category: string | undefined): string {
  if (!category) return ALL_FEED
  return `${CATEGORY_FEED}/${category}.rss`
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

/** Fetch text with exponential backoff + jitter on 429/5xx. Returns "" on 404. */
export async function textFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
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
  category: string | null
  jobType: string | null
  skills: string | null
  region: string | null
  country: string | null
  source: "We Work Remotely"
}

export interface JobDetail extends JobCard {
  description: string | null
  applyUrl: string | null
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
    // &amp; LAST so "&amp;lt;" decodes to "&lt;" rather than being over-decoded.
    .replace(/&amp;/g, "&")
}

export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim()
}

/** Pull the text of a single RSS tag out of one <item> chunk. */
export function tagText(chunk: string, tag: string): string | null {
  const m = chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"))
  if (!m) return null
  let raw = m[1]!.trim()
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)
  if (cdata) raw = cdata[1]!.trim()
  const decoded = decodeHtmlEntities(raw).trim()
  return decoded || null
}

/**
 * WWR encodes the employer in the <title> as "Company: Job Title". Split on the
 * FIRST colon only — job titles routinely contain further colons
 * ("Engineer: Platform"), and company names can contain commas but not colons.
 */
export function splitTitle(rawTitle: string): { company: string | null; title: string } {
  const idx = rawTitle.indexOf(":")
  if (idx === -1) return { company: null, title: rawTitle.trim() }
  const company = rawTitle.slice(0, idx).trim()
  const title = rawTitle.slice(idx + 1).trim()
  if (!company || !title) return { company: null, title: rawTitle.trim() }
  return { company, title }
}

/** The stable id is the slug at the end of the posting URL. */
export function idFromLink(link: string): string | null {
  const m = link.match(/remote-jobs\/([^/?#]+)/i)
  return m ? m[1]! : null
}

export function toIsoDate(pubDate: string | null): string | null {
  if (!pubDate) return null
  const t = Date.parse(pubDate)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/**
 * Parse the feed into cards. Splits on <item> and parses each chunk
 * independently so a single malformed entry cannot break the rest.
 */
export function parseFeed(xml: string): JobCard[] {
  if (!xml) return []
  const chunks = xml.split(/<item>/i).slice(1)
  const out: JobCard[] = []

  for (const rest of chunks) {
    const chunk = rest.split(/<\/item>/i)[0] ?? rest
    const rawTitle = tagText(chunk, "title")
    const link = tagText(chunk, "link")
    if (!rawTitle || !link) continue

    const id = idFromLink(link)
    if (!id) continue

    const { company, title } = splitTitle(rawTitle)
    const region = tagText(chunk, "region")
    const country = tagText(chunk, "country")

    out.push({
      id,
      title,
      company,
      // Prefer the specific country, fall back to the broad eligibility region.
      location: country || region || null,
      date: toIsoDate(tagText(chunk, "pubDate")),
      url: link,
      category: tagText(chunk, "category"),
      jobType: tagText(chunk, "type"),
      skills: tagText(chunk, "skills"),
      region,
      country,
      source: "We Work Remotely",
    })
  }

  return out
}

/** Extract one item's raw <description> HTML, for the detail command. */
export function descriptionFor(xml: string, id: string): string | null {
  const chunks = xml.split(/<item>/i).slice(1)
  for (const rest of chunks) {
    const chunk = rest.split(/<\/item>/i)[0] ?? rest
    const link = tagText(chunk, "link")
    if (!link || idFromLink(link) !== id) continue
    const desc = tagText(chunk, "description")
    return desc ? htmlToText(desc) || null : null
  }
  return null
}

/** Client-side keyword filter over title, company and skills. */
export function matchesQuery(card: JobCard, query: string | undefined): boolean {
  if (!query) return true
  const haystack = [card.title, card.company, card.skills].filter(Boolean).join(" ").toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

/**
 * Client-side region filter. WWR reports both a broad <region> eligibility
 * string ("Anywhere in the World", "USA Only") and a more specific <country>.
 */
export function matchesRegion(card: JobCard, region: string | undefined): boolean {
  if (!region) return true
  const haystack = [card.region, card.country].filter(Boolean).join(" ").toLowerCase()
  if (!haystack) return false
  const want = region.trim().toLowerCase()
  if (/^(usa|us|united states)$/.test(want)) {
    return /\b(usa|u\.s\.|united states|north america|americas)\b/.test(haystack) ||
      /anywhere in the world/.test(haystack)
  }
  return haystack.includes(want)
}

export function withinJobAge(card: JobCard, days: number, now: number): boolean {
  if (!days || days <= 0 || days >= 9999) return true
  if (!card.date) return false
  const published = Date.parse(card.date)
  if (Number.isNaN(published)) return false
  return now - published <= days * 86400000
}

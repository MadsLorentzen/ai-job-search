// Data source: Next Mondays (https://nextmondays.com), a French freelance-tech
// job board. All endpoints used here are public and **allowed by robots.txt**.
//
// robots.txt disallows `/Search` (the site's keyword-search endpoint), so this CLI
// never touches it. Instead it reads the allowed listing surfaces — `/jobs/regions/*`,
// `/jobs/groups/*`, `/jobs/tags/*` — and filters by keyword client-side. The whole
// public board is small (~80 open missions), so a single listing fetch is enough.
//
// Quirk that makes this cheap: `/jobs/regions/<anything>` does NOT filter server-side;
// every region page renders the complete board. We use one region page as the
// "all missions" surface. See url-reference.md.

export const BASE = "https://nextmondays.com"

/** Region page that renders the full board (the region filter is a no-op server-side). */
export const ALL_JOBS_URL = `${BASE}/jobs/regions/%c3%8ele-de-france`

/** Job-domain groups, as published in sitemap-jobs-groups.xml. */
export const GROUPS = [
  "electronique",
  "infra & ops",
  "logiciel embarqué",
  "management",
  "test & qa",
  "web & edition",
] as const

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
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
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
  /**
   * Always `null` on this board: Next Mondays is a placement intermediary and never
   * names the end client. The anonymised client blurb is in `clientProfile`.
   */
  company: string | null
  location: string | null
  date: string | null
  url: string
  subtitle: string | null
  clientProfile: string | null
  intermediary: string
  tjm: number | null
  currency: string | null
  tags: string[]
  group: string | null
  filled: boolean
}

export interface JobDetail extends JobCard {
  description: string | null
  mission: string | null
  profile: string | null
  duration: string | null
  employmentType: string | null
  region: string | null
  keyPoints: string[]
  recruiter: string | null
  recruiterEmail: string | null
  applyUrl: string | null
}

/** Convert a Unicode code point to a string, dropping out-of-range values. */
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
    .replace(/&nbsp;/g, " ")
    // Numeric character references: decimal (&#233;) and hexadecimal (&#xE9;).
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    // &amp; last, so "&amp;#xE9;" does not decode twice.
    .replace(/&amp;/g, "&")
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim()
}

/** Strip tags and decode entities into a single whitespace-normalised line. */
export function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html)).replace(/\s+/g, " ").trim()
}

/** Strip tags but keep `<br>` / block ends as newlines, for description bodies. */
export function cleanBlock(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  // Job bodies on this board are double-encoded: the stored text contains literal
  // "&lt;br /&gt;" that decodes to a `<br />` tag, so decode first, then break again.
  const decoded = decodeHtmlEntities(stripTags(withBreaks))
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
  return decoded
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** `"680.00 €/ j"` -> `{ tjm: 680, currency: "EUR" }`. */
export function parsePricing(raw: string | null): { tjm: number | null; currency: string | null } {
  if (!raw) return { tjm: null, currency: null }
  const text = decodeHtmlEntities(raw)
  const m = text.match(/([\d\s.,]+)/)
  if (!m) return { tjm: null, currency: null }
  const value = parseFloat(m[1].replace(/\s/g, "").replace(",", "."))
  if (isNaN(value)) return { tjm: null, currency: null }
  const currency = /€|EUR/i.test(text) ? "EUR" : null
  return { tjm: value, currency }
}

/** `icon-webandedition` -> `"web & edition"`, best-effort. */
function groupFromIcon(icon: string | null): string | null {
  if (!icon) return null
  const map: Record<string, string> = {
    electronique: "electronique",
    infraandops: "infra & ops",
    logicielembarque: "logiciel embarqué",
    management: "management",
    testandqa: "test & qa",
    webandedition: "web & edition",
  }
  return map[icon] ?? icon
}

/**
 * Parse a listing page (region / group / tag) into job cards. We split on the card
 * wrapper and parse each chunk independently, so one malformed card cannot break
 * the rest of the page.
 */
export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []
  const chunks = html.split(/<div class="section-offers-list-item">/).slice(1)

  for (const chunk of chunks) {
    const link = chunk.match(/href="\/jobs\/(?!tags\/|groups\/|regions\/|ApplyFor)([^"]*?)\/?([0-9A-Za-z]+)"/i)
    if (!link) continue
    const id = link[2]
    const slug = link[1] || id

    const titleMatch = chunk.match(/class="job-title"[^>]*>([\s\S]*?)<\/h5>/i)
    const title = titleMatch ? clean(titleMatch[1]) : ""
    if (!title) continue

    const subMatch = chunk.match(/class="job-subtitle"[^>]*>([\s\S]*?)<\/h6>/i)
    const subtitle = subMatch ? clean(subMatch[1]) || null : null

    const descMatch = chunk.match(/class="job-description"[^>]*>([\s\S]*?)<\/p>/i)
    const clientProfile = descMatch ? cleanBlock(descMatch[1]) || null : null

    const priceMatch = chunk.match(/class="job-pricing"[^>]*>([\s\S]*?)<\/span>/i)
    const { tjm, currency } = parsePricing(priceMatch ? priceMatch[1] : null)

    const tags: string[] = []
    const tagRe = /class="tag-item"[^>]*>([\s\S]*?)<\/a>/gi
    let tm: RegExpExecArray | null
    while ((tm = tagRe.exec(chunk)) !== null) {
      const t = clean(tm[1])
      if (t) tags.push(t)
    }

    const iconMatch = chunk.match(/class="job-group-icon icon-([a-z0-9]+)"/i)
    const group = groupFromIcon(iconMatch ? iconMatch[1].toLowerCase() : null)

    results.push({
      id,
      title,
      company: null,
      location: null,
      date: null,
      url: `${BASE}/jobs/${slug}/${id}`,
      subtitle,
      clientProfile,
      intermediary: "Next Mondays",
      tjm,
      currency,
      tags,
      group,
      filled: /job-is-filled-container/i.test(chunk),
    })
  }

  return results
}

interface JsonLdJob {
  title?: string
  description?: string
  datePosted?: string
  employmentType?: string
  identifier?: { value?: string }
  jobLocation?: { address?: { addressLocality?: string; addressRegion?: string } }
  baseSalary?: { currency?: string; value?: { value?: number } }
}

/** Pull the schema.org JobPosting block out of a detail page. */
export function parseJsonLd(html: string): JsonLdJob | null {
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim())
      const node = Array.isArray(parsed) ? parsed.find((p) => p?.["@type"] === "JobPosting") : parsed
      if (node && node["@type"] === "JobPosting") return node as JsonLdJob
    } catch {
      // A malformed block must not abort the page — try the next one.
    }
  }
  return null
}

/** Extract the body of a `<div class="job-info-group">` whose `<h3>` matches `heading`. */
function infoGroup(html: string, heading: string): string | null {
  const re = /<div class="job-info-group">([\s\S]*?)<\/div>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const block = m[1]
    const h = block.match(/<h3>([\s\S]*?)<\/h3>/i)
    if (!h) continue
    if (clean(h[1]).toLowerCase() !== heading.toLowerCase()) continue
    const body = block.replace(/<h3>[\s\S]*?<\/h3>/i, "")
    return cleanBlock(body) || null
  }
  return null
}

/** Extract a `<div class="summary-<name>">` value (localisation, durée, domaines, tarif). */
function summaryItem(html: string, name: string): string | null {
  const m = html.match(
    new RegExp(
      `class="summary-${name}"[\\s\\S]*?class="summary-content-item-body"[^>]*>\\s*<span>([\\s\\S]*?)<\\/span>`,
      "i",
    ),
  )
  return m ? clean(m[1]) || null : null
}

/** Parse a single mission's detail page. */
export function parseJobDetail(html: string, id: string): JobDetail {
  const ld = parseJsonLd(html)

  const h1 = html.match(/class="wrapper-job-title"[\s\S]*?<h1>([\s\S]*?)<\/h1>/i)
  const h2 = html.match(/class="wrapper-job-title"[\s\S]*?<h2>([\s\S]*?)<\/h2>/i)
  const title = h1 ? clean(h1[1]) : ld?.title ? clean(ld.title) : "(sans titre)"
  const subtitle = h2 ? clean(h2[1]) || null : null

  const mission = infoGroup(html, "mission")
  const entreprise = infoGroup(html, "entreprise")
  const profile = infoGroup(html, "profil")

  const tags: string[] = []
  const tagRe = /class="tag-item"[^>]*>([\s\S]*?)<\/a>/gi
  let tm: RegExpExecArray | null
  while ((tm = tagRe.exec(html)) !== null) {
    const t = clean(tm[1])
    if (t && !tags.includes(t)) tags.push(t)
  }

  const keyPoints: string[] = []
  const kpBlock = html.match(/class="key-point-group-body"[\s\S]*?<ul>([\s\S]*?)<\/ul>/i)
  if (kpBlock) {
    const liRe = /<li>([\s\S]*?)<\/li>/gi
    let km: RegExpExecArray | null
    while ((km = liRe.exec(kpBlock[1])) !== null) {
      const k = clean(km[1])
      if (k) keyPoints.push(k)
    }
  }

  const { tjm, currency } = parsePricing(summaryItem(html, "salary"))
  const ldSalary = ld?.baseSalary?.value?.value ?? null

  const recruiter = html.match(/class="wrapper-author-name"[^>]*>([\s\S]*?)<\/h5>/i)
  const email = html.match(/href="mailto:([^"]+)"/i)

  const region = ld?.jobLocation?.address?.addressRegion
    ? decodeHtmlEntities(ld.jobLocation.address.addressRegion)
    : null

  const description =
    [
      mission ? `Mission\n${mission}` : "",
      entreprise ? `Entreprise\n${entreprise}` : "",
      profile ? `Profil\n${profile}` : "",
    ]
      .filter(Boolean)
      .join("\n\n") || null

  return {
    id,
    title,
    company: null,
    location: summaryItem(html, "location") ?? ld?.jobLocation?.address?.addressLocality ?? null,
    date: ld?.datePosted ?? null,
    url: `${BASE}/jobs/${id}`,
    subtitle,
    clientProfile: entreprise ?? subtitle,
    intermediary: "Next Mondays",
    tjm: tjm ?? ldSalary,
    currency: currency ?? ld?.baseSalary?.currency ?? null,
    tags,
    group: summaryItem(html, "activity"),
    filled: /class="[^"]*job-is-filled/i.test(html) || /offre pourvue/i.test(html),
    description,
    mission,
    profile,
    duration: summaryItem(html, "duration"),
    employmentType: ld?.employmentType ?? null,
    region,
    keyPoints,
    recruiter: recruiter ? clean(recruiter[1]) || null : null,
    recruiterEmail: email ? decodeHtmlEntities(email[1]) : null,
    applyUrl: `${BASE}/jobs/${id}`,
  }
}

/** Accept a bare mission reference or any `nextmondays.com/jobs/...` URL. */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  const url = trimmed.match(/\/jobs\/(?:[^/?#]+\/)?([0-9A-Za-z]{4,})(?:[/?#]|$)/i)
  if (url) return url[1]
  if (/^[0-9A-Za-z]{4,}$/.test(trimmed)) return trimmed
  return null
}

/** Run `tasks` with bounded concurrency, preserving input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

/** Fold accents and lowercase, so `"developpeur"` matches `"développeur"`. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

/**
 * Match a card against a free-text query. Space-separated terms are ANDed; a term
 * matches if it appears in the title, subtitle, client blurb, tags, or group.
 * Accent- and case-insensitive.
 */
export function matchesQuery(card: JobCard, query: string): boolean {
  const haystack = fold(
    [card.title, card.subtitle, card.clientProfile, card.group, ...card.tags]
      .filter(Boolean)
      .join(" "),
  )
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

/** Build the listing URL for the selected surface. */
export function listingUrl(opts: { group?: string; tag?: string }): string {
  if (opts.tag) return `${BASE}/jobs/tags/${encodeURIComponent(opts.tag.toLowerCase())}`
  if (opts.group) return `${BASE}/jobs/groups/${encodeURIComponent(opts.group.toLowerCase())}`
  return ALL_JOBS_URL
}

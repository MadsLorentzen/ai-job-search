// Data source: Computrabajo Colombia public pages (co.computrabajo.com).
// Search returns an HTML list of offer cards (`article.box_offer`); detail
// returns a single offer's HTML. We parse both with regex — the markup is
// shallow and stable, and a full DOM parser is unnecessary.

export const SEARCH_URL = "https://co.computrabajo.com"
// canonical host: www.computrabajo.com.co 301-redirects here

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; computrabajo-search-cli/1.0)"

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
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
  companyUrl: string | null
  location: string | null
  date: string | null
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  requirements: string[]
  salary: string | null
  applyUrl: string | null
  deadline: string | null // Computrabajo publishes no closing dates -> always null
}

/**
 * Extract the inner HTML of a <div> identified by a non-class attribute
 * (e.g. <div ... div-link="oferta">), correctly handling nested <div>
 * elements by tracking tag depth.
 */
export function extractDivByAttr(html: string, attr: string, value: string): string | null {
  const openRe = new RegExp(`<div[^>]*${attr}="${value}"[^>]*>`, "i")
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

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji, U+1F600)
 * decode correctly, and drops out-of-range values instead of throwing.
 */
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
    // Numeric character references: decimal (&#233;) and hexadecimal (&#xE9;).
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

const MONTH_DAYS = 30
const YEAR_DAYS = 365

/**
 * Parse Computrabajo's relative dates ("Hoy", "Ayer", "Hace 12 horas",
 * "Hace 2 días", "Hace 1 semana", "Hace 3 meses", optionally followed by
 * notes like "(actualizada)") into a local YYYY-MM-DD string. Sub-day units
 * (minutes/hours) resolve to the current day. Returns null when the text is
 * not a relative date (e.g. "Palabras clave: ...").
 */
export function relativeDateToISO(
  text: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!text) return null
  // Real pages hide accents inside the date text ("Hace 2 d&#xED;as") — decode first.
  const t = decodeHtmlEntities(text).replace(/\s+/g, " ").trim().toLowerCase()
  const m = t.match(
    /^(hoy|ayer|hace\s+(\d+)\s+(minuto|minutos|hora|horas|dia|dias|día|días|semana|semanas|mes|meses|año|años|ano|anos))/,
  )
  if (!m) return null
  const unit = (m[3] ?? "").toLowerCase()
  if (m[1] === "ayer") {
    return isoDaysAgo(now, 1)
  }
  if (m[1] === "hoy") {
    return isoDaysAgo(now, 0)
  }
  const n = parseInt(m[2], 10)
  if (unit.startsWith("minuto") || unit.startsWith("hora")) {
    return isoDaysAgo(now, 0)
  }
  if (unit.startsWith("dia") || unit.startsWith("día")) {
    return isoDaysAgo(now, n)
  }
  if (unit.startsWith("semana")) {
    return isoDaysAgo(now, n * 7)
  }
  if (unit.startsWith("mes")) {
    return isoDaysAgo(now, n * MONTH_DAYS)
  }
  return isoDaysAgo(now, n * YEAR_DAYS)
}

function isoDaysAgo(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 86400000)
  const mo = String(d.getMonth() + 1).padStart(2, "0")
  const da = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${mo}-${da}`
}

/**
 * Parse the search response: a flat list of <article class="box_offer"
 * data-id='<32-hex>'> cards. We split on the card id attribute and parse each
 * chunk independently so one malformed card cannot break the rest.
 */
export function parseJobCards(html: string, now: Date = new Date()): JobCard[] {
  const results: JobCard[] = []
  const chunks = html.split(/data-id='/i).slice(1)

  for (const chunk of chunks) {
    const idMatch = chunk.match(/^([0-9a-f]{32})/i)
    if (!idMatch) continue
    const id = idMatch[1]

    // Title link: <a class="js-o-link fc_base" href="/ofertas-de-trabajo/...">Title</a>
    const link = chunk.match(/class="js-o-link fc_base"[^>]*href="([^"]+)"/i)
    if (!link) continue
    const path = decodeHtmlEntities(link[1]).split("#")[0]
    if (!path.startsWith("/ofertas-de-trabajo/")) continue
    const titleMatch = chunk.match(
      /class="js-o-link fc_base"[^>]*href="[^"]+"[^>]*>\s*([\s\S]*?)\s*<\/a>/i,
    )
    if (!titleMatch) continue
    const title = clean(titleMatch[1])
    if (!title) continue
    const url = `${SEARCH_URL}${path}`

    // Company: <a ... href="https://co.computrabajo.com/<company-slug>"
    //   target='_blank' offer-grid-article-company-url>Name</a>
    let company: string | null = null
    let companyUrl: string | null = null
    const compLink = chunk.match(/href="(https?:\/\/[^"]+)"[^>]*offer-grid-article-company-url/i)
    if (compLink) {
      companyUrl = decodeHtmlEntities(compLink[1]).split("?")[0]
      const compText = chunk.match(/offer-grid-article-company-url[^>]*>\s*([\s\S]*?)\s*<\/a>/i)
      if (compText) company = clean(compText[1]) || null
    }

    // Location: <p class="fs16 fc_base mt5"><span class="mr10">City, Dept.</span></p>
    // (the rating row above it is <p class="dFlex vm_fx fs16 fc_base mt5">, which
    // this exact-class regex deliberately does not match)
    const loc = chunk.match(/<p class="fs16 fc_base mt5">\s*<span class="mr10">\s*([\s\S]*?)\s*<\/span>/i)
    const location = loc ? clean(loc[1]) || null : null

    // Relative date: <p class="fs13 fc_aux mt15">Hace 12 horas</p>
    const dt = chunk.match(/<p class="fs13 fc_aux mt15">\s*([\s\S]*?)\s*<\/p>/i)
    const date = dt ? relativeDateToISO(dt[1], now) : null

    results.push({
      id,
      title,
      company,
      companyUrl,
      location,
      date,
      url,
    })
  }

  return results
}

/** Parse a single offer's detail page. */
export function parseJobDetail(
  html: string,
  url: string,
  id: string,
  now: Date = new Date(),
): JobDetail {
  const title = html.match(/<h1[^>]*class="[^"]*fwB[^"]*fs24[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/h1>/i)

  // Company + location share one line right under the h1:
  // <p class="fs16">AGAVAL - Medellín, Antioquia</p>  (the marketing row above
  // the h1 carries the extra fc_aux class, so exact-class matching is safe)
  let company: string | null = null
  let location: string | null = null
  const orgLoc = html.match(/<p class="fs16">\s*([\s\S]*?)\s*<\/p>/i)
  if (orgLoc) {
    const parts = clean(orgLoc[1]).split(" - ")
    company = parts[0] || null
    location = parts.slice(1).join(" - ") || null
  }

  let description: string | null = null
  let requirements: string[] = []
  let salary: string | null = null
  let date: string | null = null

  const block = extractDivByAttr(html, "div-link", "oferta")
  if (block) {
    // First tag span is the salary ("A convenir" when unpublished).
    const tags = [...block.matchAll(/<span class="tag base mb10"[^>]*>\s*([\s\S]*?)\s*<\/span>/gi)]
    if (tags.length > 0) salary = clean(tags[0][1]) || null

    // Requirements: <p ... >Requerimientos</p><ul class="disc mbB"><li ...>
    const reqUl = block.match(/<ul class="disc mbB">([\s\S]*?)<\/ul>/i)
    if (reqUl) {
      requirements = [...reqUl[1].matchAll(/<li[^>]*>\s*([\s\S]*?)\s*<\/li>/gi)]
        .map((m) => clean(m[1]))
        .filter((t) => t.length > 0)
    }

    // Description: the <p class="mbB"> paragraph(s) below the tag row, up to
    // the Requerimientos heading.
    const descStart = block.indexOf('<p class="mbB">')
    const reqIdx = block.search(/Requerimientos/i)
    if (descStart !== -1 && (reqIdx === -1 || descStart < reqIdx)) {
      const endIdx = reqIdx === -1 ? block.length : reqIdx
      const raw = block.slice(descStart, endIdx)
      const withBreaks = raw.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n")
      description =
        decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim() || null
    }

    // Relative date lives in the last <p class="fc_aux fs13"> that parses
    // ("Ayer (actualizada)"); the "Palabras clave" line does not parse.
    const auxDates = [...block.matchAll(/<p class="fc_aux fs13"[^>]*>\s*([\s\S]*?)\s*<\/p>/gi)]
      .map((m) => relativeDateToISO(m[1], now))
      .filter((d): d is string => d !== null)
    if (auxDates.length > 0) date = auxDates[auxDates.length - 1]
  }

  const applyMatch = html.match(/data-href-offer-apply="([^"]+)"/i)
  const applyUrl = applyMatch ? decodeHtmlEntities(applyMatch[1]) : null

  return {
    id,
    title: title ? clean(title[1]) : "(untitled)",
    company,
    companyUrl: null,
    location,
    date,
    url,
    description,
    requirements,
    salary,
    applyUrl,
    deadline: null,
  }
}
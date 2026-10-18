// Data source: Infoempleo.com public pages. No authentication required.
// Search returns an HTML list of offer cards (<li class="offerblock">); detail
// pages carry a schema.org JobPosting JSON-LD block, which is far more stable
// than the markup and is what the detail command reads.

export const BASE_URL = "https://www.infoempleo.com"
export const SEARCH_URL = `${BASE_URL}/trabajo/`
export const OFFER_PATH = "/ofertasdetrabajo/"

export class CliError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; infoempleo-search-cli/1.0)"

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9",
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
    if (response.status === 403) {
      throw new CliError(
        "Infoempleo refused the request (403). Back off and retry later; this is a block, not a parser fault.",
        "BLOCKED",
      )
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
  summary: string | null
  snippet: string | null
}

export interface JobDetail {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  deadline: string | null
  url: string
  description: string | null
  employmentType: string | null
  workHours: string | null
  experience: string | null
  salary: string | null
  industry: string | null
  category: string | null
}

/** Code point -> string; out-of-range values are dropped instead of throwing. */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

/** Named entities Spanish text actually uses; everything else arrives numeric or as UTF-8. */
const NAMED_ENTITIES: Record<string, string> = {
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü", iexcl: "¡", iquest: "¿",
  euro: "€", ordm: "º", ordf: "ª", laquo: "«", raquo: "»", ndash: "–", mdash: "—",
  hellip: "…", bull: "•", middot: "·", deg: "°", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  agrave: "à", egrave: "è", ograve: "ò", ccedil: "ç", Ccedil: "Ç", copy: "©", reg: "®",
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&([a-zA-Z]+);/g, (whole, name) => NAMED_ENTITIES[name] ?? whole)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
    // &amp; last, so "&amp;lt;" decodes to "&lt;" and not to "<".
    .replace(/&amp;/g, "&")
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

export function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html)).replace(/\s+/g, " ").trim()
}

/**
 * "Hace 18 horas" / "Hace 3 días" / "Hace 2 semanas" -> YYYY-MM-DD. The site
 * publishes only relative ages on cards, so the date is approximate to the
 * unit (hours resolve to a calendar day). Returns null for anything else
 * (e.g. "Hace más de 100 días" is a lower bound, not a date).
 */
export function relativeToDate(text: string, now: Date = new Date()): string | null {
  const t = decodeHtmlEntities(text).toLowerCase().trim()
  if (/^hoy\b/.test(t)) return now.toISOString().slice(0, 10)
  if (/^ayer\b/.test(t)) return new Date(now.getTime() - 86400000).toISOString().slice(0, 10)
  const m = t.match(/^hace\s+(\d+)\s*(minuto|hora|d[ií]a|semana|mes)/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  const unitMs: Record<string, number> = {
    minuto: 60_000,
    hora: 3_600_000,
    día: 86_400_000,
    dia: 86_400_000,
    semana: 7 * 86_400_000,
    mes: 30 * 86_400_000,
  }
  return new Date(now.getTime() - n * unitMs[m[2]]).toISOString().slice(0, 10)
}

/**
 * Parse a search-results page. Cards are split on the <li class="offerblock">
 * opener and parsed independently so one malformed card cannot break the rest.
 * The page interleaves ad slots and course modules that reuse the same class;
 * only chunks holding a /ofertasdetrabajo/<slug>/<city>/<id>/ link are offers,
 * and repeats of an id are dropped.
 */
export function parseJobCards(html: string, now: Date = new Date()): JobCard[] {
  const results: JobCard[] = []
  const seen = new Set<string>()
  const chunks = html.split('<li class="offerblock"').slice(1)

  for (const chunk of chunks) {
    const link = chunk.match(
      /<h2[^>]*class="title[^"]*"[^>]*>\s*<a[^>]*href="(\/ofertasdetrabajo\/[^"]*?\/(\d+)\/?)"[^>]*>([\s\S]*?)<\/a>/i,
    )
    if (!link) continue
    const id = link[2]
    if (seen.has(id)) continue
    const title = clean(link[3])
    if (!title) continue
    seen.add(id)

    const snippetM = chunk.match(/<p class="trunkat[^"]*">([\s\S]*?)(?=<p|<\/p>)/i)
    const summaryM = chunk.match(/<p class="small extra-data[^"]*">([\s\S]*?)(?=<p|<\/p>|<div)/i)
    const companyM = chunk.match(/class="logoplusname[^"]*"[\s\S]*?<span class="extra-data">([\s\S]*?)<\/span>/i)
    const locM = chunk.match(/icon-map-marker[\s\S]*?<\/span>\s*([^<]+)/i)
    const ageM = chunk.match(/icon-clock[\s\S]*?class="extra-data">\s*([^<&]*(?:&#\d+;[^<&]*)*)/i)

    results.push({
      id,
      title,
      company: companyM ? clean(companyM[1]) || null : null,
      location: locM ? clean(locM[1]) || null : null,
      date: ageM ? relativeToDate(ageM[1], now) : null,
      url: `${BASE_URL}${link[1]}`,
      summary: summaryM ? clean(summaryM[1]) || null : null,
      snippet: snippetM ? clean(snippetM[1]) || null : null,
    })
  }
  return results
}

/** "Mostrando 1-20 de 111 ofertas" -> 111 (null when the page has no count). */
export function parseTotal(html: string): number | null {
  const m = html.match(/Mostrando\s+\d+-\d+\s+de\s+([\d.]+)\s+ofertas/i)
  return m ? parseInt(m[1].replace(/\./g, ""), 10) : null
}

function descriptionToText(html: string): string | null {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
    .replace(/\r/g, "")
  const text = withBreaks
    .split("\n")
    .map((line) => clean(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

function formatSalary(base: any): string | null {
  const v = base?.value
  if (!v) return null
  const min = Number(v.minValue)
  const max = Number(v.maxValue)
  const unit = String(v.unitText || base.unitText || "").toLowerCase()
  const per = unit === "year" ? "/año" : unit === "month" ? "/mes" : unit ? `/${unit}` : ""
  const cur = base.currency === "EUR" ? "€" : base.currency || ""
  if (min > 0 && max > 0) return `${min}-${max}${cur}${per}`
  const single = Number(v.value) || min || max
  return single > 0 ? `${single}${cur}${per}` : null
}

/** Pull the schema.org JobPosting object out of the page's JSON-LD blocks. */
export function extractJobPosting(html: string): any | null {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1])
      if (obj && obj["@type"] === "JobPosting") return obj
    } catch {
      // A malformed block must not hide a valid one further down the page.
    }
  }
  return null
}

export function parseJobDetail(html: string, id: string): JobDetail | null {
  const job = extractJobPosting(html)
  if (!job) return null
  const addr = job.jobLocation?.address
  const location = addr
    ? [addr.addressLocality, addr.addressRegion].filter(Boolean).join(", ") || null
    : null
  const exp = job.experienceRequirements
  return {
    id,
    title: clean(String(job.title ?? "")) || "(untitled)",
    company: job.hiringOrganization?.name ? clean(String(job.hiringOrganization.name)) : null,
    location,
    date: job.datePosted ?? null,
    deadline: job.validThrough ?? null,
    url: `${BASE_URL}${OFFER_PATH}x/y/${id}/`,
    description: job.description ? descriptionToText(String(job.description)) : null,
    employmentType: job.employmentType ?? null,
    workHours: job.workHours ?? null,
    experience: Array.isArray(exp) ? exp.join(", ") : exp ?? null,
    salary: formatSalary(job.baseSalary),
    industry: job.industry ?? null,
    category: job.occupationalCategory ?? null,
  }
}

/** Nearest supported freshness bucket at or above `days`: the site offers 1, 7 and 15. */
export function jobageToDias(days: number): number | null {
  if (!days || days <= 0 || days >= 9999) return null
  if (days <= 1) return 1
  if (days <= 7) return 7
  if (days <= 15) return 15
  return null
}

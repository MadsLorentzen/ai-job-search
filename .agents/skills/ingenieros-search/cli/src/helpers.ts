// Data source: Ingenieros.es "bolsa de trabajo" (engineering job board, Spain).
// No authentication. The board's landing page lists its latest offers as
// <article class="bolsa-oferta"> cards; each offer has a detail page made of
// labelled <section>s. Its keyword search is a CSRF-protected POST form, so
// this CLI reads the public latest-offers listing and filters it client-side.

export const BASE_URL = "https://www.ingenieros.es"
export const LIST_URL = `${BASE_URL}/bolsa_de_trabajo`
export const DETAIL_URL = `${BASE_URL}/bolsa_de_trabajo/detalles_oferta`

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

const UA = "Mozilla/5.0 (compatible; ingenieros-search-cli/1.0)"

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
      throw new CliError("Ingenieros.es refused the request (403). Back off and retry later.", "BLOCKED")
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
}

export interface JobDetail extends JobCard {
  deadline: null
  province: string | null
  sector: string | null
  level: string | null
  contract: string | null
  workday: string | null
  salary: string | null
  minStudies: string | null
  minExperience: string | null
  description: string | null
  minRequirements: string | null
  desiredRequirements: string | null
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

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
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
    .replace(/&amp;/g, "&")
}

export function clean(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).replace(/\s+/g, " ").trim()
}

/** "16/10/2026" -> "2026-10-16" (null for anything that is not a real calendar date). */
export function spanishDateToIso(text: string): string | null {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return null
  const [d, mo, y] = [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)]
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return date.toISOString().slice(0, 10)
}

/** Lowercase and strip accents so "Producción" matches "produccion". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
}

/** Parse the latest-offers listing, one <article class="bolsa-oferta"> at a time. */
export function parseJobCards(html: string): JobCard[] {
  const cards: JobCard[] = []
  const articles = html.match(/<article class="bolsa-oferta">[\s\S]*?<\/article>/gi) ?? []
  for (const article of articles) {
    const link = article.match(/<h3>\s*<a[^>]*href="[^"]*\/detalles_oferta\/(\d+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!link) continue
    const title = clean(link[2])
    if (!title) continue
    const dateM = article.match(/<strong>\s*Fecha:\s*<\/strong>\s*([^<]*)/i)
    const placeM = article.match(/<strong>\s*Lugar:\s*<\/strong>\s*([^<]*)/i)
    const companyM = article.match(/<strong>\s*Empresa:\s*<\/strong>\s*(?:<a[^>]*>)?([\s\S]*?)(?:<\/a>|<\/p>)/i)
    cards.push({
      id: link[1],
      title,
      company: companyM ? clean(companyM[1]) || null : null,
      location: placeM ? clean(placeM[1]) || null : null,
      date: dateM ? spanishDateToIso(dateM[1]) : null,
      url: `${DETAIL_URL}/${link[1]}`,
    })
  }
  return cards
}

function textBlock(html: string): string | null {
  const text = decodeHtmlEntities(
    html
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
  return text || null
}

/** Collect "<p><span>Label:</span> value</p>" pairs from one section. */
function labelledFields(section: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const re = /<p>\s*<span[^>]*>([^<]*?):\s*<\/span>([\s\S]*?)<\/p>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(section)) !== null) {
    const value = clean(m[2])
    if (value) fields[fold(clean(m[1]))] = value
  }
  return fields
}

/** Parse an offer page. Returns null when the page is not an offer. */
export function parseJobDetail(html: string, id: string): JobDetail | null {
  const header = html.match(/<header class="bolsa-detalle-cabecera">([\s\S]*?)<\/header>/i)
  if (!header) return null
  const title = clean(header[1].match(/<h2>([\s\S]*?)<\/h2>/i)?.[1] ?? "")
  if (!title) return null

  const sections: Record<string, string> = {}
  for (const m of html.matchAll(/<section class="bolsa-detalle-seccion"[^>]*>([\s\S]*?)<\/section>/gi)) {
    const name = clean(m[1].match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "")
    if (name) sections[fold(name)] = m[1]
  }
  const company = labelledFields(sections["la empresa"] ?? "")
  const job = labelledFields(sections["descripcion de la oferta"] ?? "")
  const reqs = labelledFields(sections["requisitos"] ?? "")
  const contract = labelledFields(sections["contrato"] ?? "")

  const block = (section: string | undefined, heading: string): string | null => {
    if (!section) return null
    const re = /<div class="bolsa-detalle-texto">\s*<h4>([\s\S]*?)<\/h4>\s*<div>([\s\S]*?)<\/div>\s*<\/div>/gi
    for (const m of section.matchAll(re)) {
      if (fold(clean(m[1])) === fold(heading)) return textBlock(m[2])
    }
    return null
  }
  const salaryKey = Object.keys(contract).find((k) => k.startsWith("salario"))
  const place = job["lugar del trabajo"] ?? null

  return {
    id,
    title,
    company: company["nombre de la empresa"] ?? null,
    location: place,
    date: spanishDateToIso(job["fecha"] ?? company["fecha de la oferta"] ?? header[1]),
    url: `${DETAIL_URL}/${id}`,
    // The board publishes no application deadline; null means "not stated".
    deadline: null,
    province: job["provincia"] ?? null,
    sector: job["sector"] ?? null,
    level: job["nivel"] ?? null,
    contract: contract["tipo de contrato"] ?? null,
    workday: contract["jornada laboral"] ?? null,
    salary: salaryKey ? contract[salaryKey] : null,
    minStudies: reqs["estudios minimos"] ?? null,
    minExperience: reqs["experiencia minima"] ?? null,
    description: block(sections["descripcion de la oferta"], "Descripción de la oferta"),
    minRequirements: block(sections["requisitos"], "Requisitos mínimos"),
    desiredRequirements: block(sections["requisitos"], "Requisitos deseados"),
  }
}

/**
 * Client-side filter over the listing. Every whitespace-separated query term
 * must appear (accent- and case-insensitively, as a substring) in the title,
 * company or place; the location must appear in the place. `jobage` keeps
 * offers dated within N days of `now`; offers with no date are kept, because
 * dropping them would hide a posting for a missing field.
 */
export function filterCards(
  cards: JobCard[],
  opts: { query?: string; location?: string; jobage: number },
  now: Date = new Date(),
): JobCard[] {
  const terms = opts.query ? fold(opts.query).split(/\s+/).filter(Boolean) : []
  const place = opts.location ? fold(opts.location).trim() : ""
  const cutoff = opts.jobage < 9999 ? now.getTime() - opts.jobage * 86400000 : null

  return cards.filter((c) => {
    const haystack = fold(`${c.title} ${c.company ?? ""} ${c.location ?? ""}`)
    if (!terms.every((t) => haystack.includes(t))) return false
    if (place && !fold(c.location ?? "").includes(place)) return false
    if (cutoff !== null && c.date) {
      // A date means that whole UTC day, so an offer posted "today" is never cut by the clock hour.
      if (Date.parse(`${c.date}T23:59:59Z`) < cutoff) return false
    }
    return true
  })
}

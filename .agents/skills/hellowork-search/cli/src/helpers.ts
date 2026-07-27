// Data source: HelloWork (www.hellowork.com), the largest French generalist job board.
//
// Search  -> GET /fr-fr/emploi/recherche.html?k=&l=&c=&d=&st=&p=   (server-rendered HTML)
// Detail  -> GET /fr-fr/emplois/<id>.html                          (carries schema.org JSON-LD)
//
// The search page is parsed with regex over per-card chunks: the markup is deep
// (Tailwind utility soup) but the anchors we need are stable `data-cy` hooks and
// `data-id-storage-item-id` attributes. The detail page is NOT parsed from markup
// at all -- HelloWork embeds a complete schema.org `JobPosting` object, so `detail`
// reads structured data and only falls back to HTML for the apply link.

export const BASE = "https://www.hellowork.com"
export const SEARCH_URL = `${BASE}/fr-fr/emploi/recherche.html`
export const DETAIL_URL = `${BASE}/fr-fr/emplois`

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

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
    if (response.status === 404 || response.status === 410) return ""
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
  /** ISO-8601 date derived from the card's relative "il y a N jours" label. */
  date: string | null
  /** The raw French relative label, kept because it is what the page actually shows. */
  dateRelative: string | null
  /** Whole days since posting, derived from the relative label. Null when unparseable. */
  ageDays: number | null
  url: string
  contract: string | null
  salary: string | null
}

export interface JobDetail {
  id: string
  title: string
  company: string | null
  companyUrl: string | null
  location: string | null
  date: string | null
  url: string
  contract: string | null
  employmentType: string | null
  salary: string | null
  validThrough: string | null
  experienceMonths: number | null
  education: string | null
  industry: string[] | null
  skills: string[] | null
  description: string | null
  qualifications: string | null
  applyUrl: string | null
}

/* -------------------------------------------------------------------------- */
/* Text helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji) decode
 * correctly, and drops out-of-range values instead of throwing.
 */
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
    // HelloWork emits hex refs for every accented character in attributes.
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    // &amp; last, so "&amp;#xE9;" does not turn into a live entity.
    .replace(/&amp;/g, "&")
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html))
}

/** Turn an HTML fragment into readable plain text, preserving paragraph breaks. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
  return decodeHtmlEntities(
    withBreaks
      .replace(/<[^>]+>/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n"),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/* -------------------------------------------------------------------------- */
/* Relative-date parsing                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Shape of the relative labels HelloWork renders on cards. Note that the freshest
 * listings drop the "il y a" prefix entirely and read "moins d'une heure", so the
 * prefix cannot be assumed.
 */
export const RELATIVE_DATE_RE =
  /^(il y a\s+\d+\s*(minute|heure|jour|semaine|mois|an|année)s?\b|moins d.une?\b|plus d.une?\b|hier\b|aujourd.?hui\b|à l.instant\b|a l.instant\b)/i

/**
 * HelloWork cards carry no machine-readable timestamp -- only a French relative
 * label ("il y a 5 jours", "il y a 18 heures"). Convert it to whole days and an
 * ISO date so results are sortable and `--jobage` can filter client-side.
 * Returns nulls for anything unrecognised rather than guessing.
 */
export function parseRelativeDate(
  label: string | null,
  now: Date = new Date(),
): { date: string | null; ageDays: number | null } {
  if (!label) return { date: null, ageDays: null }
  const text = label.toLowerCase().trim()

  // "moins d'une heure" / "moins d'un jour" — the freshest listings, no prefix.
  if (/^moins d.un(e)?\s+(heure|jour|minute)/.test(text)) {
    return { date: toISODate(now), ageDays: 0 }
  }
  if (/aujourd.?hui|à l.instant|a l.instant/.test(text)) {
    return { date: toISODate(now), ageDays: 0 }
  }
  if (/\bhier\b/.test(text)) {
    return { date: toISODate(shiftDays(now, 1)), ageDays: 1 }
  }
  // "plus d'un mois" — HelloWork's ceiling label for stale postings.
  if (/^plus d.un\s+mois/.test(text)) {
    return { date: toISODate(shiftDays(now, 30)), ageDays: 30 }
  }
  if (/^plus d.un\s+an/.test(text)) {
    return { date: toISODate(shiftDays(now, 365)), ageDays: 365 }
  }

  const m = text.match(
    /il y a\s+(\d+)\s*(minute|minutes|heure|heures|jour|jours|semaine|semaines|mois|an|ans|année|années)/,
  )
  if (!m) return { date: null, ageDays: null }

  const n = parseInt(m[1], 10)
  const unit = m[2]
  let days: number
  if (unit.startsWith("minute") || unit.startsWith("heure")) days = 0
  else if (unit.startsWith("jour")) days = n
  else if (unit.startsWith("semaine")) days = n * 7
  else if (unit === "mois") days = n * 30
  else days = n * 365

  return { date: toISODate(shiftDays(now, days)), ageDays: days }
}

function shiftDays(from: Date, days: number): Date {
  return new Date(from.getTime() - days * 86400000)
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/* -------------------------------------------------------------------------- */
/* Search-page parsing                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Parse the search results page. Cards are `<li data-id-storage-item-id="...">`
 * blocks; we split on that attribute and parse each chunk independently so one
 * malformed or differently-templated card (sponsored slots use a variant layout)
 * cannot break the rest.
 */
export function parseJobCards(html: string, now: Date = new Date()): JobCard[] {
  const results: JobCard[] = []
  const seen = new Set<string>()
  const chunks = html.split(/data-id-storage-item-id="/).slice(1)

  for (const chunk of chunks) {
    const idMatch = chunk.match(/^(\d+)"/)
    if (!idMatch) continue
    const id = idMatch[1]
    if (seen.has(id)) continue

    // Title and company share one <h3>: first <p> is the title, second the company.
    let title: string | null = null
    let company: string | null = null
    const h3 = chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)
    if (h3) {
      const ps = [...h3[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((p) => clean(p[1]))
      title = ps[0] || null
      company = ps[1] || null
    }
    // Fallback: the anchor's title attribute is "Title - Company".
    if (!title) {
      const attr = chunk.match(/data-cy="offerTitle"[\s\S]{0,600}?title="([^"]+)"/i)
      if (attr) {
        const full = decodeHtmlEntities(attr[1])
        const split = full.lastIndexOf(" - ")
        title = split > 0 ? full.slice(0, split) : full
        if (!company && split > 0) company = full.slice(split + 3)
      }
    }
    if (!title) continue

    const loc = chunk.match(/data-cy="localisationCard"[^>]*>([\s\S]*?)<\/div>/i)
    const location = loc ? clean(loc[1]) || null : null

    const con = chunk.match(/data-cy="contractCard"[^>]*>([\s\S]*?)<\/div>/i)
    const contract = con ? clean(con[1]) || null : null

    // Salary/TJM sits in the bold tag pill next to the location/contract pills.
    const sal = chunk.match(/class="[^"]*tag-secondary-s typo-s-bold[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    const salary = sal ? clean(sal[1]) || null : null

    // The date sits in a `typo-s text-grey-500` div — but so do HelloWork's
    // section separators ("Les offres ci-dessous sont basées sur..."), which fall
    // inside this chunk whenever the card itself carries no date. Scan every
    // candidate and keep the first that actually looks like a relative date.
    let dateRelative: string | null = null
    const relRe = /class="typo-s text-grey-500[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
    let rel: RegExpExecArray | null
    while ((rel = relRe.exec(chunk)) !== null) {
      const text = clean(rel[1])
      if (text && RELATIVE_DATE_RE.test(text)) {
        dateRelative = text
        break
      }
    }
    const { date, ageDays } = parseRelativeDate(dateRelative, now)

    const href = chunk.match(/href="(\/fr-fr\/emplois\/\d+\.html)"/i)
    const url = href ? `${BASE}${href[1]}` : `${DETAIL_URL}/${id}.html`

    seen.add(id)
    results.push({ id, title, company, location, date, dateRelative, ageDays, url, contract, salary })
  }

  return results
}

/* -------------------------------------------------------------------------- */
/* Detail-page parsing                                                        */
/* -------------------------------------------------------------------------- */

interface LdJobPosting {
  title?: string
  description?: string
  qualifications?: string
  datePosted?: string
  validThrough?: string
  employmentType?: string | string[]
  url?: string
  industry?: string | string[]
  skills?: string | string[]
  hiringOrganization?: { name?: string; sameAs?: string }
  jobLocation?: { address?: Record<string, string> } | Array<{ address?: Record<string, string> }>
  baseSalary?: {
    currency?: string
    value?: { minValue?: number; maxValue?: number; value?: number; unitText?: string }
  }
  educationRequirements?: { credentialCategory?: string }
  experienceRequirements?: { monthsOfExperience?: number }
}

/** Pull the schema.org JobPosting object out of the page's JSON-LD blocks. */
export function extractJobPostingLd(html: string): LdJobPosting | null {
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim()
    if (!raw.includes("JobPosting")) continue
    try {
      const parsed = JSON.parse(raw)
      const candidates = Array.isArray(parsed) ? parsed : [parsed]
      for (const c of candidates) {
        if (c && c["@type"] === "JobPosting") return c as LdJobPosting
      }
    } catch {
      // A malformed block must not abort the scan -- try the next one.
      continue
    }
  }
  return null
}

function formatLocation(job: LdJobPosting): string | null {
  const raw = Array.isArray(job.jobLocation) ? job.jobLocation[0] : job.jobLocation
  const a = raw?.address
  if (!a) return null
  const parts = [a.addressLocality, a.postalCode, a.addressRegion].filter(Boolean)
  return parts.length ? parts.join(", ") : a.addressCountry || null
}

/**
 * Render `baseSalary` the way HelloWork shows it. `unitText: "DAY"` is the TJM
 * case that matters for freelance missions; MONTH/YEAR/HOUR are salaried roles.
 */
function formatSalary(job: LdJobPosting): string | null {
  const b = job.baseSalary
  const v = b?.value
  if (!v) return null
  const cur = b?.currency || "EUR"
  const unit =
    { DAY: "/day", HOUR: "/hour", MONTH: "/month", YEAR: "/year", WEEK: "/week" }[
      (v.unitText || "").toUpperCase()
    ] ?? ""
  if (v.minValue != null && v.maxValue != null) {
    return v.minValue === v.maxValue
      ? `${v.minValue} ${cur}${unit}`
      : `${v.minValue}-${v.maxValue} ${cur}${unit}`
  }
  const single = v.value ?? v.minValue ?? v.maxValue
  return single != null ? `${single} ${cur}${unit}` : null
}

function toArray(v: string | string[] | undefined): string[] | null {
  if (!v) return null
  const arr = Array.isArray(v) ? v : [v]
  const filtered = arr.filter((s) => typeof s === "string" && s.trim() !== "")
  return filtered.length ? filtered : null
}

/**
 * Read the posting's own contract type ("Freelance", "CDI", ...). schema.org's
 * `employmentType` does not carry it (it reports FULL_TIME/PART_TIME instead),
 * and `data-cy="contractCard"` is NOT usable here -- on a detail page those
 * belong to the related-offers sidebar, so reading one returns a *different*
 * job's contract. The authoritative value is in the GTM dataLayer blob, scoped
 * to this posting's `idOffre`; the header tag list is the fallback.
 */
export function extractContract(html: string, id: string): string | null {
  const scoped = html.match(
    new RegExp(`"idOffre":"${id}"[\\s\\S]{0,3000}?"contrat":"([^"]*)"`, "i"),
  )
  if (scoped && scoped[1].trim()) return decodeHtmlEntities(scoped[1].trim())

  // Fallback: the <ul> under the <h1> renders "<location> · <contract>".
  const header = html.match(/<\/h1>[\s\S]{0,400}?<ul[^>]*>([\s\S]*?)<\/ul>/i)
  if (header) {
    const items = [...header[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => clean(m[1]))
    const known = items.find((t) =>
      CONTRACT_VALUES.some((v) => v.replace(/_/g, " ").toLowerCase() === t.toLowerCase()),
    )
    if (known) return known
    if (items.length > 1) return items[items.length - 1] || null
  }
  return null
}

/** Build the detail record from JSON-LD, falling back to markup for what it omits. */
export function parseJobDetail(html: string, id: string): JobDetail | null {
  const ld = extractJobPostingLd(html)
  const url = `${DETAIL_URL}/${id}.html`
  const contract = extractContract(html, id)

  if (!ld) {
    // No JSON-LD: fall back to the page title so the caller still gets something.
    const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    if (!t) return null
    return {
      id,
      title: clean(t[1]) || "(untitled)",
      company: null,
      companyUrl: null,
      location: null,
      date: null,
      url,
      contract,
      employmentType: null,
      salary: null,
      validThrough: null,
      experienceMonths: null,
      education: null,
      industry: null,
      skills: null,
      description: null,
      qualifications: null,
      applyUrl: null,
    }
  }

  const employment = toArray(ld.employmentType)

  return {
    id,
    title: ld.title ? decodeHtmlEntities(ld.title) : "(untitled)",
    company: ld.hiringOrganization?.name ?? null,
    companyUrl: ld.hiringOrganization?.sameAs ?? null,
    location: formatLocation(ld),
    date: ld.datePosted ?? null,
    url: ld.url ?? url,
    contract,
    employmentType: employment ? employment.join(", ") : null,
    salary: formatSalary(ld),
    validThrough: ld.validThrough ?? null,
    experienceMonths: ld.experienceRequirements?.monthsOfExperience ?? null,
    education: ld.educationRequirements?.credentialCategory ?? null,
    industry: toArray(ld.industry),
    skills: toArray(ld.skills),
    description: ld.description ? htmlToText(ld.description) || null : null,
    qualifications: ld.qualifications ? htmlToText(ld.qualifications) || null : null,
    // HelloWork applies in-page; the posting URL is the canonical entry point.
    applyUrl: /data-cy="applyButton/i.test(html) ? (ld.url ?? url) : null,
  }
}

/* -------------------------------------------------------------------------- */
/* Parameter mapping                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Map a job age in days onto HelloWork's coarse `d` radio filter. The board only
 * offers 24h / 3 days / 1 week / 1 month, so we pick the tightest bucket that
 * still contains `days` and let the caller filter the remainder client-side.
 */
export function jobageToParam(days: number): string | null {
  if (!days || days <= 0 || days >= 9999) return null
  if (days <= 1) return "h"
  if (days <= 3) return "d"
  if (days <= 7) return "w"
  if (days <= 31) return "m"
  return null
}

/**
 * Contract-type aliases. HelloWork's `c` values are French and case-sensitive;
 * accept the obvious English/lowercase spellings a caller is likely to try.
 */
const CONTRACT_ALIASES: Record<string, string> = {
  freelance: "Freelance",
  contractor: "Freelance",
  independant: "Independant",
  indépendant: "Independant",
  independent: "Independant",
  cdi: "CDI",
  permanent: "CDI",
  cdd: "CDD",
  "fixed-term": "CDD",
  interim: "Travail_temp",
  intérim: "Travail_temp",
  temp: "Travail_temp",
  travail_temp: "Travail_temp",
  stage: "Stage",
  internship: "Stage",
  alternance: "Alternance",
  apprenticeship: "Alternance",
  franchise: "Franchise",
  associe: "Associe",
  associé: "Associe",
  fonctionnaire: "Fonctionnaire",
}

export const CONTRACT_VALUES = [
  "CDI",
  "CDD",
  "Travail_temp",
  "Stage",
  "Alternance",
  "Independant",
  "Franchise",
  "Associe",
  "Fonctionnaire",
  "Freelance",
  "Stage_de_lycee",
]

/** Normalise one comma-separated `--contract` value into HelloWork `c` values. */
export function normalizeContracts(input: string): { values: string[]; unknown: string[] } {
  const values: string[] = []
  const unknown: string[] = []
  for (const raw of input.split(",").map((s) => s.trim()).filter(Boolean)) {
    const exact = CONTRACT_VALUES.find((v) => v.toLowerCase() === raw.toLowerCase())
    const mapped = exact ?? CONTRACT_ALIASES[raw.toLowerCase()]
    if (mapped) values.push(mapped)
    else unknown.push(raw)
  }
  return { values, unknown }
}

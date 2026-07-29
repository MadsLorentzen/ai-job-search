// Data source: freelance-informatique.fr public pages. No authentication required.
// Search returns an HTML list of mission cards; detail returns a single mission's HTML.
// We parse both with regex — the markup is shallow, and the site randomly swaps the
// card link between a plain <a href> and a base64 `data-obf` span, which a DOM parser
// would not help with anyway.

export const BASE_URL = "https://www.freelance-informatique.fr"
export const SEARCH_PATH = "/offres-freelance"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

export interface FetchResult {
  html: string
  url: string
}

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<FetchResult> {
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
    if (response.status === 404) return { html: "", url: response.url }
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return { html: await response.text(), url: response.url }
  }
  throw new Error("Request failed after max retries")
}

export interface MissionCard {
  id: string
  title: string
  /** Always null: the portal anonymises clients behind a generic "Logo client". */
  company: string | null
  location: string | null
  department: string | null
  /** ISO date the mission was published, derived from the card's relative wording. */
  date: string | null
  dateRaw: string | null
  url: string
  startDate: string | null
  duration: string | null
  skills: string[]
  excerpt: string | null
  /** Always null: this portal never publishes a daily rate. */
  dailyRate: string | null
}

export interface MissionDetail extends MissionCard {
  description: string | null
  profile: string | null
  sector: string | null
  requiredSkills: string[]
  optionalSkills: string[]
  applyUrl: string | null
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

// Named entities the portal actually emits. Its descriptions are mostly raw
// UTF-8, but accented characters come through as named entities often enough
// (`&eacute;` and friends) that leaving them encoded corrupts French titles.
const NAMED_ENTITIES: Record<string, string> = {
  agrave: "à", acirc: "â", aelig: "æ", ccedil: "ç",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  icirc: "î", iuml: "ï", ocirc: "ô", oelig: "œ",
  ugrave: "ù", ucirc: "û", uuml: "ü", ouml: "ö",
  laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", ndash: "–", mdash: "—",
  hellip: "…", euro: "€", deg: "°", middot: "·",
  bull: "•", times: "×", copy: "©", reg: "®", trade: "™",
}

function decodeHtmlEntities(text: string): string {
  return text
    // The portal drops the trailing semicolon on these throughout its markup.
    .replace(/&lt;?/g, "<")
    .replace(/&gt;?/g, ">")
    .replace(/&quot;?/g, '"')
    .replace(/&nbsp;?/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => {
      const char = NAMED_ENTITIES[name.toLowerCase()]
      if (!char) return match
      // `&Eacute;` is the same letter in upper case, not a different entity.
      return /^[A-Z]/.test(name) ? char.toUpperCase() : char
    })
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    // Last, so an escaped `&amp;eacute;` is not decoded twice.
    .replace(/&amp;?/g, "&")
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

export function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html))
}

/** Turn a rich HTML block into readable text, keeping paragraph breaks. */
function richText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
  return decodeHtmlEntities(
    withBreaks.replace(/<[^>]+>/g, "").replace(/[ \t\u00a0]+/g, " "),
  )
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Mission reference, e.g. `260728C015` — six digits, a letter, three digits. */
const REF_RE = /(\d{6}[A-Za-z]\d{3})/

export function refFromPath(path: string): string | null {
  const m = path.match(REF_RE)
  return m ? m[1].toUpperCase() : null
}

function decodeObf(b64: string): string | null {
  try {
    return atob(b64)
  } catch {
    return null
  }
}

function toIso(day: number, month: number, year: number): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${year}-${pad(month)}-${pad(day)}`
}

function shiftDays(now: Date, days: number): string {
  const d = new Date(now.getTime())
  d.setDate(d.getDate() - days)
  return toIso(d.getDate(), d.getMonth() + 1, d.getFullYear())
}

/**
 * Parse the card's publication wording into an ISO date. The portal uses five
 * forms: "à l'instant", "aujourd'hui", "hier", "il y a N jours", "le DD/MM".
 * The bare DD/MM form carries no year — we assume the most recent occurrence,
 * so a date ahead of today rolls back to the previous year.
 */
export function parsePublished(raw: string | null, now: Date = new Date()): string | null {
  if (!raw) return null
  const text = raw.toLowerCase()

  if (text.includes("instant") || text.includes("aujourd")) return shiftDays(now, 0)
  if (text.includes("hier")) return shiftDays(now, 1)

  const ago = text.match(/il y a\s+(\d+)\s*jour/)
  if (ago) return shiftDays(now, parseInt(ago[1], 10))

  const dm = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/)
  if (dm) {
    const day = parseInt(dm[1], 10)
    const month = parseInt(dm[2], 10)
    if (dm[3]) {
      const y = parseInt(dm[3], 10)
      return toIso(day, month, y < 100 ? 2000 + y : y)
    }
    let year = now.getFullYear()
    // Tomorrow onwards cannot be a publication date; it is last year's posting.
    if (new Date(`${toIso(day, month, year)}T00:00:00Z`).getTime() > now.getTime()) year -= 1
    return toIso(day, month, year)
  }
  return null
}

/** Parse an explicit DD/MM/YYYY (mission start dates are always fully qualified). */
export function parseDmy(raw: string | null): string | null {
  if (!raw) return null
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return null
  return toIso(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10))
}

/** Pull the text of a card's `<li>` carrying the given icon class. */
function iconValue(chunk: string, icon: string): string | null {
  const re = new RegExp(`icon-${icon}"></i>([^<]*)<`, "i")
  const m = chunk.match(re)
  if (!m) return null
  const value = clean(m[1])
  return value || null
}

/**
 * Skill tags, opening tag and inner text. The `title` attribute holds markup of
 * its own (`title="<i class='fa ...'></i> Compétence obligatoire"`), so the
 * attribute run has to tolerate `>` inside quotes rather than stop at the first
 * one — matching `[^>]*` here silently swallows the label into the skill name.
 */
const TAG_RE = /<(?:span|a)((?:"[^"]*"|'[^']*'|[^>])*)>([\s\S]*?)<\/(?:span|a)>/gi

function parseSkills(chunk: string): string[] {
  const block = chunk.match(/<div class="tags">([\s\S]*?)<\/div>/i)
  if (!block) return []
  const skills: string[] = []
  const re = new RegExp(TAG_RE.source, "gi")
  let m: RegExpExecArray | null
  while ((m = re.exec(block[1])) !== null) {
    const value = clean(m[2])
    if (value) skills.push(value)
  }
  return skills
}

/** "75 - Paris" -> department "75". "Télétravail" -> null. */
function departmentOf(location: string | null): string | null {
  if (!location) return null
  const m = location.match(/^\s*(\d{2,3}|2[AB])\s*-/i)
  return m ? m[1].toUpperCase() : null
}

/**
 * Parse the search results page. Cards are split on the wrapper div and parsed
 * independently, so one malformed card cannot break the rest.
 */
export function parseMissionCards(html: string, now: Date = new Date()): MissionCard[] {
  const results: MissionCard[] = []
  const chunks = html.split(/<div class="card job-card-line">/).slice(1)

  for (const chunk of chunks) {
    const heading = chunk.match(/<h2 class="job-title">([\s\S]*?)<\/h2>/i)
    if (!heading) continue
    const head = heading[1]

    // The link is randomly served as a plain href or as a base64 `data-obf` span.
    let path: string | null = null
    const href = head.match(/href="([^"]+)"/i)
    if (href) {
      path = decodeHtmlEntities(href[1])
    } else {
      const obf = head.match(/data-obf="([^"]+)"/i)
      if (obf) path = decodeObf(obf[1])
    }
    if (!path) continue

    const title = clean(head.replace(/<[^>]*data-obf="[^"]*"/gi, "<span"))
    if (!title) continue

    const id = refFromPath(path)
    if (!id) continue

    const location = iconValue(chunk, "map")
    const dateRaw = iconValue(chunk, "clock")
    const excerptMatch = chunk.match(/<p class="line-clamp-2">([\s\S]*?)<\/p>/i)

    results.push({
      id,
      title,
      company: null,
      location,
      department: departmentOf(location),
      date: parsePublished(dateRaw, now),
      dateRaw,
      url: path.startsWith("http") ? path : `${BASE_URL}${path}`,
      startDate: parseDmy(iconValue(chunk, "calendar")),
      duration: iconValue(chunk, "time"),
      skills: parseSkills(chunk),
      excerpt: excerptMatch ? clean(excerptMatch[1]) || null : null,
      dailyRate: null,
    })
  }

  return results
}

/** Read one `<li>` of the detail page's `ul.informations`, keyed by its label. */
function infoField(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(
    `<li title="${escaped}">([\\s\\S]*?)</li>`,
    "i",
  )
  const m = html.match(re)
  if (!m) return null
  // The block repeats the label in a bold div before the value; drop it.
  const value = clean(m[1].replace(/<div class="fw-bold">[\s\S]*?<\/div>/i, ""))
  return value || null
}

/** Parse the single-mission detail page. */
export function parseMissionDetail(
  html: string,
  url: string,
  now: Date = new Date(),
): MissionDetail | null {
  const titleMatch = html.match(/<h1 class="title">([\s\S]*?)<\/h1>/i)
  const refMatch = html.match(/Ref\s*:\s*([0-9A-Za-z]+)\s*<\/small>/i)
  // A bogus reference still returns HTTP 200 with a generic page; both anchors
  // missing is how we detect that soft 404.
  if (!titleMatch || !refMatch) return null

  const location = infoField(html, "Localisation")
  const dateRaw = html.match(/<div class="card-footer">\s*<small>([\s\S]*?)<\/small>/i)
  const published = dateRaw ? clean(dateRaw[1]) : null

  const requiredSkills: string[] = []
  const optionalSkills: string[] = []
  const tagBlock = html.match(/<div class="subtitle">Comp[^<]*<\/div>\s*<div class="tags">([\s\S]*?)<\/div>/i)
  if (tagBlock) {
    const re = new RegExp(TAG_RE.source, "gi")
    let m: RegExpExecArray | null
    while ((m = re.exec(tagBlock[1])) !== null) {
      const value = clean(m[2])
      if (!value) continue
      if (/obligatoire/i.test(m[1])) requiredSkills.push(value)
      else optionalSkills.push(value)
    }
  }

  let description: string | null = null
  const descMatch = html.match(/<div class="mission-description">([\s\S]*?)<\/div>\s*<\/div>/i)
  if (descMatch) description = richText(descMatch[1]) || null

  let applyUrl: string | null = null
  const apply = html.match(/class="btn btn-primary btn-postuler[^"]*"\s*data-obf="([^"]+)"/i)
  if (apply) {
    const path = decodeObf(apply[1])
    if (path) applyUrl = `${BASE_URL}${path}`
  }

  return {
    id: refMatch[1].toUpperCase(),
    title: clean(titleMatch[1]),
    company: null,
    location,
    department: departmentOf(location),
    date: parsePublished(published, now),
    dateRaw: published,
    url,
    startDate: parseDmy(infoField(html, "Date de début")),
    duration: infoField(html, "Durée"),
    skills: [...requiredSkills, ...optionalSkills],
    excerpt: null,
    dailyRate: null,
    description,
    profile: infoField(html, "Profil"),
    sector: infoField(html, "Secteur d'activité"),
    requiredSkills,
    optionalSkills,
    applyUrl,
  }
}

/**
 * Île-de-France department codes. The portal's own location filter needs an
 * opaque id from a robots-disallowed endpoint, so `--location` is applied
 * client-side and this alias saves spelling out eight departments.
 */
const IDF_DEPARTMENTS = ["75", "77", "78", "91", "92", "93", "94", "95"]

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

/**
 * Client-side location match against the card's "75 - Paris" string. Accepts a
 * department number, a city name, "remote"/"télétravail", or the Île-de-France
 * aliases.
 */
export function matchesLocation(card: MissionCard, wanted: string): boolean {
  const want = normalize(wanted)
  if (!want) return true
  const have = normalize(card.location ?? "")

  if (["remote", "teletravail", "full remote"].includes(want)) {
    return have.includes("teletravail")
  }
  if (["idf", "ile-de-france", "ile de france", "iledefrance", "paris region"].includes(want)) {
    return card.department !== null && IDF_DEPARTMENTS.includes(card.department)
  }
  if (/^\d{2,3}$/.test(want)) return card.department === want

  return have.includes(want)
}

/**
 * Does this mission actually carry the skill that was searched for?
 *
 * The portal silently widens an unknown `competences` term to a *related* skill
 * instead of returning nothing: `competences=Rust` comes back with seven C++
 * missions, none of them tagged Rust. Callers use this to tell a real taxonomy
 * hit from a substitution, rather than trusting a non-empty result set.
 */
export function skillMatchesQuery(card: MissionCard, query: string): boolean {
  const want = normalize(query)
  if (!want) return true
  return card.skills.some((skill) => {
    const have = normalize(skill)
    return have.includes(want) || want.includes(have)
  })
}

/** Client-side posting-age filter: the portal has no date parameter. */
export function withinJobage(card: MissionCard, days: number, now: Date = new Date()): boolean {
  if (!days || days <= 0 || days >= 9999) return true
  if (!card.date) return false
  const posted = new Date(`${card.date}T00:00:00Z`).getTime()
  const cutoff = now.getTime() - days * 86400000
  return posted >= cutoff
}

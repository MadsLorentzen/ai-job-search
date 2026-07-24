// Data source: Welcome to the Jungle (https://www.welcometothejungle.com), the
// largest job board in the French market. Its search page is a client-side React
// app backed by Algolia, so `search` queries the same Algolia index the page
// itself queries; `detail` fetches the (fully server-rendered, robots-allowed)
// job page and reads its schema.org JobPosting ld+json block.
//
// ⚠️ Personal use only. See SKILL.md: www.welcometothejungle.com/robots.txt
// disallows query-string URLs, so the *search page* is off-limits to crawlers.
// This CLI does not fetch it — it calls the Algolia host the site's own
// JavaScript calls, with the site's published search-only key. That is a
// deliberate, user-approved choice for a personal job search: keep volume low,
// no bulk or commercial use.
//
// Nothing here is authenticated: the Algolia application ID and the *search-only*
// API key are published by the site for its own JavaScript. We re-read them at
// call time rather than hardcoding them, so a key rotation heals itself.

export const BOARD_URL = "https://www.welcometothejungle.com"
/** The runtime-env endpoint that carries the Algolia app id and search key. */
export const CONFIG_PATH = "/api/env"

export const DEFAULT_APP_ID = "CSEKHVMS53"
export const DEFAULT_INDEX = "wk_cms_jobs_production"
/** Replica of the main index, sorted newest-first — used by --jobage / --sort date. */
export const DATE_SORTED_INDEX = "wk_cms_jobs_production_published_at_desc"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** Honest identification, used for the JSON/JS endpoints that accept it. */
const UA_SKILL = "wttj-search-skill/1.0 (personal job search)"
/**
 * The job pages are behind a WAF that 403s a non-browser User-Agent outright, so
 * page fetches send a browser string (the same trade-off `linkedin-search` makes).
 */
const UA_BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * The site sits behind AWS WAF, which answers a suspicious request with a
 * JavaScript challenge instead of the document — HTTP 202 and a body carrying
 * `gokuProps` (or nothing at all). A CLI cannot solve that challenge, so this is
 * a distinct, honest failure: back off and retry later, do not hammer it.
 */
export class WafChallengeError extends Error {
  readonly code = "WAF_CHALLENGE"
  constructor(url: string) {
    super(
      `Welcome to the Jungle served a WAF challenge for ${url} instead of the page. ` +
        "This is anti-bot throttling, not a missing job: wait a few minutes and retry, " +
        "and keep request volume low (see the personal-use note in SKILL.md).",
    )
    this.name = "WafChallengeError"
  }
}

function isWafChallenge(status: number, body: string): boolean {
  if (status !== 202) return false
  return body === "" || /gokuProps|awsWafCookieDomainList|challenge\.js/.test(body)
}

export interface FetchOpts {
  /** Identify honestly by default; `browser: true` for WAF-guarded HTML pages. */
  browser?: boolean
}

/** Fetch a text document with exponential backoff on 429/5xx. "" on a 404. */
export async function textFetch(url: string, opts: FetchOpts = {}): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: opts.browser
          ? {
              "User-Agent": UA_BROWSER,
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
            }
          : { "User-Agent": UA_SKILL, Accept: "*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      })
    } catch (e) {
      throw new Error(
        `could not reach ${BOARD_URL} (${e instanceof Error ? e.message : String(e)})`,
      )
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`request failed: ${response.status} ${response.statusText}`)
      }
      await sleep(delay + Math.floor(Math.random() * 500))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return ""
    if (response.status === 403) throw new WafChallengeError(url)
    if (!response.ok && response.status !== 202) {
      throw new Error(`request failed: ${response.status} ${response.statusText}`)
    }
    const body = await response.text()
    if (isWafChallenge(response.status, body)) throw new WafChallengeError(url)
    return body
  }
  throw new Error("request failed after max retries")
}

export interface Credentials {
  appId: string
  apiKey: string
  index: string
}

/**
 * Pull the Algolia app id and search key out of the site's runtime-env document,
 * which is plain JavaScript of the form:
 *
 *   window.env = {"PUBLIC_ALGOLIA_API_KEY_CLIENT":"…","PUBLIC_ALGOLIA_APPLICATION_ID":"…", …}
 *
 * The jobs index is not named in that payload (only the articles and
 * organizations ones are), so it falls back to the known constant.
 */
export function parseCredentials(script: string): Credentials | null {
  const objectStart = script.indexOf("{")
  let parsed: Record<string, unknown> | null = null
  if (objectStart >= 0) {
    const objectEnd = script.lastIndexOf("}")
    try {
      parsed = JSON.parse(script.slice(objectStart, objectEnd + 1)) as Record<string, unknown>
    } catch {
      parsed = null
    }
  }
  const pick = (key: string): string | undefined => {
    const fromJson = parsed?.[key]
    if (typeof fromJson === "string" && fromJson) return fromJson
    // Fall back to a direct match, so a payload shape change (or a partial
    // response) still yields the two values we actually need.
    return script.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`))?.[1]
  }
  const apiKey = pick("PUBLIC_ALGOLIA_API_KEY_CLIENT")
  if (!apiKey) return null
  return {
    appId: pick("PUBLIC_ALGOLIA_APPLICATION_ID") ?? DEFAULT_APP_ID,
    apiKey,
    index: DEFAULT_INDEX,
  }
}

let cached: Credentials | null = null

/**
 * Resolve credentials once per process. Env overrides
 * (WTTJ_ALGOLIA_API_KEY / _APP_ID / _INDEX) short-circuit the fetch, which is the
 * escape hatch if the site ever stops publishing them.
 */
export async function credentials(): Promise<Credentials> {
  if (cached) return cached
  const envKey = (process.env.WTTJ_ALGOLIA_API_KEY ?? "").trim()
  if (envKey) {
    cached = {
      appId: (process.env.WTTJ_ALGOLIA_APP_ID ?? "").trim() || DEFAULT_APP_ID,
      apiKey: envKey,
      index: (process.env.WTTJ_ALGOLIA_INDEX ?? "").trim() || DEFAULT_INDEX,
    }
    return cached
  }
  const script = await textFetch(`${BOARD_URL}${CONFIG_PATH}`)
  const parsed = parseCredentials(script)
  if (!parsed) {
    throw new Error(
      "could not read the Algolia search key from " +
        `${BOARD_URL}${CONFIG_PATH} — the payload may have changed ` +
        "(see url-reference.md; WTTJ_ALGOLIA_API_KEY overrides this lookup)",
    )
  }
  cached = parsed
  return cached
}

export interface AlgoliaResponse {
  hits?: WkHit[]
  nbHits?: number
  nbPages?: number
  page?: number
  message?: string
}

/** POST one Algolia query, with the same backoff policy as the HTML fetch. */
export async function algoliaQuery(
  body: Record<string, unknown>,
  index?: string,
): Promise<AlgoliaResponse> {
  const creds = await credentials()
  const idx = index ?? creds.index
  const url = `https://${creds.appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(idx)}/query`
  const maxRetries = 6
  let delay = 500

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "X-Algolia-Application-Id": creds.appId,
          "X-Algolia-API-Key": creds.apiKey,
          "Content-Type": "application/json",
          // The site's key is referer-restricted on Algolia's side: without this
          // header the API answers 403 "Method not allowed with this referer".
          Referer: `${BOARD_URL}/`,
          "User-Agent": UA_SKILL,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      })
    } catch (e) {
      throw new Error(
        `could not reach the Algolia search API (${e instanceof Error ? e.message : String(e)})`,
      )
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Algolia request failed: ${response.status} ${response.statusText}`)
      }
      await sleep(delay + Math.floor(Math.random() * 500))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    const parsed = (await response.json().catch(() => null)) as AlgoliaResponse | null
    if (!response.ok) {
      throw new Error(
        parsed?.message || `Algolia request failed: ${response.status} ${response.statusText}`,
      )
    }
    if (!parsed) throw new Error("Algolia returned an unparseable response body")
    return parsed
  }
  throw new Error("Algolia request failed after retries")
}

/** The Welcomekit job record — the fields this skill reads. */
export interface WkHit {
  slug?: string
  name?: string
  reference?: string
  objectID?: string
  published_at?: string | null
  language?: string | null
  department?: string | null
  remote?: string | null
  contract_type?: string | null
  contract_type_names?: Record<string, string> | null
  contract_duration_minimum?: number | null
  contract_duration_maximum?: number | null
  experience_level_minimum?: number | null
  education_level?: string | null
  salary_currency?: string | null
  salary_minimum?: number | null
  salary_maximum?: number | null
  salary_period?: string | null
  /** Requirements / "profil recherché" text (Markdown-ish), not the full description. */
  profile?: string | null
  office?: WkOffice | null
  offices?: WkOffice[] | null
  organization?: {
    name?: string | null
    slug?: string | null
    nb_employees?: number | null
    size?: Record<string, string> | null
  } | null
}

export interface WkOffice {
  city?: string | null
  district?: string | null
  state?: string | null
  country?: string | null
  country_code?: string | null
}

/** A search result in the portal-skill contract shape (plus French-market extras). */
export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  contract: string | null
  contract_type: string | null
  remote: string | null
  salary: string | null
  department: string | null
  experience_years: number | null
  reference: string | null
}

export interface JobDetailResult extends JobResult {
  description: string | null
  qualifications: string | null
  education: string | null
  experience: string | null
  valid_through: string | null
  /**
   * Where the fields came from: the job page's structured data ("page", the full
   * record), or the search index ("index", the WAF-challenge fallback — no full
   * description). Never guess which one you got; read this.
   */
  source: "page" | "index"
}

/**
 * Look one job up in the search index by its org + slug. Used as the `detail`
 * fallback when the WAF blocks the job page: the index carries every structured
 * field plus the `profile` (requirements) text, though not the full description.
 *
 * `slug` is neither filterable nor searchable (querying it returns nothing), so
 * this lists the company's postings — `organization.slug` *is* facetable — and
 * matches the slug client-side. `attributesToRetrieve` keeps that listing small.
 */
export async function fetchRecordBySlug(org: string, slug: string): Promise<WkHit | null> {
  const response = await algoliaQuery({
    query: "",
    facetFilters: [[`organization.slug:${org}`]],
    offset: 0,
    length: 500,
    attributesToHighlight: [],
    attributesToSnippet: [],
    attributesToRetrieve: [
      "slug",
      "name",
      "reference",
      "published_at",
      "contract_type",
      "contract_type_names",
      "remote",
      "department",
      "experience_level_minimum",
      "education_level",
      "salary_currency",
      "salary_minimum",
      "salary_maximum",
      "salary_period",
      "profile",
      "office",
      "offices",
      "organization",
    ],
  })
  return (response.hits ?? []).find((h) => h.slug === slug) ?? null
}

/** Raw Welcomekit contract codes -> the French label used on the board. */
export const CONTRACT_LABELS_FR: Record<string, string> = {
  FULL_TIME: "CDI",
  TEMPORARY: "CDD / Temporaire",
  INTERNSHIP: "Stage",
  APPRENTICESHIP: "Alternance",
  FREELANCE: "Freelance",
  OTHER: "Autres",
}

/** What a user may type for --contract -> the raw code the index stores. */
export const CONTRACT_ALIASES: Record<string, string> = {
  cdi: "FULL_TIME",
  "full-time": "FULL_TIME",
  full_time: "FULL_TIME",
  fulltime: "FULL_TIME",
  cdd: "TEMPORARY",
  temporaire: "TEMPORARY",
  temporary: "TEMPORARY",
  interim: "TEMPORARY",
  "intérim": "TEMPORARY",
  stage: "INTERNSHIP",
  internship: "INTERNSHIP",
  alternance: "APPRENTICESHIP",
  apprentissage: "APPRENTICESHIP",
  apprenticeship: "APPRENTICESHIP",
  freelance: "FREELANCE",
  independant: "FREELANCE",
  "indépendant": "FREELANCE",
  autres: "OTHER",
  autre: "OTHER",
  other: "OTHER",
}

/** What a user may type for --remote -> the raw code the index stores. */
export const REMOTE_ALIASES: Record<string, string> = {
  full: "fulltime",
  fulltime: "fulltime",
  total: "fulltime",
  complet: "fulltime",
  partial: "partial",
  partiel: "partial",
  hybrid: "partial",
  hybride: "partial",
  punctual: "punctual",
  ponctuel: "punctual",
  no: "no",
  non: "no",
  none: "no",
  onsite: "no",
  presentiel: "no",
  "présentiel": "no",
  unknown: "unknown",
}

/** Resolve an alias table entry case-insensitively; null when unrecognized. */
export function resolveAlias(table: Record<string, string>, raw: string): string | null {
  return table[raw.trim().toLowerCase()] ?? null
}

function office(hit: WkHit): WkOffice | null {
  return hit.office ?? (hit.offices && hit.offices[0]) ?? null
}

/** "Paris, France" — city first, falling back to region, then country. */
export function formatLocation(hit: WkHit): string | null {
  const o = office(hit)
  if (!o) return null
  const place = o.city || o.district || o.state || null
  const country = o.country || null
  if (place && country) return `${place}, ${country}`
  return place || country || null
}

/** "45000–55000 EUR/yearly", or null when the posting states no salary. */
export function formatSalary(hit: WkHit): string | null {
  const min = hit.salary_minimum
  const max = hit.salary_maximum
  if (min == null && max == null) return null
  const currency = hit.salary_currency ? ` ${hit.salary_currency}` : ""
  const period = hit.salary_period ? `/${hit.salary_period}` : ""
  const range = min != null && max != null && min !== max ? `${min}–${max}` : `${min ?? max}`
  return `${range}${currency}${period}`
}

/** The French contract label: the record's own fr name, else the code mapping. */
export function contractLabel(hit: WkHit): string | null {
  const fromRecord = hit.contract_type_names?.fr
  if (fromRecord) return fromRecord
  const code = hit.contract_type
  return code ? (CONTRACT_LABELS_FR[code] ?? code) : null
}

/**
 * The public job URL: /fr/companies/<org>/jobs/<slug>. This path carries no query
 * string, so it is on the allowed side of the site's robots.txt.
 */
export function jobUrl(orgSlug: string, jobSlug: string): string {
  return `${BOARD_URL}/fr/companies/${orgSlug}/jobs/${jobSlug}`
}

/**
 * Reshape one Algolia hit into the contract result shape. The `id` is
 * "<org-slug>/<job-slug>" because that pair — not the Algolia objectID — is what
 * addresses the public job page that `detail` reads.
 */
export function toResult(hit: WkHit): JobResult | null {
  const jobSlug = hit.slug
  const orgSlug = hit.organization?.slug
  if (!jobSlug || !orgSlug) return null
  return {
    id: `${orgSlug}/${jobSlug}`,
    title: hit.name || "(sans titre)",
    company: hit.organization?.name || null,
    location: formatLocation(hit),
    date: hit.published_at ?? null,
    url: jobUrl(orgSlug, jobSlug),
    contract: contractLabel(hit),
    contract_type: hit.contract_type ?? null,
    remote: hit.remote ?? null,
    salary: formatSalary(hit),
    department: hit.department ?? null,
    experience_years: hit.experience_level_minimum ?? null,
    reference: hit.reference ?? null,
  }
}

/**
 * Drop repeats of the same posting. Welcomekit indexes one record per job *per
 * website*, so the same `reference` can come back several times; the first hit
 * wins (Algolia already ordered them).
 */
export function dedupe(results: JobResult[]): JobResult[] {
  const seen = new Set<string>()
  const out: JobResult[] = []
  for (const r of results) {
    const key = r.reference || r.id
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
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
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    // Ampersand last: decoding it first would let "&amp;lt;" become "<".
    .replace(/&amp;/g, "&")
}

/** Strip an HTML fragment to readable prose, keeping paragraph breaks. */
export function cleanHtml(html: string | null | undefined): string | null {
  if (!html) return null
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d|tr)>/gi, "\n")
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

/**
 * Escape raw control characters that sit *inside* JSON string literals. The
 * board embeds unescaped newlines in its ld+json, which is invalid JSON and makes
 * a plain JSON.parse throw; blanket-escaping would corrupt the newlines that
 * pretty-printing puts *between* tokens, so this tracks string state.
 */
export function escapeControlCharsInStrings(text: string): string {
  let out = ""
  let inString = false
  let escaped = false
  for (const ch of text) {
    if (escaped) {
      out += ch
      escaped = false
      continue
    }
    if (ch === "\\") {
      out += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      out += ch
      continue
    }
    if (inString && ch < " ") {
      out +=
        ch === "\n"
          ? "\\n"
          : ch === "\r"
            ? "\\r"
            : ch === "\t"
              ? "\\t"
              : "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0")
      continue
    }
    out += ch
  }
  return out
}

export interface LdJobPosting {
  "@type"?: string
  title?: string
  description?: string
  qualifications?: string
  educationRequirements?: string
  experienceRequirements?: string
  employmentType?: string
  datePosted?: string
  validThrough?: string
  baseSalary?: unknown
  hiringOrganization?: { name?: string }
  jobLocation?: Array<{ address?: Record<string, string> }> | { address?: Record<string, string> }
}

/**
 * Pull the schema.org JobPosting out of a job page. Each ld+json block is parsed
 * independently so a malformed one (or the FAQPage block) cannot hide the rest.
 */
export function parseJobPosting(html: string): LdJobPosting | null {
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )
  for (const block of blocks) {
    const raw = block[1]
    let parsed: unknown = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      try {
        parsed = JSON.parse(escapeControlCharsInStrings(raw))
      } catch {
        continue
      }
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed]
    for (const c of candidates) {
      if (c && typeof c === "object" && (c as LdJobPosting)["@type"] === "JobPosting") {
        return c as LdJobPosting
      }
    }
  }
  return null
}

/** ld+json employmentType ("FULL_TIME" or "Full-Time") -> French label. */
export function contractFromLd(employmentType: string | undefined): {
  label: string | null
  code: string | null
} {
  if (!employmentType) return { label: null, code: null }
  const direct = CONTRACT_LABELS_FR[employmentType.toUpperCase().replace(/[\s-]/g, "_")]
  if (direct) {
    return { label: direct, code: employmentType.toUpperCase().replace(/[\s-]/g, "_") }
  }
  const viaAlias = resolveAlias(CONTRACT_ALIASES, employmentType)
  return viaAlias
    ? { label: CONTRACT_LABELS_FR[viaAlias] ?? viaAlias, code: viaAlias }
    : { label: employmentType, code: null }
}

/**
 * Expand an ISO-3166 alpha-2 country code to its English name. The ld+json emits
 * `"FR"` where the search index emits `"France"`; without this, the same job
 * reads "Paris, FR" from `detail` and "Paris, France" from `search`. Anything
 * that is not a bare 2-letter code passes through untouched.
 */
export function countryName(raw: string): string {
  if (!/^[A-Za-z]{2}$/.test(raw)) return raw
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(raw.toUpperCase()) ?? raw
  } catch {
    return raw
  }
}

/** "Paris, France" from the ld+json jobLocation (single object or array). */
export function locationFromLd(ld: LdJobPosting): string | null {
  const raw = ld.jobLocation
  const first = Array.isArray(raw) ? raw[0] : raw
  const address = first?.address
  if (!address) return null
  const place = address.addressLocality || address.addressRegion || null
  const country = address.addressCountry ? countryName(address.addressCountry) : null
  if (place && country) return `${place}, ${country}`
  return place || country || null
}

/** A salary line from ld+json baseSalary, which the boards emit in several shapes. */
export function salaryFromLd(baseSalary: unknown): string | null {
  if (baseSalary == null) return null
  if (typeof baseSalary === "string" || typeof baseSalary === "number") {
    return String(baseSalary) || null
  }
  if (typeof baseSalary !== "object") return null
  const b = baseSalary as Record<string, unknown>
  const currency = typeof b.currency === "string" ? ` ${b.currency}` : ""
  const value = b.value as Record<string, unknown> | undefined
  if (value && typeof value === "object") {
    const min = value.minValue ?? value.value ?? null
    const max = value.maxValue ?? null
    const unit = typeof value.unitText === "string" ? `/${value.unitText.toLowerCase()}` : ""
    if (min == null && max == null) return null
    const range = min != null && max != null && min !== max ? `${min}–${max}` : `${min ?? max}`
    return `${range}${currency}${unit}`
  }
  return null
}

/**
 * Parse a job identifier: either "<org-slug>/<job-slug>" or a full job URL from
 * this board. Returns null for anything else (so `detail` fails fast, offline).
 */
export function normalizeId(input: string): { org: string; slug: string } | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const fromUrl = trimmed.match(/\/companies\/([^/?#]+)\/jobs\/([^/?#]+)/)
  if (fromUrl) return { org: fromUrl[1], slug: fromUrl[2] }
  if (/^https?:\/\//i.test(trimmed)) return null
  const pair = trimmed.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/)
  if (pair) return { org: pair[1], slug: pair[2] }
  return null
}

/** Epoch-ms for "N days ago", used as the --jobage cutoff. */
export function cutoffDate(days: number): number {
  return Date.now() - days * 86400000
}

/**
 * Epoch-ms for a posting date. Compare and sort on this, never on the raw
 * string: `published_at` carries a local UTC offset (`…+02:00`) while other
 * timestamps are `…Z`, so lexicographic comparison silently misorders postings
 * whose offsets differ. NaN-safe — an unparseable or absent date sorts oldest.
 */
export function timestamp(date: string | null | undefined): number {
  if (!date) return Number.NEGATIVE_INFINITY
  const ms = Date.parse(date)
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

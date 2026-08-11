// Data source: Arbeitnow's public job-board JSON API (https://www.arbeitnow.com/api/job-board-api).
// No authentication required. The API's own response embeds its terms: "This is a free public
// API for jobs, please do not abuse." (see meta.terms in any response) — keep volume low.
//
// IMPORTANT: this API does NOT support server-side keyword/location/remote filtering, despite
// looking like it might. Verified during development: passing ?search=, ?q=, ?title=,
// ?keyword=, ?tags=, ?location=, or a gibberish param name+value all return the exact same
// result set (identical first job, byte-for-byte), and ?remote=true still returns a mix of
// remote:true and remote:false jobs. Only ?page=<n> genuinely changes the response. This CLI
// therefore fetches one server page (default page 1, ~176 jobs) per call and filters
// client-side against title/company_name/tags/location/created_at — it does not scan multiple
// pages automatically, since the API has no "last page" and jobs are just chronological, not
// search-indexed.

export const BASE_URL = "https://www.arbeitnow.com"
export const API_URL = "https://www.arbeitnow.com/api/job-board-api"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

async function fetchWithBackoff(url: string, accept: string): Promise<Response> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept },
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
    return response
  }
  throw new Error("Request failed after max retries")
}

interface ApiJob {
  slug: string
  company_name: string
  title: string
  description: string
  remote: boolean
  url: string
  tags: string[]
  job_types: string[]
  location: string
  created_at: number
}

interface ApiResponse {
  data: ApiJob[]
  links: { first: string; last: string | null; prev: string | null; next: string | null }
  meta: { current_page: number; per_page: number }
}

/** Fetch one page of the raw job-board API. Returns null on a 404. */
export async function fetchApiPage(page: number): Promise<ApiResponse | null> {
  const response = await fetchWithBackoff(`${API_URL}?page=${page}`, "application/json")
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as ApiResponse
}

/** Fetch a job's own page (for JSON-LD detail extraction). Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const response = await fetchWithBackoff(url, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
  if (response.status === 404) return ""
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`)
  }
  return response.text()
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
  description: string | null
  employmentType: string | null
  datePosted: string | null
  validThrough: string | null
  benefits: string | null
  remote: boolean | null
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

// Arbeitnow job descriptions (many originally in German) use named HTML entities for
// accented characters — e.g. "&uuml;bernimmst", "Gesch&auml;ftsmodelle", "&Uuml;bernahme" —
// not just numeric entities. Confirmed live: a real posting's description came through with
// literal "&uuml;" text until this table was added. Covers the Latin-1 letters that appear in
// German (and other Western European languages) plus common punctuation entities.
const NAMED_ENTITIES: Record<string, string> = {
  auml: "ä", ouml: "ö", uuml: "ü", szlig: "ß",
  Auml: "Ä", Ouml: "Ö", Uuml: "Ü",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  Eacute: "É", Egrave: "È", Ecirc: "Ê", Euml: "Ë",
  aacute: "á", agrave: "à", acirc: "â", atilde: "ã", aring: "å", aelig: "æ",
  Aacute: "Á", Agrave: "À", Acirc: "Â", Atilde: "Ã", Aring: "Å", AElig: "Æ",
  iacute: "í", igrave: "ì", icirc: "î", iuml: "ï",
  Iacute: "Í", Igrave: "Ì", Icirc: "Î", Iuml: "Ï",
  oacute: "ó", ograve: "ò", ocirc: "ô", otilde: "õ", oslash: "ø",
  Oacute: "Ó", Ograve: "Ò", Ocirc: "Ô", Otilde: "Õ", Oslash: "Ø",
  uacute: "ú", ugrave: "ù", ucirc: "û",
  Uacute: "Ú", Ugrave: "Ù", Ucirc: "Û",
  ntilde: "ñ", Ntilde: "Ñ", ccedil: "ç", Ccedil: "Ç",
  yacute: "ý", yuml: "ÿ", Yacute: "Ý",
  hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  copy: "©", reg: "®", trade: "™", euro: "€",
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
    .replace(/&([a-zA-Z]+);/g, (full, name) => NAMED_ENTITIES[name] ?? full)
    .replace(/&nbsp;/g, " ")
}

/** Convert the API's raw description HTML to clean plain text with paragraph breaks. */
function cleanDescription(html: string): string | null {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  const text = decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{2,}/g, "\n").trim()
  return text || null
}

export interface ListOpts {
  query?: string
  location?: string
  jobageDays?: number
  limit?: number
}

/**
 * Filter one API page's jobs client-side (see the module-level note on why: the API itself
 * does not support search). Matches `query` case-insensitively against title, company name,
 * and tags; `location` case-insensitively as a substring of the location field; `jobageDays`
 * against `created_at`.
 */
export function filterJobs(page: ApiResponse, opts: ListOpts): JobCard[] {
  const now = Math.floor(Date.now() / 1000)
  const q = opts.query?.toLowerCase()
  const loc = opts.location?.toLowerCase()

  let jobs = page.data
  if (q) {
    jobs = jobs.filter(
      (j) =>
        j.title.toLowerCase().includes(q) ||
        j.company_name.toLowerCase().includes(q) ||
        j.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }
  if (loc) {
    jobs = jobs.filter((j) => j.location.toLowerCase().includes(loc))
  }
  if (opts.jobageDays !== undefined) {
    const cutoff = now - opts.jobageDays * 86400
    jobs = jobs.filter((j) => j.created_at >= cutoff)
  }
  if (opts.limit !== undefined && opts.limit >= 0) {
    jobs = jobs.slice(0, opts.limit)
  }

  return jobs.map((j) => ({
    id: j.slug,
    title: decodeHtmlEntities(j.title),
    company: j.company_name ? decodeHtmlEntities(j.company_name) : null,
    location: j.location || null,
    date: new Date(j.created_at * 1000).toISOString(),
    url: j.url,
  }))
}

export function extractMeta(page: ApiResponse): { count: number; page: number; perPage: number } {
  return { count: page.data.length, page: page.meta.current_page, perPage: page.meta.per_page }
}

/**
 * Extract the JobPosting JSON-LD block from a job's own page. Arbeitnow embeds full
 * structured data here (title, company, location, ISO datePosted/validThrough,
 * employmentType, benefits) — more complete than the listing API for a single job.
 */
export function parseJobDetail(html: string, fallbackUrl: string): JobDetail | null {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  for (const s of scripts) {
    let parsed: any
    try {
      parsed = JSON.parse(s[1]!)
    } catch {
      continue
    }
    const graph: any[] = Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed]
    const jp = graph.find((g) => g["@type"] === "JobPosting")
    if (!jp) continue

    const address = jp.jobLocation?.address ?? {}
    const location = [address.addressLocality, address.addressRegion, address.addressCountry]
      .filter(Boolean)
      .join(", ") || null

    const idMatch = fallbackUrl.match(/([^/]+)\/?$/)
    return {
      id: idMatch ? idMatch[1]! : fallbackUrl,
      title: jp.title ?? "(untitled)",
      company: jp.hiringOrganization?.name ?? null,
      location,
      date: jp.datePosted ?? null,
      url: fallbackUrl,
      description: jp.description ? cleanDescription(jp.description) : null,
      employmentType: jp.employmentType ?? null,
      datePosted: jp.datePosted ?? null,
      validThrough: jp.validThrough ?? null,
      benefits: jp.jobBenefits ?? null,
      remote: null,
    }
  }
  return null
}

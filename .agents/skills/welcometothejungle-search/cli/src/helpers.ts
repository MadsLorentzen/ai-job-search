// Data source: Welcome to the Jungle's public Algolia search index (search) and
// its public read-only jobs API (detail). No login and no API key of your own is
// required — the Algolia application id and search-only key below are the same
// public credentials the WTTJ website ships to every browser. The search key is
// referer-restricted, so every Algolia request sends the WTTJ Referer header.
//
// Personal use only. This reads WTTJ's public data; keep volume low and do not use
// it commercially or for bulk data collection. Run it on your own responsibility.

// --- Public credentials (shipped in the WTTJ frontend; search-only, referer-locked) ---
export const ALGOLIA_APP = "CSEKHVMS53"
export const ALGOLIA_KEY = "4bd8f6215d0cc52b26430765769e65a0"
export const ALGOLIA_URL = `https://${ALGOLIA_APP}-dsn.algolia.net/1/indexes/*/queries`
export const JOBS_INDEX = "wk_cms_jobs_production"
export const WTTJ_REFERER = "https://www.welcometothejungle.com/"

// Public read-only jobs API used by the detail command.
export const RESOLVE_API = "https://api.welcometothejungle.com/api/v1/jobs" // /{reference}
export const ORG_JOB_API = "https://api.welcometothejungle.com/api/v1/organizations" // /{org}/jobs/{slug}
export const SITE = "https://www.welcometothejungle.com"

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

async function backoffFetch(url: string, init: RequestInit): Promise<Response> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, init)
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

/** POST an Algolia query (single index). `params` is a URL-encoded query string. */
export async function algoliaQuery(params: string): Promise<AlgoliaResult> {
  const response = await backoffFetch(ALGOLIA_URL, {
    method: "POST",
    headers: {
      "X-Algolia-Application-Id": ALGOLIA_APP,
      "X-Algolia-API-Key": ALGOLIA_KEY,
      "Content-Type": "application/json",
      // The public search key is restricted to the WTTJ referer.
      Referer: WTTJ_REFERER,
      Origin: SITE,
      "User-Agent": UA,
    },
    body: JSON.stringify({ requests: [{ indexName: JOBS_INDEX, params }] }),
  })
  if (!response.ok) {
    throw new Error(`Algolia request failed: ${response.status} ${response.statusText}`)
  }
  const json = (await response.json()) as { results: AlgoliaResult[] }
  return json.results[0]
}

/** GET JSON from the public WTTJ API. Returns null on a 404. */
export async function getJson(url: string): Promise<any | null> {
  const response = await backoffFetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    redirect: "follow",
  })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

// --- Types ---

interface AlgoliaResult {
  hits: RawHit[]
  nbHits: number
  page: number
  nbPages: number
}

interface RawHit {
  objectID: string
  reference?: string
  name?: string
  slug?: string
  remote?: string
  contract_type?: string
  contract_type_names?: Record<string, string>
  published_at?: string
  experience_level_minimum?: number | null
  salary_minimum?: number | null
  salary_maximum?: number | null
  salary_currency?: string | null
  salary_period?: string | null
  organization?: { name?: string; slug?: string }
  offices?: Office[]
}

interface Office {
  city?: string | null
  state?: string | null
  country?: string | null
  country_code?: string | null
}

export interface JobCard {
  reference: string | null
  objectID: string
  title: string
  company: string | null
  companySlug: string | null
  location: string | null
  remote: string | null
  contractType: string | null
  date: string | null
  slug: string | null
  url: string
}

export interface JobDetail extends JobCard {
  experienceYears: number | null
  salary: string | null
  skills: string[] | null
  description: string | null
  profile: string | null
  applyUrl: string | null
}

// --- Formatting helpers ---

function formatOffices(offices: Office[] | undefined): string | null {
  if (!offices || offices.length === 0) return null
  const first = offices[0]
  const parts = [first.city, first.country_code || first.country].filter(Boolean)
  let loc = parts.join(", ") || null
  if (loc && offices.length > 1) loc += ` (+${offices.length - 1} more)`
  return loc
}

function jobUrl(slug: string | undefined): string {
  return slug ? `${SITE}/en/jobs/${slug}` : SITE
}

function formatSalary(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string | null | undefined,
  period: string | null | undefined,
): string | null {
  if (!min && !max) return null
  const range = min && max ? `${min}–${max}` : String(min || max)
  const per = period && period !== "none" ? ` / ${period}` : ""
  return `${range} ${currency || ""}${per}`.trim()
}

/** Map an Algolia hit to a search card. */
export function toCard(hit: RawHit): JobCard {
  return {
    reference: hit.reference ?? null,
    objectID: hit.objectID,
    title: hit.name || "(untitled)",
    company: hit.organization?.name ?? null,
    companySlug: hit.organization?.slug ?? null,
    location: formatOffices(hit.offices),
    remote: hit.remote ?? null,
    contractType: hit.contract_type_names?.en || hit.contract_type || null,
    date: hit.published_at ?? null,
    slug: hit.slug ?? null,
    url: jobUrl(hit.slug),
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&nbsp;/g, " ")
}

/** Convert an HTML fragment to readable plain text, keeping paragraph breaks. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

/** Map the detail API's job object to a JobDetail. */
export function toDetail(job: any): JobDetail {
  const card = toCard({
    objectID: String(job.id ?? job.reference ?? ""),
    reference: job.reference,
    name: job.name,
    slug: job.slug,
    remote: job.remote,
    contract_type: job.contract_type,
    published_at: job.published_at,
    organization: { name: job.organization?.name, slug: job.organization?.slug },
    offices: job.offices,
  })
  const skills = Array.isArray(job.skills)
    ? job.skills.map((s: any) => (typeof s === "string" ? s : s?.name)).filter(Boolean)
    : null
  return {
    ...card,
    contractType: card.contractType,
    experienceYears:
      typeof job.experience_level_minimum === "number" ? job.experience_level_minimum : null,
    salary: formatSalary(job.salary_min, job.salary_max, job.salary_currency, job.salary_period),
    skills: skills && skills.length ? skills : null,
    description: htmlToText(job.description),
    profile: htmlToText(job.profile),
    applyUrl: job.apply_url ?? null,
  }
}

// --- Flag → facet mapping ---

/** Map a user-facing remote mode to the WTTJ `remote` facet value. */
export function remoteFacet(mode: string | undefined): string | null {
  switch ((mode || "").toLowerCase()) {
    case "full":
    case "fulltime":
    case "remote":
      return "fulltime"
    case "hybrid":
    case "partial":
      return "partial"
    case "occasional":
    case "punctual":
      return "punctual"
    case "none":
    case "no":
    case "onsite":
    case "on-site":
      return "no"
    default:
      return null
  }
}

/** Map a user-facing contract type to the WTTJ `contract_type` facet value. */
export function contractFacet(type: string | undefined): string | null {
  if (!type) return null
  return type.trim().toUpperCase().replace(/[\s-]+/g, "_")
}

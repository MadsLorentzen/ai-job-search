// Data source: Welcome to the Jungle (formerly Otta). otta.com now 301-redirects
// to the Welcome to the Jungle platform. Its public job board is powered by a
// public, read-only Algolia index (`wk_cms_jobs_production`, app `CSEKHVMS53`) —
// the same index the website's own front-end queries client-side. No login is
// required for search. Full job detail comes from the site's unauthenticated
// REST API (`api.welcometothejungle.com`), because the public HTML job pages sit
// behind an AWS WAF bot-challenge and are not fetchable by a plain client.

export const ALGOLIA_APP_ID = "CSEKHVMS53"
// Public, search-only Algolia key embedded in the Welcome to the Jungle front-end.
export const ALGOLIA_API_KEY = "4bd8f6215d0cc52b26430765769e65a0"
export const ALGOLIA_URL = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`
export const JOBS_INDEX = "wk_cms_jobs_production"
export const REST_BASE = "https://api.welcometothejungle.com/api/v1"
export const SITE_BASE = "https://www.welcometothejungle.com/en"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; otta-search-cli/1.0)"

async function backoff(attempt: number, delay: number): Promise<number> {
  const jitter = Math.floor(Math.random() * 500)
  await new Promise((r) => setTimeout(r, delay + jitter))
  return Math.min(delay * 2, 8000)
}

/** POST a JSON body with exponential backoff on 429/5xx. Returns parsed JSON. */
export async function jsonPost(url: string, body: unknown): Promise<any> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "x-algolia-application-id": ALGOLIA_APP_ID,
        "x-algolia-api-key": ALGOLIA_API_KEY,
        Origin: "https://www.welcometothejungle.com",
      },
      body: JSON.stringify(body),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      delay = await backoff(attempt, delay)
      continue
    }
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }
  throw new Error("Request failed after max retries")
}

/** GET JSON with backoff. Returns null on 404. */
export async function jsonGet(url: string): Promise<any | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      redirect: "follow",
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      delay = await backoff(attempt, delay)
      continue
    }
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }
  throw new Error("Request failed after max retries")
}

export interface JobCard {
  id: string
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
  description: string | null
  profile: string | null
  seniority: string | null
  educationLevel: string | null
  salary: string | null
  applyUrl: string | null
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

/** Strip HTML tags but keep paragraph/list breaks as newlines. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

/** Build the public canonical URL for a job on the Welcome to the Jungle site. */
export function jobUrl(companySlug: string | null, slug: string | null): string {
  if (companySlug && slug) return `${SITE_BASE}/companies/${companySlug}/jobs/${slug}`
  return SITE_BASE
}

function officeToLocation(office: any): string | null {
  if (!office) return null
  const parts = [office.city, office.country_code].filter(Boolean)
  return parts.length ? parts.join(", ") : office.country || null
}

/** Map a friendly remote mode to the index's `remote` facet value. */
export function remoteFacet(mode: string | undefined): string | null {
  switch ((mode || "").toLowerCase()) {
    case "remote":
    case "fulltime":
    case "full-time":
      return "fulltime"
    case "hybrid":
    case "partial":
      return "partial"
    case "occasional":
    case "punctual":
      return "punctual"
    case "onsite":
    case "on-site":
    case "none":
      return "none"
    default:
      return null
  }
}

/** Parse one Algolia hit into a JobCard. */
export function parseHit(hit: any): JobCard | null {
  if (!hit || !hit.objectID) return null
  const org = hit.organization || {}
  const companySlug: string | null = org.slug ?? null
  const contract =
    (hit.contract_type_names && (hit.contract_type_names.en || hit.contract_type_names.fr)) ||
    hit.contract_type ||
    null
  return {
    id: String(hit.objectID),
    title: hit.name ? decodeHtmlEntities(String(hit.name)) : "(untitled)",
    company: org.name ? decodeHtmlEntities(String(org.name)) : null,
    companySlug,
    location: officeToLocation(hit.office),
    remote: hit.remote ?? null,
    contractType: contract,
    date: hit.published_at ?? null,
    slug: hit.slug ?? null,
    url: jobUrl(companySlug, hit.slug ?? null),
  }
}

/** Parse the REST detail payload (`{ job: {...} }`) into a JobDetail. */
export function parseDetail(payload: any, id: string): JobDetail {
  const job = payload?.job ?? payload ?? {}
  const org = job.organization || {}
  const office = Array.isArray(job.offices) ? job.offices[0] : job.office
  const canonical =
    (Array.isArray(job.urls) && job.urls.find((u: any) => u.kind === "canonical")?.href) || null
  const companySlug: string | null = org.slug ?? deriveOrgSlug(canonical)
  const contract =
    (job.contract_type_names && (job.contract_type_names.en || job.contract_type_names.fr)) ||
    job.contract_type ||
    null
  let salary: string | null = null
  if (job.salary_min || job.salary_max) {
    const cur = job.salary_currency || ""
    const period = job.salary_period ? `/${String(job.salary_period).toLowerCase()}` : ""
    salary = `${job.salary_min ?? "?"}–${job.salary_max ?? "?"} ${cur}${period}`.trim()
  }
  return {
    id,
    title: job.name ? decodeHtmlEntities(String(job.name)) : "(untitled)",
    company: org.name ? decodeHtmlEntities(String(org.name)) : null,
    companySlug,
    location: officeToLocation(
      office
        ? { city: office.city, country_code: office.country_code, country: office.country }
        : null,
    ),
    remote: job.remote ?? null,
    contractType: contract,
    date: job.published_at ?? null,
    slug: job.slug ?? null,
    url: canonical || jobUrl(companySlug, job.slug ?? null),
    description: htmlToText(job.description),
    profile: htmlToText(job.profile),
    seniority: job.experience_level ?? job.experience_level_minimum ?? null,
    educationLevel: job.education_level ?? null,
    salary,
    applyUrl: job.apply_url ?? null,
  }
}

function deriveOrgSlug(canonical: string | null): string | null {
  if (!canonical) return null
  const m = canonical.match(/\/companies\/([^/]+)\/jobs\//)
  return m ? m[1] : null
}

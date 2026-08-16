// Data source: Y Combinator's "Work at a Startup" (workatastartup.com).
// The site is a server-rendered Inertia.js app: every public page embeds its
// props as a single JSON blob in a `data-page="..."` attribute. We extract and
// parse that JSON — far more robust than scraping card markup.
//
// Public, unauthenticated pages used here:
//   /jobs                       -> JobsPage, default (Software Engineer) listing
//   /jobs/l/<role-slug>         -> JobsPage, filtered to one role category
//   /jobs/<id>                  -> JobDetailPage, one job's full description
//
// There is NO public free-text search endpoint and NO pagination on the portal:
// each category returns a fixed set (~25-30 jobs). Keyword/location filtering and
// paging are therefore done client-side over the fetched listings.

export const BASE_URL = "https://www.workatastartup.com"

// The ten public role categories, from the homepage `roleLinks`.
export const ROLE_SLUGS = [
  "software-engineer",
  "designer",
  "product-manager",
  "operations",
  "sales-manager",
  "marketing",
  "recruiting",
  "science",
  "legal",
  "finance",
] as const

export type RoleSlug = (typeof ROLE_SLUGS)[number]

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; ycombinator-search-cli/1.0)"

/** Fetch a page's HTML with exponential backoff on 429/5xx. Returns "" on 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
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

/** Decode the five XML entities Inertia uses to encode the data-page attribute. */
function unescapeAttr(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, "&")
}

/** Extract and parse the Inertia `data-page` JSON props from a page's HTML. */
export function extractPageProps(html: string): Record<string, unknown> | null {
  const m = html.match(/data-page="([^"]*)"/)
  if (!m) return null
  try {
    const parsed = JSON.parse(unescapeAttr(m[1])) as { props?: Record<string, unknown> }
    return parsed.props ?? null
  } catch {
    return null
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
}

/** Convert an HTML fragment to readable plain text, preserving block breaks. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  roleType: string | null
  jobType: string | null
  salary: string | null
  companySlug: string | null
  companyBatch: string | null
  companyOneLiner: string | null
  companyLastActiveAt: string | null
  applyUrl: string | null
}

export interface JobDetail {
  id: string
  title: string
  company: string | null
  companyBatch: string | null
  companyLocation: string | null
  companyUrl: string | null
  location: string | null
  jobType: string | null
  salaryRange: string | null
  equityRange: string | null
  minExperience: string | null
  sponsorsVisa: string | null
  skills: string[]
  description: string | null
  interviewProcess: string | null
  url: string
  applyUrl: string | null
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null
}

/** Normalise one raw item from a JobsPage `jobs` array into a JobCard. */
export function mapJobCard(raw: Record<string, unknown>): JobCard | null {
  const id = raw.id != null ? String(raw.id) : null
  if (!id) return null
  return {
    id,
    title: str(raw.title) ?? "(untitled)",
    company: str(raw.companyName),
    location: str(raw.location),
    date: null, // portal exposes no posting date on public listings
    url: `${BASE_URL}/jobs/${id}`,
    roleType: str(raw.roleType),
    jobType: str(raw.jobType),
    salary: str(raw.salary),
    companySlug: str(raw.companySlug),
    companyBatch: str(raw.companyBatch),
    companyOneLiner: str(raw.companyOneLiner),
    companyLastActiveAt: str(raw.companyLastActiveAt),
    applyUrl: str(raw.applyUrl),
  }
}

/** Fetch a role category (or the default listing) and return its job cards. */
export async function fetchListing(role?: string): Promise<JobCard[]> {
  const url = role ? `${BASE_URL}/jobs/l/${role}` : `${BASE_URL}/jobs`
  const html = await htmlFetch(url)
  if (!html) return []
  const props = extractPageProps(html)
  const jobs = props?.jobs
  if (!Array.isArray(jobs)) return []
  return jobs
    .map((j) => (j && typeof j === "object" ? mapJobCard(j as Record<string, unknown>) : null))
    .filter((j): j is JobCard => j !== null)
}

/** Fetch and parse a single job's detail page. Returns null on 404. */
export async function fetchDetail(id: string): Promise<JobDetail | null> {
  const html = await htmlFetch(`${BASE_URL}/jobs/${id}`)
  if (!html) return null
  const props = extractPageProps(html)
  if (!props) return null
  const job = (props.job ?? {}) as Record<string, unknown>
  const company = (props.company ?? {}) as Record<string, unknown>
  const skills = Array.isArray(job.skills)
    ? (job.skills as unknown[]).map((s) => String(s)).filter(Boolean)
    : []
  return {
    id,
    title: str(job.title) ?? "(untitled)",
    company: str(company.name),
    companyBatch: str(company.batch),
    companyLocation: str(company.location),
    companyUrl: str(company.url),
    location: str(job.location),
    jobType: str(job.jobType),
    salaryRange: str(job.salaryRange),
    equityRange: str(job.equityRange),
    minExperience: str(job.minExperience),
    sponsorsVisa: str(job.sponsorsVisa),
    skills,
    description: htmlToText(str(job.descriptionHtml)),
    interviewProcess: htmlToText(str(job.interviewProcessHtml)),
    url: `${BASE_URL}/jobs/${id}`,
    applyUrl: str(props.applyUrl) ?? str(job.applyUrl),
  }
}

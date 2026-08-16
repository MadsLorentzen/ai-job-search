// Data source: Protocol Jobs' public jobs API (api.protocoljobs.ai).
// The app's authenticated keyword search (`/api/jobs/search`) is login-gated (401),
// but the public `/api/featured-jobs` endpoint is backed by the full listing
// database (~19k roles) and accepts the same `{ filters, page }` body — including a
// free-text `keyword` inside `filters` — so the skill searches through it directly.
// Responses are JSON, so there is no HTML parsing; only the detail `description`
// field carries HTML that we strip/decode.

export const API_BASE = "https://api.protocoljobs.ai"
export const SEARCH_URL = `${API_BASE}/api/featured-jobs`
export const DETAIL_URL = `${API_BASE}/api/jobs/details`

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; protocoljobs-search-cli/1.0)"

/** POST/GET JSON with exponential backoff on 429/5xx. Returns null on a 404. */
export async function jsonFetch<T = unknown>(
  url: string,
  body?: unknown,
): Promise<T | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: "https://app.protocoljobs.ai",
        Referer: "https://app.protocoljobs.ai/",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
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
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return (await response.json()) as T
  }
  throw new Error("Request failed after max retries")
}

export interface JobResult {
  id: string
  title: string
  company: string | null
  companyTier: number | null
  location: string | null
  workplaceType: string | null
  date: string | null
  domain: string | null
  experienceBands: string[] | null
  experience: { minValue: number | null; maxValue: number | null } | null
  salary: { minValue: number | null; maxValue: number | null } | null
  competition: string | null
  shortlisting: string | null
  source: string | null
  url: string | null
}

export interface JobDetail extends JobResult {
  description: string | null
}

// ---- Filter-value mapping -------------------------------------------------

// Location option ids the API accepts (from /api/env/config). Keys are aliases
// (lower-case, substring-matched against the user's --location text).
const LOCATION_ALIASES: Array<[RegExp, string]> = [
  [/\bremote\b/, "REMOTE"],
  [/\bhybrid\b/, "HYBRID"],
  [/\btier\s*1\b/, "TIER_1_CITIES"],
  [/\b(bengaluru|bangalore|blr)\b/, "BENGALURU"],
  [/\bmumbai\b/, "MUMBAI"],
  [/\bpune\b/, "PUNE"],
  [/\b(delhi|ncr|new delhi)\b/, "DELHI_NCR"],
  [/\b(gurgaon|gurugram)\b/, "GURGAON"],
  [/\bnoida\b/, "NOIDA"],
  [/\bhyderabad\b/, "HYDERABAD"],
  [/\bchennai\b/, "CHENNAI"],
  [/\bkolkata\b/, "KOLKATA"],
  [/\bahmedabad\b/, "AHMEDABAD"],
]

/** Resolve free-text location to an API location code, or null if unrecognised. */
export function resolveLocation(input: string | undefined): string | null {
  if (!input) return null
  const s = input.toLowerCase()
  for (const [re, code] of LOCATION_ALIASES) if (re.test(s)) return code
  const upper = input.trim().toUpperCase().replace(/\s+/g, "_")
  const known = LOCATION_ALIASES.map(([, c]) => c)
  return known.includes(upper) ? upper : null
}

const DOMAIN_ALIASES: Record<string, string> = {
  product: "product",
  frontend: "frontend",
  front: "frontend",
  backend: "backend",
  back: "backend",
  fullstack: "fullstack",
  qa: "qa",
  testing: "qa",
  devops: "devops",
  cloud: "cloud",
  ml: "ml_ai",
  ai: "ml_ai",
  ml_ai: "ml_ai",
  data: "data",
  mobile: "mobile",
  design: "product_design",
  product_design: "product_design",
  pm: "project_program_management",
  program: "project_program_management",
  project: "project_program_management",
  project_program_management: "project_program_management",
}

/** Resolve a --domain token to an API domain code, or null if unrecognised. */
export function resolveDomain(input: string | undefined): string | null {
  if (!input) return null
  return DOMAIN_ALIASES[input.trim().toLowerCase()] ?? null
}

/** Map a job-age in days to the API's nearest jobFreshness bucket. */
export function jobageToFreshness(days: number): string | null {
  if (!days || days <= 0 || days >= 9999) return null
  if (days <= 2) return "last48Hours"
  if (days <= 3) return "last72Hours"
  if (days <= 7) return "last1Week"
  if (days <= 14) return "last2Weeks"
  return "last4Weeks"
}

// ---- Response mapping -----------------------------------------------------

interface RawLocation {
  cityCode?: string
  stateCode?: string
  countryCode?: string
}

const COUNTRY_LABELS: Record<string, string> = { IN: "India" }

function titleCaseCode(code: string): string {
  return code
    .split("_")
    .map((w) => (w === "NCR" ? "NCR" : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(" ")
}

function formatLocation(
  locations: RawLocation[] | undefined,
  workplaceType: string | undefined,
): string | null {
  const wp = workplaceType ? workplaceType.toLowerCase() : null
  const parts = (locations ?? [])
    .filter((l) => l.cityCode && l.cityCode.toUpperCase() !== "UNKNOWN")
    .map((l) => {
      const city = titleCaseCode(l.cityCode as string)
      const country = l.countryCode ? COUNTRY_LABELS[l.countryCode] ?? l.countryCode : null
      return country ? `${city}, ${country}` : city
    })
  let base = parts.join("; ")
  if (!base) base = wp === "remote" ? "Remote" : ""
  if (wp && wp !== "office" && base && base.toLowerCase() !== wp) base = `${base} (${wp})`
  return base || null
}

interface RawJob {
  id: string
  title?: string
  company?: { name?: string; tier?: number }
  locations?: RawLocation[]
  workplaceType?: string
  firstPublishedTime?: string
  lastPublishedTime?: string
  domain?: string
  experienceBands?: string[]
  experience?: { minValue?: number; maxValue?: number }
  salary?: { minValue?: number; maxValue?: number }
  competitionBenchmark?: { level?: string }
  shortlistingStrictness?: { level?: string }
  source?: string
  url?: string
  description?: string
}

function mapJob(j: RawJob): JobResult {
  return {
    id: j.id,
    title: j.title ?? "(untitled)",
    company: j.company?.name ?? null,
    companyTier: j.company?.tier ?? null,
    location: formatLocation(j.locations, j.workplaceType),
    workplaceType: j.workplaceType ?? null,
    date: j.firstPublishedTime ?? j.lastPublishedTime ?? null,
    domain: j.domain ?? null,
    experienceBands: j.experienceBands ?? null,
    experience: j.experience
      ? { minValue: j.experience.minValue ?? null, maxValue: j.experience.maxValue ?? null }
      : null,
    salary: j.salary
      ? { minValue: j.salary.minValue ?? null, maxValue: j.salary.maxValue ?? null }
      : null,
    competition: j.competitionBenchmark?.level ?? null,
    shortlisting: j.shortlistingStrictness?.level ?? null,
    source: j.source ?? null,
    url: j.url ?? null,
  }
}

export interface SearchResponse {
  items?: RawJob[]
  pageInfo?: { limit?: number; nextCursor?: string | null }
  totalCount?: number
}

export interface ParsedPage {
  results: JobResult[]
  nextCursor: string | null
  totalCount: number | null
}

export function parseSearchPage(data: SearchResponse | null): ParsedPage {
  const items = data?.items ?? []
  return {
    results: items.filter((j) => j && j.id).map(mapJob),
    nextCursor: data?.pageInfo?.nextCursor ?? null,
    totalCount: data?.totalCount ?? null,
  }
}

// ---- HTML description handling (detail only) ------------------------------

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ")
}

function cleanDescription(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d|tr)>/gi, "\n")
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ""))
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function mapDetail(j: RawJob): JobDetail {
  return {
    ...mapJob(j),
    description: j.description ? cleanDescription(j.description) || null : null,
  }
}

/** Extract a 24-hex Mongo job id from a bare id or a details URL. */
export function normalizeId(input: string): string | null {
  const m = input.match(/[a-f0-9]{24}/i)
  return m ? m[0].toLowerCase() : null
}

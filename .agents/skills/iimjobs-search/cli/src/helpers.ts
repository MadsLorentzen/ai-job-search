// Data source: iimjobs.com public "gladiator" JSON API. No authentication required.
// Search:  GET https://gladiator.iimjobs.com/job/search?query=<text>&page=<0-indexed>&...
//          -> { data: [...], page, count, totalJobs, totalPages, hasMore }
// Detail:  GET https://gladiator.iimjobs.com/job/detail?jobcode=<id>  (needs a Referer header)
//          -> { data: { ...introText (HTML description)... } }
// The API returns clean JSON, so there is no HTML parsing here.

export const SEARCH_URL = "https://gladiator.iimjobs.com/job/search"
export const DETAIL_URL = "https://gladiator.iimjobs.com/job/detail"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; iimjobs-search-cli/1.0)"

// City/region name -> iimjobs API location id. These are the ids the `loc` search
// filter actually uses (derived from the API's own location objects — they differ
// from the id list embedded in the site's JS bundle, so do not trust that one).
export const LOCATIONS: Record<string, number> = {
  "delhi ncr": 1,
  "delhi-ncr": 1,
  ncr: 1,
  mumbai: 2,
  bangalore: 3,
  bengaluru: 3,
  hyderabad: 4,
  kolkata: 5,
  chennai: 6,
  pune: 7,
  gujarat: 8,
  maharashtra: 9,
  mp: 10,
  "madhya pradesh": 10,
  jaipur: 11,
  guwahati: 12,
  chandigarh: 14,
  punjab: 15,
  haryana: 16,
  kerala: 17,
  jharkhand: 20,
  up: 21,
  "uttar pradesh": 21,
  us: 22,
  usa: 22,
  "united states": 22,
  singapore: 24,
  "middle east": 25,
  africa: 26,
  eu: 28,
  europe: 28,
  karnataka: 31,
  "tamil nadu": 32,
  rajasthan: 33,
  "andhra pradesh": 34,
  telangana: 35,
  delhi: 36,
  "new delhi": 36,
  gurgaon: 37,
  gurugram: 37,
  noida: 38,
  "greater noida": 39,
  faridabad: 40,
  ahmedabad: 53,
  gandhinagar: 55,
  vadodara: 56,
  baroda: 56,
  haridwar: 57,
  uttarakhand: 59,
  lucknow: 60,
  chhattisgarh: 64,
  "navi mumbai": 68,
  thane: 69,
  cochin: 70,
  kochi: 70,
  hosur: 71,
  raipur: 74,
  vijayawada: 76,
  vishakhapatnam: 78,
  visakhapatnam: 78,
  vizag: 78,
  coimbatore: 84,
  pondicherry: 85,
  puducherry: 85,
  metros: 87,
  "anywhere in india": 88,
  "multiple locations": 88,
  overseas: 89,
  international: 89,
  nigeria: 94,
  "saudi arabia": 101,
  tanzania: 116,
  bhopal: 121,
  assam: 123,
  indore: 130,
  mohali: 131,
  remote: 132,
  manesar: 138,
}

/** Resolve a --location value to a numeric loc id. Accepts a city name or a raw id. */
export function resolveLocation(input: string): number | null {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10)
  const key = trimmed.toLowerCase()
  if (key in LOCATIONS) return LOCATIONS[key]
  return null
}

/** Fetch JSON with exponential backoff on 429/5xx. Returns null on a 404. */
export async function jsonFetch<T = unknown>(url: string): Promise<T | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.iimjobs.com/",
        Origin: "https://www.iimjobs.com",
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
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return (await response.json()) as T
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
  minExp: number | null
  maxExp: number | null
  tags: string[]
  applyUrl: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
  designation: string | null
  industry: string | null
  functionalArea: string | null
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

/** Turn an HTML job-description blob into readable plain text with line breaks. */
function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, " - ")
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[ \t]+/gm, (m) => m.replace(/\t/g, " "))
    .trim()
}

// Raw API shapes (only the fields we consume).
interface RawTag {
  id: number
  name: string
}
interface RawLoc {
  id: number
  name: string
}
interface RawCompany {
  companyName?: string
  companyNameNotAnalyzed?: string
}
interface RawJob {
  id: number
  title?: string
  jobdesignation?: string
  jobDetailUrl?: string
  applyUrl?: string
  min?: number
  max?: number
  createdTime?: number
  confidential?: number
  createdByAlias?: string
  companyData?: RawCompany
  locations?: RawLoc[]
  location?: RawLoc[]
  tags?: RawTag[]
  industry?: string
  functionalArea?: number | string
  introText?: string
}
export interface SearchResponse {
  data: RawJob[]
  page: number
  count: number
  totalJobs: number
  totalPages: number
  hasMore: boolean
}
export interface DetailResponse {
  data: RawJob
}

function companyOf(job: RawJob): string | null {
  const name = job.companyData?.companyName || job.companyData?.companyNameNotAnalyzed
  if (name && name.trim()) return name.trim()
  if (job.confidential) return "Confidential"
  return null
}

function locationOf(job: RawJob): string | null {
  const locs = job.locations || job.location || []
  const names = locs.map((l) => l?.name).filter((n): n is string => !!n)
  return names.length ? [...new Set(names)].join(", ") : null
}

function isoDate(ms: number | undefined): string | null {
  if (!ms || !Number.isFinite(ms)) return null
  return new Date(ms).toISOString().slice(0, 10)
}

function tagNames(job: RawJob): string[] {
  return (job.tags || []).map((t) => t?.name).filter((n): n is string => !!n)
}

function cardFromRaw(job: RawJob): JobCard {
  const id = String(job.id)
  return {
    id,
    title: (job.title || job.jobdesignation || "(untitled)").trim(),
    company: companyOf(job),
    location: locationOf(job),
    date: isoDate(job.createdTime),
    url: job.jobDetailUrl || `https://www.iimjobs.com/j/${id}`,
    minExp: typeof job.min === "number" ? job.min : null,
    maxExp: typeof job.max === "number" ? job.max : null,
    tags: tagNames(job),
    applyUrl: job.applyUrl || null,
  }
}

export function parseSearch(resp: SearchResponse): JobCard[] {
  return (resp.data || []).map(cardFromRaw)
}

export function parseDetail(job: RawJob): JobDetail {
  const card = cardFromRaw(job)
  return {
    ...card,
    description: job.introText ? htmlToText(job.introText) || null : null,
    designation: job.jobdesignation?.trim() || null,
    industry: job.industry != null ? String(job.industry) : null,
    functionalArea: job.functionalArea != null ? String(job.functionalArea) : null,
  }
}

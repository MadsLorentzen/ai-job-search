// Data source: Hirist's public JSON job API (gladiator.hirist.tech), the same
// XHR endpoints hirist.tech's Next.js frontend calls anonymously. No auth, no
// API key, zero runtime dependencies.
//
// Personal use only. Keep volume low and do not use it commercially or for bulk
// data collection. Run it on your own responsibility.

export const BASE = "https://gladiator.hirist.tech/job"
export const SEARCH_URL = `${BASE}/search`
export const DETAIL_URL = `${BASE}/detail`

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; hirist-search-cli/1.0)"

/** Fetch JSON with exponential backoff on 429/5xx. Returns null on a 404. */
export async function jsonFetch<T = unknown>(url: string): Promise<T | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: "https://www.hirist.tech",
        Referer: "https://www.hirist.tech/",
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

/**
 * Canonical Hirist location ids (as used by the `loc` search filter and seen in
 * result `location[].id`). These are NOT the ids in the site's "popular cities"
 * quick-filter widget — those differ. Discovered empirically from live results.
 */
const LOCATIONS: Record<string, number> = {
  "delhi ncr": 1,
  delhi: 36,
  "new delhi": 36,
  mumbai: 2,
  bombay: 2,
  "navi mumbai": 68,
  thane: 69,
  bangalore: 3,
  bengaluru: 3,
  hyderabad: 4,
  kolkata: 5,
  calcutta: 5,
  chennai: 6,
  madras: 6,
  pune: 7,
  jaipur: 11,
  chandigarh: 14,
  maharashtra: 9,
  karnataka: 31,
  "tamil nadu": 32,
  rajasthan: 33,
  "andhra pradesh": 34,
  gurgaon: 37,
  gurugram: 37,
  "gurgaon/gurugram": 37,
  noida: 38,
  "greater noida": 39,
  faridabad: 40,
  ahmedabad: 53,
  vadodara: 56,
  baroda: 56,
  nagpur: 66,
  nasik: 67,
  nashik: 67,
  aurangabad: 79,
  cochin: 70,
  kochi: 70,
  trivandrum: 75,
  thiruvananthapuram: 75,
  vizag: 78,
  vishakhapatnam: 78,
  visakhapatnam: 78,
  coimbatore: 84,
  indore: 130,
  bhopal: 121,
  mohali: 131,
  udaipur: 51,
  remote: 132,
  anywhere: 88,
  "anywhere in india": 88,
  singapore: 24,
  malaysia: 27,
  dubai: 91,
  overseas: 89,
  international: 89,
}

/** Resolve a location name to Hirist's canonical loc id. Null if unknown. */
export function resolveLocation(name: string): number | null {
  const key = name.trim().toLowerCase()
  if (key in LOCATIONS) return LOCATIONS[key]
  // Loose match: user typed "Bangalore, India" or "Pune, Maharashtra".
  for (const [city, id] of Object.entries(LOCATIONS)) {
    if (key.includes(city)) return id
  }
  return null
}

export function knownLocations(): string[] {
  return Object.keys(LOCATIONS)
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  experience: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
  skills: string[]
  workFromHome: boolean
  applyUrl: string | null
}

/** Raw Hirist job object (subset of fields the CLI reads). */
export interface RawJob {
  id: number
  title?: string
  jobdesignation?: string
  min?: number
  max?: number
  minSal?: number
  maxSal?: number
  hideSal?: number
  confidential?: number
  workFromHome?: number
  companyData?: { companyName?: string }
  location?: Array<{ id: number; name: string }>
  createdTime?: number
  jobDetailUrl?: string
  applyUrl?: string
  introText?: string
  tags?: Array<{ id: number; name: string }>
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

/** HTML job body → readable text, keeping paragraph/line breaks as newlines. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function experienceOf(job: RawJob): string | null {
  const { min, max } = job
  if (min == null && max == null) return null
  if (min != null && max != null) return `${min}-${max} yrs`
  return `${min ?? max} yrs`
}

function companyOf(job: RawJob): string | null {
  if (job.confidential) return null
  const name = job.companyData?.companyName?.trim()
  return name && name.length ? name : null
}

function locationOf(job: RawJob): string | null {
  const names = (job.location ?? []).map((l) => l.name).filter(Boolean)
  return names.length ? names.join(", ") : null
}

/** Epoch-ms → ISO date (YYYY-MM-DD). Null if absent/invalid. */
function dateOf(job: RawJob): string | null {
  if (!job.createdTime) return null
  const d = new Date(job.createdTime)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function urlOf(job: RawJob): string {
  return job.jobDetailUrl || `https://www.hirist.tech/j/${job.id}`
}

export function toCard(job: RawJob): JobCard {
  return {
    id: String(job.id),
    title: (job.title || job.jobdesignation || "(untitled)").trim(),
    company: companyOf(job),
    location: locationOf(job),
    date: dateOf(job),
    url: urlOf(job),
    experience: experienceOf(job),
  }
}

export function toDetail(job: RawJob): JobDetail {
  return {
    ...toCard(job),
    description: job.introText ? htmlToText(job.introText) : null,
    skills: (job.tags ?? []).map((t) => t.name).filter(Boolean),
    workFromHome: !!job.workFromHome,
    applyUrl: urlOf(job),
  }
}

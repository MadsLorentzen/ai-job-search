// Data source: apna.co public web pages (Next.js). No authentication required.
// Listing pages (/jobs, /jobs/<slug>) are server-rendered and embed the full job
// objects in a <script id="__NEXT_DATA__"> JSON blob — we parse that directly
// instead of scraping rendered HTML. Job detail pages (App Router) embed a
// schema.org JobPosting in a <script id="jdp-job-schema"> ld+json blob.
//
// apna's free-text keyword search is app/auth-gated and NOT public, so the web
// only supports slug-based browsing: by city (jobs-in-<city>), by category
// (<category_slug>-jobs), by department (dep_<snake>-jobs), and combinations
// (<category_slug>-jobs-in-<city>). This CLI resolves the user's --query to the
// best category/department slug from apna's live catalog, then narrows the
// results client-side by keyword. See url-reference.md.

export const BASE = "https://apna.co"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; apna-search-cli/1.0)"

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
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

/** Extract the props.pageProps object from a listing page's __NEXT_DATA__ blob. */
export function extractPageProps(html: string): any | null {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  )
  if (!m) return null
  try {
    return JSON.parse(m[1])?.props?.pageProps ?? null
  } catch {
    return null
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&nbsp;/g, " ")
}

function stripTags(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  salary: string | null
  category: string | null
  department: string | null
  employmentType: string | null
  openings: number | null
  workFromHome: boolean
}

export interface JobDetail {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  salary: string | null
  employmentType: string | null
  industry: string | null
  category: string | null
  validThrough: string | null
  description: string | null
  applyUrl: string | null
}

/** Turn "50000" / "115000" monthly INR bounds into "₹50,000 - ₹1,15,000/month". */
function formatSalary(min: any, max: any, unit = "month"): string | null {
  const lo = Number(min)
  const hi = Number(max)
  const inr = (n: number) => "₹" + n.toLocaleString("en-IN")
  if (lo > 0 && hi > 0) {
    return lo === hi ? `${inr(lo)}/${unit}` : `${inr(lo)} - ${inr(hi)}/${unit}`
  }
  if (lo > 0) return `${inr(lo)}+/${unit}`
  if (hi > 0) return `Up to ${inr(hi)}/${unit}`
  return null
}

/** Map one pageProps.jobs[].data object to a JobCard. */
export function mapJob(data: any): JobCard | null {
  if (!data || data.id == null) return null
  const id = String(data.id)
  const title = (data.title || data.type || "").toString().trim()
  if (!title) return null
  const company = data.organization?.name?.trim() || null
  const area = data.address?.area || data.location_name || null
  const city = data.address?.city?.name || null
  const location = [area, city].filter((x) => x && x !== area).length
    ? `${area}, ${city}`
    : area || city || null
  const dept =
    typeof data.department === "object"
      ? data.department?.name ?? null
      : data.department ?? null
  return {
    id,
    title,
    company,
    location,
    date: data.created_on ? String(data.created_on).slice(0, 10) : null,
    url: data.public_url || `${BASE}/job/${id}`,
    salary: formatSalary(data.min_salary, data.max_salary),
    category: data.category || null,
    department: dept,
    employmentType: data.is_part_time ? "Part time" : data.is_flexible_job ? "Flexible" : "Full time",
    openings: typeof data.no_of_openings === "number" ? data.no_of_openings : null,
    workFromHome: Boolean(data.is_wfh),
  }
}

/** A city URL token: lowercase, non-alnum → single hyphen. "Delhi" -> "delhi". */
export function citySlug(location: string): string {
  return location
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

const STOP = new Set(["job", "jobs", "in", "the", "a", "for", "and", "of", "&", "naukri", "vacancy", "vacancies"])

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t))
}

/** Fuzzy token equality: exact, or a shared prefix ≥5 chars (telecaller≈telecalling). */
function tokMatch(a: string, b: string): boolean {
  if (a === b) return true
  let p = 0
  const n = Math.min(a.length, b.length)
  while (p < n && a[p] === b[p]) p++
  return p >= 5
}

/**
 * Resolve a free-text query to apna's best matching category/department slug,
 * scored by token overlap against the live catalog names. Returns null if
 * nothing overlaps (caller then browses by city only + client-side keyword filter).
 */
export function resolveSlug(
  query: string,
  categoryList: any[],
  departmentList: any[],
): string | null {
  const q = tokens(query)
  if (!q.length) return null

  const score = (name: string): number => {
    const n = tokens(name)
    return q.reduce((acc, t) => acc + (n.some((x) => tokMatch(t, x)) ? 1 : 0), 0)
  }

  let best: { slug: string; score: number } | null = null

  for (const c of categoryList || []) {
    const name = c?.type || c?.name
    const slug = c?.slug
    if (!name || !slug || slug === "all") continue
    const s = score(name)
    if (s > 0 && (!best || s > best.score)) best = { slug, score: s }
  }

  // Departments have no slug in the catalog; derive dep_<snake> from the name.
  for (const d of departmentList || []) {
    const name = d?.name || d?.type
    if (!name || name === "All") continue
    const s = score(name)
    if (s > 0 && (!best || s > best.score)) {
      best = { slug: "dep_" + citySlug(name).replace(/-/g, "_"), score: s }
    }
  }

  return best ? best.slug : null
}

/** True if the query's meaningful tokens appear in the card's title/category/type. */
export function keywordMatch(card: JobCard, query: string): boolean {
  const q = tokens(query)
  if (!q.length) return true
  const hay = tokens([card.title, card.category, card.department].filter(Boolean).join(" "))
  return q.some((t) => hay.some((x) => tokMatch(t, x)))
}

/** Parse the schema.org JobPosting ld+json from a detail page. */
export function parseJobDetail(html: string, id: string): JobDetail | null {
  const m = html.match(
    /<script id="jdp-job-schema"[^>]*>([\s\S]*?)<\/script>/,
  )
  if (!m) return null
  let d: any
  try {
    d = JSON.parse(m[1])
  } catch {
    return null
  }

  const org = d.hiringOrganization?.name?.trim() || null
  const addr = d.jobLocation?.address || {}
  const location =
    [addr.addressLocality, addr.addressRegion].filter(Boolean).join(", ") ||
    addr.streetAddress ||
    null

  const val = d.baseSalary?.value
  const unit = (val?.unitText || "MONTH").toLowerCase()
  const salary = val ? formatSalary(val.minValue, val.maxValue, unit) : null

  const empType = Array.isArray(d.employmentType)
    ? d.employmentType.join(", ")
    : d.employmentType || null

  return {
    id,
    title: (d.title || "").toString().trim() || "(untitled)",
    company: org,
    location,
    date: d.datePosted ? String(d.datePosted).slice(0, 10) : null,
    url: d.url || `${BASE}/job/${id}`,
    salary,
    employmentType: empType ? empType.replace(/_/g, " ") : null,
    industry: d.industry || null,
    category: d.occupationalCategory || null,
    validThrough: d.validThrough || null,
    description: d.description ? stripTags(d.description) : null,
    applyUrl: d.directApply ? d.url || null : d.url || null,
  }
}

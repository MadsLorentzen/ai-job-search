// Data source: CutShort's PUBLIC, robots-allowed surfaces only.
//   - Search: the sitemap https://cutshort.io/sitemap_jobs.xml (explicitly listed in
//     robots.txt) — a flat <urlset> of every public /job/<slug>-<id> page + <lastmod>.
//   - Detail: the public job page https://cutshort.io/job/<id>, which serves the same
//     content whether you pass the full slug or the bare id. Every field we need is in
//     the page's embedded __NEXT_DATA__ JSON as a schema.org JobPosting node.
//
// We deliberately do NOT touch CutShort's live job_search API: robots.txt disallows the
// `?free_text` / `?job_listing` query params it uses, and its "real" feed is a
// login-gated, profile-matching experience. The sitemap + public job pages are the only
// unauthenticated, robots-compliant way in, so search filters the sitemap by keyword and
// enriches each returned row from its public job page.

export const SITEMAP_URL = "https://cutshort.io/sitemap_jobs.xml"
export const JOB_BASE = "https://cutshort.io/job"
export const PAGE_SIZE = 20 // sitemap has no server paging; we page client-side

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; cutshort-search-cli/1.0)"

/** Fetch a URL with exponential backoff + jitter on 429/5xx. Returns "" on 404. */
export async function fetchText(url: string): Promise<string> {
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

export interface JobCard {
  id: string
  title: string | null
  company: string | null
  location: string | null
  date: string | null
  url: string
}

export interface JobDetail extends JobCard {
  employmentType: string | null
  validThrough: string | null
  salary: string | null
  skills: string | null
  description: string | null
  applyUrl: string | null
}

export interface SitemapEntry {
  id: string
  slug: string
  url: string
  lastmod: string | null
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

/** Turn an HTML fragment into readable plain text, preserving paragraph breaks. */
function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/�/g, "") // drop stray replacement characters
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** The bare job id is the final hyphen-delimited segment of a /job/ URL or slug. */
export function idFromLoc(loc: string): string {
  const last = loc.replace(/[?#].*$/, "").replace(/\/$/, "").split("/").pop() ?? ""
  return last.split("-").pop() ?? last
}

/** Parse the flat <urlset> jobs sitemap into id/slug/url/lastmod rows. */
export function parseSitemap(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = []
  const blocks = xml.split(/<url>/i).slice(1)
  for (const block of blocks) {
    const locM = block.match(/<loc>\s*([^<\s]+)\s*<\/loc>/i)
    if (!locM) continue
    const url = locM[1]
    if (!/\/job\//i.test(url)) continue
    const lastM = block.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i)
    const slug = url.replace(/[?#].*$/, "").replace(/\/$/, "").split("/").pop() ?? ""
    entries.push({
      id: idFromLoc(url),
      slug,
      url,
      lastmod: lastM ? lastM[1] : null,
    })
  }
  return entries
}

/** Recursively locate the first schema.org JobPosting node in a parsed object graph. */
function findJobPosting(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item)
      if (found) return found
    }
    return null
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>
    if (obj["@type"] === "JobPosting") return obj
    for (const key of Object.keys(obj)) {
      const found = findJobPosting(obj[key])
      if (found) return found
    }
  }
  return null
}

function asString(v: unknown): string | null {
  if (typeof v === "string") return v || null
  if (typeof v === "number") return String(v)
  return null
}

function formatEmploymentType(v: unknown): string | null {
  const arr = Array.isArray(v) ? v : v == null ? [] : [v]
  const labels = arr
    .map((x) => asString(x))
    .filter((x): x is string => !!x)
    .map((x) =>
      x
        .toLowerCase()
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join("-"),
    )
  return labels.length ? labels.join(", ") : null
}

function formatSalary(base: unknown): string | null {
  if (!base || typeof base !== "object") return null
  const b = base as Record<string, unknown>
  const currency = asString(b.currency) ?? ""
  const value = b.value as Record<string, unknown> | undefined
  if (!value || typeof value !== "object") return null
  const min = asString(value.minValue)
  const max = asString(value.maxValue)
  const unit = asString(value.unitText)
  if (!min && !max) return null
  const range = min && max ? `${min}–${max}` : min || max
  return `${currency} ${range}${unit ? ` / ${unit}` : ""}`.trim()
}

/** Parse a public /job/<id> page into a JobDetail from its embedded JobPosting JSON-LD. */
export function parseJobDetail(html: string, id: string, url: string): JobDetail | null {
  const m = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
  )
  if (!m) return null
  let data: unknown
  try {
    data = JSON.parse(m[1])
  } catch {
    return null
  }
  const jp = findJobPosting(data)
  if (!jp) return null

  const org = jp.hiringOrganization as Record<string, unknown> | undefined
  const place = jp.jobLocation as Record<string, unknown> | undefined
  const addr = place?.address as Record<string, unknown> | undefined
  const locality = asString(addr?.addressLocality)
  const region = asString(addr?.addressRegion)
  const location = [locality, region].filter(Boolean).join(", ") || null

  const rawDesc = asString(jp.description)

  return {
    id,
    title: asString(jp.title),
    company: asString(org?.name),
    location,
    date: asString(jp.datePosted),
    url,
    employmentType: formatEmploymentType(jp.employmentType),
    validThrough: asString(jp.validThrough),
    salary: formatSalary(jp.baseSalary),
    skills: asString(jp.skills),
    description: rawDesc ? htmlToText(rawDesc) : null,
    applyUrl: url,
  }
}

/** Human-readable fallback title from a slug when detail enrichment fails. */
export function titleFromSlug(slug: string): string {
  return slug.replace(/-[A-Za-z0-9]{6,12}$/, "").replace(/-/g, " ").trim() || slug
}

/** Lowercased, space-joined form of a slug for keyword matching. */
export function slugHaystack(entry: SitemapEntry): string {
  return entry.slug.replace(/-/g, " ").toLowerCase()
}

/** True if every whitespace-delimited token in `query` appears in `haystack`. */
export function matchesTokens(haystack: string, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  return tokens.every((t) => haystack.includes(t))
}

/** Narrow a full JobDetail down to the shared JobCard shape. */
export function cardFromDetail(d: JobDetail): JobCard {
  return { id: d.id, title: d.title, company: d.company, location: d.location, date: d.date, url: d.url }
}

/** Run `fn` over `items` with a bounded concurrency pool, preserving order. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker)
  await Promise.all(workers)
  return results
}

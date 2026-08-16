// Data source: aijobs.net public, server-rendered job pages. No authentication required.
// robots.txt allows crawling (only /account/ is disallowed; no AI/Claude bot restriction).
// The listing UI is server-rendered HTML (no public JSON API — the site's "Export JSON"
// is a stateful, CSRF-protected POST tied to session search context, so we parse HTML).
// Markup is shallow and stable, so regex parsing is sufficient (zero runtime deps).

export const BASE_URL = "https://aijobs.net"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; aijobs-search-cli/1.0)"

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
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

export interface JobCard {
  id: string
  title: string
  company: string | null
  companyUrl: string | null
  location: string | null
  date: string | null
  url: string
  salary: string | null
  level: string | null
  employmentType: string | null
  remote: boolean
  skills: string[]
}

export interface JobDetail extends JobCard {
  description: string | null
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

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html))
}

/** Extract the /job/<slug>/ path segment (the slug incl. trailing numeric id). */
function slugFromJobPath(path: string): string {
  const m = path.match(/\/job\/([^/?"]+)/)
  return m ? m[1] : path.replace(/^\/+|\/+$/g, "")
}

/** aijobs.net obscures the on-page company name; the /company/<slug>-<id>/ link
 *  carries the real name in its slug. Title-case it, dropping the trailing id. */
function companyFromSlug(slug: string): string {
  return slug
    .replace(/-\d+$/, "")
    .split("-")
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toLowerCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .trim()
}

/** First text-bg-success badge that carries a digit (the salary; a lone "R" is a remote flag). */
function firstSalary(html: string): string | null {
  const re = /class="text-bg-success[^"]*">([\s\S]*?)<\/span>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const t = clean(m[1])
    if (/\d/.test(t)) return t
  }
  return null
}

/** Convert a relative age like "1h ago" / "7d ago" / "3w ago" to {iso, days}. */
export function relativeToDate(rel: string): { iso: string | null; days: number } {
  const m = rel.match(/(\d+)\s*(m|min|h|hr|d|w|mo|y)/i)
  if (!m) return { iso: null, days: 0 }
  const n = parseInt(m[1], 10)
  const unit = m[2].toLowerCase()
  const perDay: Record<string, number> = { m: 0, min: 0, h: 0, hr: 0, d: 1, w: 7, mo: 30, y: 365 }
  const days = Math.round(n * (perDay[unit] ?? 0))
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return { iso: d.toISOString().slice(0, 10), days }
}

/**
 * Parse the search response: a flat list of <li> job cards. Split per card so a
 * single malformed card cannot break the rest. Company is not exposed on the
 * listing (only on the detail page), so it is null here.
 */
export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []
  const chunks = html.split(/<li class="d-flex justify-content-between position-relative/).slice(1)

  for (const chunk of chunks) {
    const link = chunk.match(/href="(\/job\/[^"]+)"/i)
    if (!link) continue
    const path = decodeHtmlEntities(link[1])
    const slug = slugFromJobPath(path)

    const titleMatch = chunk.match(/href="\/job\/[^"]+"[^>]*>([\s\S]*?)<\/a>/i)
    // The anchor may carry "Featured"/"Feat." badge <span>s before the bare
    // title text node; strip any inner <span>…</span> so only the title remains.
    const title = titleMatch ? clean(titleMatch[1].replace(/<span[^>]*>[\s\S]*?<\/span>/gi, "")) : null
    if (!title) continue

    // A lone "R" is a remote badge (same class as salary); the salary always
    // carries a digit, so pick the first text-bg-success span containing one.
    const salary = firstSalary(chunk)

    const levelMatch = chunk.match(/class="text-bg-warning[^"]*">([\s\S]*?)<\/span>/i)
    const level = levelMatch ? clean(levelMatch[1]) || null : null

    const typeMatch = chunk.match(/class="text-bg-secondary[^"]*">([\s\S]*?)<\/span>/i)
    const employmentType = typeMatch ? clean(typeMatch[1]) || null : null

    // Location + relative date: the innermost <div> immediately before the muted
    // "…ago" div. The negative lookahead keeps us from crossing an outer <div>.
    // The location text may be followed by a lone "R" remote badge span, which we drop.
    const locDate = chunk.match(
      /<div>\s*((?:(?!<div)[\s\S])*?)<\/div>\s*<div class="text-muted">([\s\S]*?)<\/div>/i,
    )
    const rawLoc = locDate ? locDate[1].replace(/<span[^>]*>[\s\S]*?<\/span>/gi, "") : ""
    const location = locDate ? clean(rawLoc) || null : null
    const remote = locDate ? /class="[^"]*text-bg-success[^"]*">\s*R\s*</i.test(locDate[1]) : false
    const rel = locDate ? clean(locDate[2]) : ""
    const date = rel ? relativeToDate(rel).iso : null

    // Skills tags live in the first inner div after the title/salary row.
    const skillBlock = chunk.match(/<\/a>[\s\S]*?<div>\s*((?:<span>[\s\S]*?<\/span>\s*\|?\s*)+)<\/div>/i)
    const skills = skillBlock
      ? Array.from(skillBlock[1].matchAll(/<span>([\s\S]*?)<\/span>/gi)).map((s) => clean(s[1])).filter(Boolean)
      : []

    results.push({
      id: slug,
      title,
      company: null,
      companyUrl: null,
      location,
      date,
      url: `${BASE_URL}/job/${slug}/`,
      salary,
      level,
      employmentType,
      remote,
      skills,
    })
  }

  return results
}

/** Parse the single-job detail page. */
export function parseJobDetail(html: string, slug: string): JobDetail {
  const titleMatch = html.match(/<h1[^>]*class="font-monospace[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
  const title = titleMatch ? clean(titleMatch[1]) : "(untitled)"

  const locMatch = html.match(/<strong>([\s\S]*?)<\/strong>/i)
  const location = locMatch ? clean(locMatch[1]) || null : null

  const salary = firstSalary(html)
  const levelMatch = html.match(/class="text-bg-warning[^"]*">([\s\S]*?)<\/span>/i)
  const level = levelMatch ? clean(levelMatch[1]) || null : null
  const typeMatch = html.match(/class="text-bg-secondary[^"]*">([\s\S]*?)<\/span>/i)
  const employmentType = typeMatch ? clean(typeMatch[1]) || null : null

  const companyMatch = html.match(/href="\/company\/([^"]+?)\/?"/i)
  const companySlug = companyMatch ? companyMatch[1] : null
  const company = companySlug ? companyFromSlug(companySlug) || null : null
  const companyUrl = companySlug ? `${BASE_URL}/company/${companySlug}/` : null

  const applyMatch = html.match(/class="btn btn-primary"[^>]*href="([^"]+)"/i)
  let applyUrl: string | null = null
  if (applyMatch) {
    const href = decodeHtmlEntities(applyMatch[1])
    applyUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`
  }

  // The verb varies ("Found"/"Published"/"Posted"); match the relative age token directly.
  const dateMatch = html.match(/(\d+\s*(?:min|mo|hr|[mhdwy])\s*ago)/i)
  const date = dateMatch ? relativeToDate(clean(dateMatch[1])).iso : null

  // Description: the structured content sections (Tasks / Perks / Skills / …)
  // rendered as <h5>Label</h5> followed by a <ul> or <p>. We stop at the
  // taxonomy sections (Roles/Regions/Countries/States/Cities) which are just tags.
  const stopAt = ["Roles", "Regions", "Countries", "States", "Cities"]
  const secRe = /<h5[^>]*>([\s\S]*?)<\/h5>\s*((?:<ul>[\s\S]*?<\/ul>)|(?:<p>[\s\S]*?<\/p>))/gi
  const parts: string[] = []
  let sm: RegExpExecArray | null
  while ((sm = secRe.exec(html)) !== null) {
    const label = clean(sm[1])
    if (stopAt.includes(label)) continue
    const body = sm[2]
      .replace(/<\/li>/gi, "\n")
      .replace(/<li>/gi, "• ")
      .replace(/<[^>]+>/g, " ")
    const text = decodeHtmlEntities(body).replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim()
    const isEmpty = !text || text.replace(/[•\s]/g, "") === "N/A"
    if (!isEmpty) parts.push(`${label}\n${text}`)
  }
  const description = parts.length ? parts.join("\n\n") : null

  return {
    id: slug,
    title,
    company,
    companyUrl,
    location,
    date,
    url: `${BASE_URL}/job/${slug}/`,
    salary,
    level,
    employmentType,
    remote: /class="[^"]*text-bg-success[^"]*">\s*R\s*</i.test(html),
    skills: [],
    description,
    applyUrl,
  }
}

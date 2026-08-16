// Data source: Foundit (formerly Monster India) public job-detail pages.
// A job page at https://www.foundit.in/job/<slug>-<id> (or the bare
// https://www.foundit.in/job/<id>) is server-rendered and embeds a
// schema.org JobPosting block as <script type="application/ld+json">.
// We parse that JSON-LD directly — it is stable and complete.
//
// There is intentionally NO search data source: Foundit's keyword/location
// search API lives under /middleware/ (disallowed by robots.txt) and its
// HTML /search/ pages are bot-protected (HTTP 403 to non-browser clients).
// See url-reference.md. This skill is detail-only by design.

export const JOB_URL = "https://www.foundit.in/job"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; foundit-search-cli/1.0)"

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(
          `Request failed: ${response.status} ${response.statusText}`,
        )
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return ""
    if (!response.ok) {
      throw new Error(
        `Request failed: ${response.status} ${response.statusText}`,
      )
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

export interface JobDetail {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  description: string | null
  employmentType: string | null
  deadline: string | null
  experienceMonths: number | null
  category: string | null
  industry: string | null
  skills: string[]
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

/** Strip HTML tags to readable text, preserving paragraph/line breaks. */
function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d|tr)>/gi, "\n")
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * Extract the JobPosting JSON-LD object from a job page. The page carries
 * several ld+json blocks (BreadcrumbList, etc.); we pick the JobPosting one.
 */
function extractJobPosting(html: string): Record<string, unknown> | null {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim()
    if (!raw.includes('"JobPosting"')) continue
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>
      if (obj["@type"] === "JobPosting") return obj
    } catch {
      // Malformed block — keep scanning for another JobPosting block.
    }
  }
  return null
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

/** jobLocation may be an object or an array of objects. */
function readLocation(v: unknown): string | null {
  const one = (loc: unknown): string | null => {
    if (!loc || typeof loc !== "object") return null
    const addr = (loc as Record<string, unknown>)["address"]
    if (!addr || typeof addr !== "object") return null
    return asString((addr as Record<string, unknown>)["addressLocality"])
  }
  if (Array.isArray(v)) {
    const parts = v.map(one).filter((x): x is string => !!x)
    return parts.length ? [...new Set(parts)].join("; ") : null
  }
  return one(v)
}

/** Parse the JobPosting JSON-LD into our JobDetail shape. */
export function parseJobDetail(html: string, fallbackId: string): JobDetail {
  const jp = extractJobPosting(html)
  if (!jp) {
    return {
      id: fallbackId,
      title: "(untitled)",
      company: null,
      location: null,
      date: null,
      url: `${JOB_URL}/${fallbackId}`,
      description: null,
      employmentType: null,
      deadline: null,
      experienceMonths: null,
      category: null,
      industry: null,
      skills: [],
      applyUrl: null,
    }
  }

  const identifier = jp["identifier"] as Record<string, unknown> | undefined
  const idVal = identifier ? identifier["value"] : undefined
  const id = idVal != null ? String(idVal) : fallbackId

  const org = jp["hiringOrganization"] as Record<string, unknown> | undefined
  const company = org ? asString(org["name"]) : null

  const rawDesc = asString(jp["description"])
  const description = rawDesc ? htmlToText(rawDesc) || null : null

  const exp = jp["experienceRequirements"] as
    | Record<string, unknown>
    | undefined
  const months =
    exp && typeof exp["monthsOfExperience"] === "number"
      ? (exp["monthsOfExperience"] as number)
      : null

  const industryRaw = jp["industry"]
  const industry = Array.isArray(industryRaw)
    ? industryRaw.map(String).join(", ") || null
    : asString(industryRaw)

  const skillsRaw = jp["skills"]
  const skills = Array.isArray(skillsRaw)
    ? skillsRaw.map(String).filter(Boolean)
    : asString(skillsRaw)
      ? [asString(skillsRaw) as string]
      : []

  const url = asString(jp["url"]) ?? `${JOB_URL}/${id}`

  return {
    id,
    title: asString(jp["title"]) ?? "(untitled)",
    company,
    location: readLocation(jp["jobLocation"]),
    date: asString(jp["datePosted"]),
    url,
    description,
    employmentType: asString(jp["employmentType"]),
    deadline: asString(jp["validThrough"]),
    experienceMonths: months,
    category: asString(jp["occupationalCategory"]),
    industry,
    skills,
    applyUrl: url,
  }
}

/** Accept a full foundit /job/ URL or a bare numeric id; return the id. */
export function normalizeId(input: string): string | null {
  const fromUrl = input.match(/\/job\/(?:[^/?#]*-)?(\d{5,})(?:[/?#]|$)/i)
  if (fromUrl) return fromUrl[1]
  const anyTrailing = input.match(/(\d{5,})(?:[/?#]|$)/)
  if (input.includes("foundit") && anyTrailing) return anyTrailing[1]
  const bare = input.match(/^\d{5,}$/)
  if (bare) return input
  return null
}

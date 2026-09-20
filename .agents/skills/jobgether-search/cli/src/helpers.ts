// Data source: jobgether.com's public REST API, documented at /astroapi/ai/jobs/docs
// and built explicitly "for AI agents/assistants" — search returns structured JSON,
// so there is no HTML card parsing (unlike the scraping portals). `detail` is the
// exception: there is no JSON endpoint for a single posting, so it fetches the
// offer page's HTML and reads the embedded JobPosting JSON-LD block instead of
// parsing markup by hand.

export const BASE_URL = "https://jobgether.com"
const UA = "Mozilla/5.0 (compatible; jobgether-search-cli/1.0)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** An error carrying jobgether's own machine-readable `code` (see /astroapi/ai/jobs/docs). */
export class ApiError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = "ApiError"
    this.code = code
  }
}

interface ProblemJson {
  detail?: string
  code?: string
  error?: string
}

async function parseProblem(response: Response): Promise<ProblemJson | null> {
  return (await response.json().catch(() => null)) as ProblemJson | null
}

/**
 * GET JSON from the jobgether API. Retries 429/5xx (transient server states,
 * including the documented 504 "search exceeded its server-side budget") with
 * exponential backoff and jitter, max 6 retries. A 4xx (typically `invalid_parameter`
 * for an unrecognized locations/jobReferences/contractType/experience value) is
 * surfaced as an `ApiError` carrying the API's own `code` and `detail` message
 * rather than a hardcoded client-side enum check — the API is the source of truth
 * for its own controlled vocabularies (see url-reference.md).
 */
export async function apiGet<T>(path: string): Promise<T> {
  const url = `${BASE_URL}${path}`
  const maxRetries = 6
  let delay = 500

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      })
    } catch (e) {
      throw new Error(`could not reach jobgether.com (${e instanceof Error ? e.message : String(e)})`)
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        const problem = await parseProblem(response)
        throw new ApiError(
          problem?.detail ||
            `jobgether API request failed: ${response.status} ${response.statusText}`,
          (problem?.code || (response.status === 504 ? "timeout" : "internal_error")).toUpperCase(),
        )
      }
      await sleep(delay + Math.floor(Math.random() * 500))
      delay = Math.min(delay * 2, 8000)
      continue
    }

    if (!response.ok) {
      const problem = await parseProblem(response)
      throw new ApiError(
        problem?.detail ||
          problem?.error ||
          `jobgether API request failed: ${response.status} ${response.statusText}`,
        (problem?.code || "api_error").toUpperCase(),
      )
    }

    return (await response.json()) as T
  }
  throw new Error("jobgether API request failed after retries")
}

/** One job as returned by GET /api/v1/jobs. */
export interface JobgetherJob {
  id: string
  title: string
  company: string
  url: string
  location: string
  remote?: string
  contractType?: string
  experience?: string
  salaryRange?: string
  jobFunctions?: string[]
  postedAt: string
}

export interface SearchEnvelope {
  jobs: JobgetherJob[]
  pagination: { page: number; limit: number; hasMore: boolean }
  browseOnSiteUrl: string
}

/** A search result in the portal-skill contract shape; extra fields are a permitted superset. */
export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  remote: string | null
  contractType: string | null
  experience: string | null
  salaryRange: string | null
  jobFunctions: string[]
}

export function toResult(j: JobgetherJob): JobResult {
  return {
    id: j.id,
    title: j.title || "(untitled)",
    company: j.company || null,
    location: j.location || null,
    date: j.postedAt || null,
    url: j.url,
    remote: j.remote || null,
    contractType: j.contractType || null,
    experience: j.experience || null,
    salaryRange: j.salaryRange || null,
    jobFunctions: j.jobFunctions || [],
  }
}

/** A job detail: the search-result fields (best-effort, some unavailable from the offer page) plus description/deadline/apply link. */
export interface JobDetailResult extends JobResult {
  description: string | null
  employmentType: string | null
  deadline: string | null
  applyUrl: string | null
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

/** Strip a JobPosting description's HTML into readable prose: block/line-break tags become newlines. */
export function cleanHtml(html: string | null | undefined): string | null {
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

/**
 * Fetch an offer page's HTML with the CLI's honest User-Agent. Retries 429/5xx
 * with backoff; treats 404/410 (removed or expired posting) as "not found".
 *
 * A 403 here is a Cloudflare WAF default that specifically guards jobgether's
 * human-facing /offer/ pages (verified live: the JSON API never 403s this UA,
 * only the HTML page does, and a full browser User-Agent gets 200 on the same
 * URL). `robots.txt` does **not** disallow this path — it only blocks literal
 * unresolved-placeholder paths (`/offer/{*}`) — so this is exactly the WAF-vs-policy
 * case the workspace's escalation procedure exists for. This function does not
 * auto-escalate to browser headers: per the add-portal contract, that retry goes
 * through the robots.txt-gated procedure in
 * .claude/skills/job-application-assistant/09-web-research.md, invoked deliberately
 * by whoever is calling this CLI, not baked into its default.
 */
export async function fetchOfferHtml(url: string): Promise<string | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      })
    } catch (e) {
      throw new Error(`could not reach jobgether.com (${e instanceof Error ? e.message : String(e)})`)
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`request failed: ${response.status} ${response.statusText}`)
      }
      await sleep(delay + Math.floor(Math.random() * 500))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404 || response.status === 410) return null
    if (response.status === 403) {
      throw new ApiError(
        "jobgether.com returned 403 for this offer page. This is a Cloudflare WAF default on the CLI's honest User-Agent, not a robots.txt refusal (this path is allowed). This CLI does not auto-escalate to a browser User-Agent by design — see the retry procedure in .claude/skills/job-application-assistant/09-web-research.md (check robots_check.py, then curl with browser headers) if you need this posting's full detail.",
        "FORBIDDEN",
      )
    }
    if (!response.ok) {
      throw new Error(`request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("request failed after max retries")
}

/** Extract a 24-hex Mongo-style job id from a bare id or a /offer/<id>-<slug> URL. */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  const urlMatch = trimmed.match(/\/offer\/([0-9a-f]{24})(?:-|\/|\?|$)/i)
  if (urlMatch) return urlMatch[1]
  if (/^[0-9a-f]{24}$/i.test(trimmed)) return trimmed
  return null
}

/**
 * Build an offer URL from a bare id. The trailing slug is cosmetic — jobgether
 * resolves the page from the id prefix alone and ignores the rest (verified live:
 * an arbitrary placeholder slug still returns 200) — so this works without first
 * looking up the posting's real slug via search.
 */
export function buildOfferUrl(id: string): string {
  return `${BASE_URL}/offer/${id}-job`
}

interface JsonLdJobPosting {
  title?: string
  description?: string
  hiringOrganization?: { name?: string }
  datePosted?: string
  employmentType?: string | string[]
  validThrough?: string
  applicantLocationRequirements?: Array<{ name?: string }>
}

function extractJobPostingLd(html: string): JsonLdJobPosting | null {
  const blocks = html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)
  for (const b of blocks) {
    try {
      const parsed = JSON.parse(b[1])
      if (parsed && parsed["@type"] === "JobPosting") return parsed as JsonLdJobPosting
    } catch {
      continue
    }
  }
  return null
}

/**
 * Parse an offer page into a job detail. Reads the embedded `JobPosting` JSON-LD
 * block for title/description/company/employmentType/validThrough, and the
 * `data-apply-url` attribute for the real (external ATS) apply link — jobgether's
 * own `/auto-apply` link on the page is a redirect wrapper, not the destination.
 *
 * `location` here is best-effort: JSON-LD only carries ISO country codes
 * (`applicantLocationRequirements`), coarser than search results' human-readable
 * location (e.g. "AT" vs "Austria"). Prefer the `location` a `search` call already
 * returned for the same posting when you have one.
 */
export function parseOfferDetail(html: string, id: string, url: string): JobDetailResult {
  const posting = extractJobPostingLd(html)

  const applyMatch = html.match(/data-apply-url="([^"]+)"/i)
  const applyUrl = applyMatch ? decodeHtmlEntities(applyMatch[1]) : null

  const employmentType = Array.isArray(posting?.employmentType)
    ? posting.employmentType.join(", ")
    : posting?.employmentType || null

  const location =
    (posting?.applicantLocationRequirements || [])
      .map((r) => r?.name)
      .filter((v): v is string => Boolean(v))
      .join(", ") || null

  return {
    id,
    title: posting?.title || "(untitled)",
    company: posting?.hiringOrganization?.name || null,
    location,
    date: posting?.datePosted || null,
    url,
    remote: null,
    contractType: null,
    experience: null,
    salaryRange: null,
    jobFunctions: [],
    description: cleanHtml(posting?.description),
    employmentType,
    deadline: posting?.validThrough || null,
    applyUrl,
  }
}

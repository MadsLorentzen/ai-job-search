// Data source: Hitmarker's Typesense search backend at search.hitmarker.com,
// collection `hitmarker_jobs`. The public site (hitmarker.net/jobs) is a Vue SPA
// that talks to this backend directly with a scoped, search-only API key
// (`TSSK`) embedded in the page HTML on every load — the same "secured search
// key" pattern as Algolia's public keys. Confirmed via live browser network
// capture on 2026-07-31 (static grep of the minified bundles found the
// Typesense client wiring but not the collection name or key value — those
// only appeared in the actual request payloads).
//
// The scoped key is search-only: a direct document-retrieve call
// (`/collections/hitmarker_jobs/documents/<id>`) returns 401 with this key.
// `detail` therefore reuses `multi_search` with `filter_by: id:=<id>`, which
// the scoped key does allow.

export const SEARCH_HOST = "https://search.hitmarker.com"
const JOBS_PAGE = "https://hitmarker.net/jobs"
const COLLECTION = "hitmarker_jobs"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
    } catch (e) {
      throw new Error(`could not reach ${url} (${e instanceof Error ? e.message : String(e)})`)
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) throw new Error(`request failed: ${response.status} ${response.statusText}`)
      await sleep(delay + Math.floor(Math.random() * 500))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    return response
  }
  throw new Error("request failed after retries")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * The Typesense scoped search key changes if Hitmarker rotates it, so it is
 * fetched fresh from the jobs page HTML rather than hardcoded. Cached for the
 * lifetime of one CLI invocation (one process = one or two API calls, so no
 * cross-run cache is needed).
 */
let cachedKey: string | null = null

export async function getSearchKey(): Promise<string> {
  if (cachedKey) return cachedKey
  const response = await fetchWithRetry(JOBS_PAGE, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    redirect: "follow",
  })
  if (!response.ok) {
    throw new Error(`could not load ${JOBS_PAGE} to read the search key: ${response.status} ${response.statusText}`)
  }
  const html = await response.text()
  const m = html.match(/TSSK\s*=\s*"([^"]+)"/)
  if (!m) throw new Error("could not find the TSSK search key on the Hitmarker jobs page — the site may have changed")
  cachedKey = m[1]
  return cachedKey
}

export interface TypesenseSearchParams {
  q: string
  query_by: string
  page?: number
  per_page?: number
  sort_by?: string
  filter_by?: string
}

interface TypesenseResult<T> {
  found: number
  page: number
  hits: Array<{ document: T }>
}

/** POST one search to the multi_search endpoint and return its single result. */
export async function typesenseSearch<T>(params: TypesenseSearchParams): Promise<TypesenseResult<T>> {
  const key = await getSearchKey()
  const response = await fetchWithRetry(`${SEARCH_HOST}/multi_search`, {
    method: "POST",
    headers: { "X-TYPESENSE-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ searches: [{ collection: COLLECTION, ...params }] }),
  })
  const body = (await response.json().catch(() => null)) as { results?: Array<TypesenseResult<T> & { code?: number; error?: string }> } | null
  if (!response.ok || !body) {
    throw new Error(`Hitmarker search request failed: ${response.status} ${response.statusText}`)
  }
  const result = body.results?.[0]
  if (!result) throw new Error("Hitmarker search returned no result set")
  if (result.code) throw new Error(`Hitmarker search error: ${result.error || result.code}`)
  return result
}

interface JobLocationEntry {
  title: string
  type: string
}

interface JobTag {
  id: number
  slug: string
  title: string
}

/** A Hitmarker job document — the fields this skill reads (the wire shape carries more). */
export interface HitmarkerJob {
  id: string
  title: string
  url: string
  jobDescription: string | null
  jobCompany: { title: string; slug: string; url: string } | null
  jobLocation: JobLocationEntry[]
  jobLevel: { id: string; title: string } | null
  jobContract: Array<{ id: string; title: string }>
  jobSalary: unknown
  jobTags: JobTag[]
  jobApplicationUrl: string | null
  jobApplicationEmail: string | null
  postDate: number // Unix seconds
  jobExpiryDate: number
}

export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  remote: boolean
  date: string | null
  url: string
  level: string | null
  contract: string | null
}

export interface JobDetailResult extends JobResult {
  description: string | null
  applyUrl: string | null
  tags: string[]
  salary: string | null
}

function formatLocation(loc: JobLocationEntry[]): { location: string | null; remote: boolean } {
  if (!loc || loc.length === 0) return { location: null, remote: false }
  const remote = loc.some((l) => /remote/i.test(l.title) || l.type === "remote")
  const names = loc.map((l) => l.title).filter(Boolean)
  return { location: names.length ? names.join(", ") : null, remote }
}

function unixToISO(seconds: number | null | undefined): string | null {
  if (!seconds) return null
  return new Date(seconds * 1000).toISOString()
}

/** `jobSalary`'s shape was null on every sample seen during scaffolding; this
 * formats defensively if a poster does set one, without assuming a fixed shape. */
function formatSalary(s: unknown): string | null {
  if (s == null) return null
  if (typeof s === "string") return s
  if (typeof s === "object") {
    const o = s as Record<string, unknown>
    const min = o.min ?? o.min_salary
    const max = o.max ?? o.max_salary
    const cur = (o.currency as string) || ""
    if (min != null || max != null) return `${cur} ${min ?? "?"}-${max ?? "?"}`.trim()
  }
  return null
}

export function toResult(j: HitmarkerJob): JobResult {
  const { location, remote } = formatLocation(j.jobLocation)
  return {
    id: j.id,
    title: j.title || "(untitled)",
    company: j.jobCompany?.title || null,
    location,
    remote,
    date: unixToISO(j.postDate),
    url: j.url,
    level: j.jobLevel?.title || null,
    contract: j.jobContract?.length ? j.jobContract.map((c) => c.title).join(", ") : null,
  }
}

export function toDetail(j: HitmarkerJob): JobDetailResult {
  return {
    ...toResult(j),
    description: j.jobDescription ? j.jobDescription.trim() : null,
    applyUrl: j.jobApplicationUrl || (j.jobApplicationEmail ? `mailto:${j.jobApplicationEmail}` : null),
    tags: (j.jobTags || []).map((t) => t.title),
    salary: formatSalary(j.jobSalary),
  }
}

/** Extract a Hitmarker job id from a bare numeric id or a /jobs/<slug>-<id> URL. */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const urlMatch = trimmed.match(/-(\d+)(?:\?|$)/) || trimmed.match(/\/(\d+)(?:\?|$)/)
  if (urlMatch) return urlMatch[1]
  if (/^\d+$/.test(trimmed)) return trimmed
  return null
}

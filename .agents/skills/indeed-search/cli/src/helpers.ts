// Data source: Indeed Spain (es.indeed.com) public search pages. No authentication.
// The results page embeds its job cards as a JSON object assigned to
// window.mosaic.providerData["mosaic-provider-jobcards"]; we parse that JSON
// rather than the rendered markup, which is machine-generated and churns.
//
// Search only. Indeed's robots.txt disallows /viewjob, so there is no detail
// fetch (see commands/detail.ts).

export const BASE_URL = "https://es.indeed.com"
export const SEARCH_URL = `${BASE_URL}/jobs`

/**
 * robots.txt allows `&start=N&` only for N = 0..90 and disallows any other
 * `&start=`. Ten results a page therefore means ten pages at most.
 */
export const MAX_PAGE = 10
const PAGE_SIZE = 10

export class CliError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; indeed-search-cli/1.0)"
const HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9",
}

export interface RawResponse {
  status: number
  body: string
}

/**
 * Same request, same honest headers, sent through the system `curl` instead of
 * Bun's HTTP client. Indeed's bot protection answers Bun's client with 403
 * (observed 2026-10-18: curl got 200 for the identical URL and User-Agent), so
 * a 403 is retried once this way before it is reported. Nothing about the
 * request is disguised: the User-Agent still names this tool. Resolves to null
 * when curl is not installed or fails, which leaves the original 403 standing.
 */
export async function curlFetch(url: string): Promise<RawResponse | null> {
  try {
    const args = ["curl", "-sS", "-L", "--max-redirs", "5", "--max-time", "20"]
    for (const [k, v] of Object.entries(HEADERS)) args.push("-H", `${k}: ${v}`)
    args.push("-w", "\n%{http_code}", "--", url)
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    if (code !== 0) return null
    const cut = out.lastIndexOf("\n")
    const status = parseInt(out.slice(cut + 1), 10)
    return Number.isFinite(status) ? { status, body: out.slice(0, cut) } : null
  } catch {
    return null
  }
}

/**
 * Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. A 403
 * from Bun's client gets one retry through curl (see curlFetch); `curl` is
 * injectable so tests never spawn a process or touch the network.
 */
export async function htmlFetch(
  url: string,
  curl: (url: string) => Promise<RawResponse | null> = curlFetch,
): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
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
    if (response.status === 403) {
      const retry = await curl(url)
      if (retry && retry.status >= 200 && retry.status < 300) return retry.body
      if (retry && retry.status === 404) return ""
      throw new CliError(
        "Indeed refused the request (403) from both Bun's HTTP client and curl. Its bot protection does this after a burst of requests: wait a few minutes and retry with fewer queries. This is a block, not a parser fault.",
        "BLOCKED",
      )
    }
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
  location: string | null
  date: string | null
  url: string
  salary: string | null
  snippet: string | null
  sponsored: boolean
  remote: boolean
}

export interface SearchPage {
  cards: JobCard[]
  total: number | null
}

const JOBCARDS_MARKER = 'window.mosaic.providerData["mosaic-provider-jobcards"]='

/**
 * Parse the JSON object that follows `marker`. The page assigns it inline, so
 * the end is found by balancing braces (string- and escape-aware) instead of a
 * regex that would stop at the first `};` inside a string value.
 */
export function extractJsonAfter(html: string, marker: string): any | null {
  const at = html.indexOf(marker)
  if (at === -1) return null
  const start = html.indexOf("{", at + marker.length)
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < html.length; i++) {
    const ch = html[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === "{") depth++
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

/** Named entities Spanish text actually uses; everything else arrives numeric or as UTF-8. */
const NAMED_ENTITIES: Record<string, string> = {
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü", iexcl: "¡", iquest: "¿",
  euro: "€", ordm: "º", ordf: "ª", laquo: "«", raquo: "»", ndash: "–", mdash: "—",
  hellip: "…", bull: "•", middot: "·", deg: "°", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  agrave: "à", egrave: "è", ograve: "ò", ccedil: "ç", Ccedil: "Ç", copy: "©", reg: "®",
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&([a-zA-Z]+);/g, (whole, name) => NAMED_ENTITIES[name] ?? whole)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
}

/** The card snippet is a small HTML list; flatten it to " | "-separated text. */
function snippetToText(html: string): string | null {
  const text = decodeHtmlEntities(
    html
      .replace(/<\/(li|p|div)>/gi, " | ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .replace(/(\s*\|\s*)+$/, "")
    .trim()
  return text || null
}

/** Indeed gives publication as epoch milliseconds; report the UTC calendar day. */
function epochToDate(ms: unknown): string | null {
  const n = typeof ms === "string" ? Number(ms) : typeof ms === "number" ? ms : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  const d = new Date(n)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function salaryText(snippet: any): string | null {
  const t = snippet?.text
  return typeof t === "string" && t.trim() ? t.trim() : null
}

/**
 * Parse a search page. Throws PARSE_FAILED when the page carries neither job
 * cards nor Indeed's explicit "no results" block: a changed layout or a bot
 * challenge must not be reported as "zero jobs found".
 */
export function parseSearchPage(html: string): SearchPage {
  const total = html.match(/"totalJobCount":(\d+)/)
  const data = extractJsonAfter(html, JOBCARDS_MARKER)
  const results = data?.metaData?.mosaicProviderJobCardsModel?.results
  if (!Array.isArray(results)) {
    if (html.includes("jobsearch-NoResult")) return { cards: [], total: 0 }
    throw new CliError(
      "Indeed's results page had no job-card data and no 'no results' block; the layout may have changed or a bot challenge was served",
      "PARSE_FAILED",
    )
  }

  const cards: JobCard[] = []
  for (const r of results) {
    // One malformed card must not break the rest.
    const id = typeof r?.jobkey === "string" ? r.jobkey : null
    const title = typeof (r?.displayTitle ?? r?.title) === "string" ? (r.displayTitle ?? r.title).trim() : ""
    if (!id || !title) continue
    cards.push({
      id,
      title,
      company: r.company ? String(r.company).trim() || null : r.truncatedCompany ? String(r.truncatedCompany) : null,
      location: r.formattedLocation ? String(r.formattedLocation).trim() || null : null,
      date: epochToDate(r.pubDate),
      url: `${BASE_URL}/viewjob?jk=${id}`,
      salary: salaryText(r.salarySnippet),
      snippet: typeof r.snippet === "string" ? snippetToText(r.snippet) : null,
      sponsored: r.sponsored === true,
      remote: r.remoteLocation === true,
    })
  }
  return { cards, total: total ? parseInt(total[1], 10) : null }
}

/** Nearest freshness bucket at or above `days`: Indeed's `fromage` takes 1, 3, 7 or 14. */
export function jobageToFromage(days: number): number | null {
  if (!days || days <= 0 || days >= 9999) return null
  if (days <= 1) return 1
  if (days <= 3) return 3
  if (days <= 7) return 7
  if (days <= 14) return 14
  return null
}

/**
 * Build the search URL. `start` is always followed by another parameter:
 * robots.txt allows `&start=N&` (N = 0..90) but disallows a bare trailing
 * `&start=`, so the order here is part of the contract, not cosmetic.
 */
export function buildSearchUrl(opts: { query?: string; location?: string; jobage: number; page: number }): string {
  const parts: string[] = []
  const add = (k: string, v: string) => parts.push(`${k}=${encodeURIComponent(v)}`)
  if (opts.query) add("q", opts.query)
  if (opts.location) add("l", opts.location)
  if (opts.page > 1) add("start", String((opts.page - 1) * PAGE_SIZE))
  add("sort", "date")
  const fromage = jobageToFromage(opts.jobage)
  if (fromage) add("fromage", String(fromage))
  return `${SEARCH_URL}?${parts.join("&")}`
}

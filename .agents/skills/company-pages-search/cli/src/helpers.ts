// Registry-driven lookups against companies' own career pages, for corporates
// that don't syndicate all positions to job boards. Four ATS types have public,
// unauthenticated JSON APIs (Greenhouse, Lever, SmartRecruiters, Oracle Cloud
// HCM "Candidate Experience"); everything else
// ("generic") gets a best-effort HTML scrape here, with a documented fallback to
// WebFetch/WebSearch for JS-heavy or Cloudflare-protected sites (see SKILL.md).

import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Honest identification is the default on every request. This CLI says what it
// is and where it comes from, exactly like the other portal CLIs in this repo.
export const UA = "company-pages-search-skill/1.0 (+https://github.com/MadsLorentzen/ai-job-search)"

// The browser-shaped request below is NOT the default. It runs only after
// tools/robots_check.py has confirmed the site's published policy permits the
// path — the boundary 09-web-research.md states: the retry exists to get past
// bot-filtering firewalls on sites whose robots.txt permits access, never to
// override a site that has said no.
//
// A browser User-Agent alone would not be enough anyway: Cloudflare and Akamai
// fingerprint the whole header set, and a request carrying only User-Agent +
// Accept reads as automation regardless of what the UA claims.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_UA,
  "Accept-Language": "en-GB,en;q=0.9,fr;q=0.8,de;q=0.7",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "sec-ch-ua": '"Chromium";v="120", "Not(A:Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** Classify a failure so callers can tell "blocked" from "wrong URL" from "down". */
export function classifyFailure(status: number | null, err?: unknown): string {
  if (status === 403 || status === 401) return "bot_blocked"
  if (status === 404) return "url_not_found"
  if (status === 429) return "rate_limited"
  if (status !== null && status >= 500) return "server_error"
  const msg = err instanceof Error ? err.message : String(err ?? "")
  // "The operation timed out" is what AbortSignal.timeout actually produces —
  // matching only "timeout" misfiled every real timeout as "unknown".
  if (/time(d\s?)?out|abort/i.test(msg)) return "timeout"
  if (/getaddrinfo|ENOTFOUND|dns/i.test(msg)) return "dns_failure"
  if (/certificate|TLS|SSL/i.test(msg)) return "tls_error"
  return "unknown"
}

export type AtsType = "greenhouse" | "lever" | "smartrecruiters" | "oracle" | "generic"

export interface RegistryEntry {
  name: string
  careers_url: string
  ats: AtsType
  ats_id: string
  locations_filter?: string[]
  notes?: string
}

export interface NormalizedJob {
  company: string
  title: string
  location: string | null
  url: string
  posted: string | null
  source_ats: AtsType
  id?: string
}

/**
 * Resolve the skill directory from this module's URL.
 *
 * Repo root = three levels up from cli/src/ (cli/src -> cli -> company-pages-search
 * -> skills -> .agents -> repo root is one more up). Resolved relative to this file
 * so it works regardless of the caller's cwd.
 *
 * fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/Users/...",
 * where the leading slash makes the drive letter an ordinary path segment.
 * path.resolve then anchors it to the current drive — "C:\\C:\\Users\\..." — so
 * every command ENOENTs on the registry.
 * The URL-to-path conversion and the path implementation are parameters so the
 * Windows case is testable from any platform.
 */
export function resolveSkillDir(
  moduleUrl: string,
  toPath: (u: URL) => string = fileURLToPath,
  p: Pick<typeof path, "resolve"> = path,
): string {
  return p.resolve(toPath(new URL(".", moduleUrl)), "../..")
}

const SKILL_DIR = resolveSkillDir(import.meta.url)
const REPO_ROOT = path.resolve(SKILL_DIR, "../../..")
const REGISTRY_PATH = path.join(REPO_ROOT, "company_pages.json")
const EXAMPLE_REGISTRY_PATH = path.join(SKILL_DIR, "company_pages.example.json")

/**
 * The repo's canonical robots gate. Reimplementing RFC 9309 matching here would
 * give the repo two implementations that drift; this shells out to the one that
 * already has pinned tests (tests/test_robots_check.py), so there is exactly one
 * definition of what "the site permits this" means.
 */
export const ROBOTS_CHECK_PY = path.join(REPO_ROOT, "tools", "robots_check.py")

/** Decides whether a browser-shaped request may be sent to `url`. */
export type RobotsGate = (url: string) => Promise<boolean>

/**
 * Run tools/robots_check.py. Exit 0 = permitted, exit 1 = disallowed or
 * unconfirmed, exit 2 = usage error.
 *
 * Fails closed on every unexpected condition — no python3, checker missing,
 * crash, timeout. A gate that cannot answer must not grant permission, and the
 * caller degrades to "no results" rather than proceeding unchecked.
 */
export async function robotsCheckPyGate(
  url: string,
  script: string = ROBOTS_CHECK_PY,
  python = "python3",
): Promise<boolean> {
  if (!existsSync(script)) return false
  const { execFile } = await import("node:child_process")
  const { promisify } = await import("node:util")
  const run = promisify(execFile)
  try {
    await run(python, [script, url], { timeout: 30000, maxBuffer: 1024 * 1024 })
    return true // exit 0
  } catch {
    return false // non-zero exit, missing interpreter, or timeout
  }
}

const MAX_REDIRECTS = 5

/**
 * Last-resort HTML fetch via curl, behind the robots gate.
 *
 * Cloudflare and Akamai fingerprint the TLS handshake (JA3/JA4), not just the
 * headers. Bun's fetch is blocked on some corporate sites where curl, sending
 * byte-identical headers, is served normally — verified on weforum.org and
 * cargill.com, both 403 via fetch and 200 via curl. No header set closes that
 * gap, so when fetch reports 403 we retry once through curl.
 *
 * Redirects are followed one hop at a time and **every hop is gated**. Using
 * `curl -L` here would have sent the full browser header set to whatever host
 * the chain ended on, whose robots.txt was never consulted — permission granted
 * for one origin silently spent on another. Gating only the first URL is the
 * wrong invariant.
 *
 * Returns "" when the gate refuses at any hop, when curl is unavailable, or
 * when curl fails, so callers degrade rather than crashing.
 */
export async function curlFallback(url: string, gate: RobotsGate = robotsCheckPyGate): Promise<string> {
  const { execFile } = await import("node:child_process")
  const { promisify } = await import("node:util")
  const run = promisify(execFile)

  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await gate(current))) return ""
    const args = [
      "-s", "--compressed", "--max-time", "25",
      // No -L: each hop is gated explicitly below.
      "-w", "\n__CPS_STATUS__%{http_code}\n__CPS_LOCATION__%{redirect_url}",
      ...Object.entries(BROWSER_HEADERS).flatMap(([k, v]) => ["-H", `${k}: ${v}`]),
      // "--" terminates option parsing: a careers_url beginning with a dash
      // would otherwise be read by curl as a flag rather than a URL.
      "--", current,
    ]
    let stdout: string
    try {
      ;({ stdout } = await run("curl", args, { maxBuffer: 20 * 1024 * 1024, timeout: 30000 }))
    } catch {
      return ""
    }
    const at = stdout.lastIndexOf("\n__CPS_STATUS__")
    if (at < 0) return ""
    const body = stdout.slice(0, at)
    const trailer = stdout.slice(at + 1)
    const status = parseInt(trailer.slice("__CPS_STATUS__".length, "__CPS_STATUS__".length + 3), 10)
    const location = trailer.slice(trailer.indexOf("__CPS_LOCATION__") + "__CPS_LOCATION__".length).trim()

    if (status >= 300 && status < 400 && location) {
      current = location
      continue
    }
    return status >= 200 && status < 300 ? body : ""
  }
  return ""
}

/**
 * Load the personal registry (company_pages.json at repo root). Falls back to
 * the committed example registry with a stderr warning if the personal file
 * doesn't exist yet.
 */
export async function loadRegistry(): Promise<RegistryEntry[]> {
  let file = REGISTRY_PATH
  if (!existsSync(file)) {
    process.stderr.write(
      JSON.stringify({
        warning: `No personal registry at ${REGISTRY_PATH}; falling back to the example registry. Copy company_pages.example.json to company_pages.json at the repo root and edit it.`,
        code: "USING_EXAMPLE_REGISTRY",
      }) + "\n",
    )
    file = EXAMPLE_REGISTRY_PATH
  }
  const raw = await readFile(file, "utf-8")
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error(`Registry at ${file} must be a JSON array`)
  return parsed as RegistryEntry[]
}

/** Seams for offline tests; production callers use the defaults. */
export interface FetchDeps {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  gate?: RobotsGate
  curl?: (url: string, gate: RobotsGate) => Promise<string>
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Wrap a thrown transport error with its classification.
 *
 * classifyFailure was only ever reached on HTTP status errors, so timeouts, DNS
 * failures and bad certificates surfaced as bare messages and landed in the
 * registry's failure_class as "other" — the three cases the classifier exists to
 * tell apart.
 */
function classifyThrown(url: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err)
  return new Error(`Request failed: ${url} — ${msg} [${classifyFailure(null, err)}]`)
}

/** Fetch JSON with exponential backoff on 429/5xx. Returns null on 404. */
export async function jsonFetch(url: string, deps: FetchDeps = {}): Promise<unknown | null> {
  const doFetch = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? realSleep
  const maxRetries = 4
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await doFetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "application/json,text/plain,*/*",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      })
    } catch (e) {
      throw classifyThrown(url, e)
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(
          `Request failed: ${response.status} ${response.statusText} [${classifyFailure(response.status)}]`,
        )
      }
      const jitter = Math.floor(Math.random() * 400)
      await sleep(delay + jitter)
      delay = Math.min(delay * 2, 6000)
      continue
    }
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(
        `Request failed: ${response.status} ${response.statusText} [${classifyFailure(response.status)}]`,
      )
    }
    return response.json()
  }
  throw new Error("Request failed after max retries")
}

/**
 * Fetch HTML with the same backoff policy, for generic-ATS scraping.
 *
 * Identifies honestly on the first attempt. Only a 401/403 — a bot filter, not
 * a stated policy — triggers the browser-shaped curl retry, and only after
 * tools/robots_check.py confirms the site permits the path.
 */
export async function htmlFetch(url: string, deps: FetchDeps = {}): Promise<string> {
  const doFetch = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? realSleep
  const gate = deps.gate ?? robotsCheckPyGate
  const curl = deps.curl ?? curlFallback
  const maxRetries = 4
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await doFetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      })
    } catch (e) {
      throw classifyThrown(url, e)
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(
          `Request failed: ${response.status} ${response.statusText} [${classifyFailure(response.status)}]`,
        )
      }
      const jitter = Math.floor(Math.random() * 400)
      await sleep(delay + jitter)
      delay = Math.min(delay * 2, 6000)
      continue
    }
    if (response.status === 404) return ""
    if (response.status === 403 || response.status === 401) {
      // Ask the gate first so the error can say which of the two happened.
      // A single "gate refused or curl failed" message made a site we were
      // allowed to fetch indistinguishable from one we were not.
      const permitted = await gate(url)
      if (!permitted) {
        throw new Error(
          `Request failed: ${response.status} ${response.statusText} ` +
            `[robots_unconfirmed] (robots.txt does not permit this path, or could not be read)`,
        )
      }
      const viaCurl = await curl(url, async () => true)
      if (viaCurl) return viaCurl
      throw new Error(
        `Request failed: ${response.status} ${response.statusText} ` +
          `[${classifyFailure(response.status)}] (robots.txt permits it; the browser-header retry was still blocked)`,
      )
    }
    if (!response.ok) {
      throw new Error(
        `Request failed: ${response.status} ${response.statusText} [${classifyFailure(response.status)}]`,
      )
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
}

/** Absolutize a possibly-relative href against the page's base URL. */
function absolutize(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}

const JOB_KEYWORDS = [
  "job", "jobs", "career", "careers", "vacan", "position", "opening", "opportunit", "role",
]

/**
 * Best-effort scrape for ats=generic: extract <a href> links whose href or link
 * text looks job-related. This is intentionally shallow — many corporate career
 * pages are JS-rendered or behind Cloudflare, in which case this returns few or
 * no records and the agent should fall back to WebFetch on careers_url directly
 * (documented in SKILL.md).
 */
export function scrapeGenericLinks(html: string, baseUrl: string, company: string): NormalizedJob[] {
  const results: NormalizedJob[] = []
  const seen = new Set<string>()
  // href="…" | href='…' | href=… (unquoted). Only the double-quoted form was
  // matched before, so a single-quoted static career page scraped to zero links
  // and read as "this employer has no openings".
  const linkRe = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+))[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html)) !== null) {
    const rawHref = decodeHtmlEntities(m[1] ?? m[2] ?? m[3] ?? "")
    const text = decodeHtmlEntities(m[4].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    // javascript:/data:/mailto: are not postings, and absolutize would happily
    // return them as "URLs".
    if (/^(javascript|data|mailto|tel):/i.test(rawHref.trim())) continue
    const hay = (rawHref + " " + text).toLowerCase()
    if (!JOB_KEYWORDS.some((k) => hay.includes(k))) continue
    if (!text) continue
    const url = absolutize(rawHref, baseUrl)
    if (!url) continue
    if (seen.has(url)) continue
    seen.add(url)
    results.push({
      company,
      title: text.length > 140 ? text.slice(0, 140) + "…" : text,
      location: null,
      url,
      posted: null,
      source_ats: "generic",
    })
  }
  return results
}

export function matchesFilters(job: NormalizedJob, query?: string, location?: string): boolean {
  if (query) {
    const q = query.toLowerCase()
    if (!job.title.toLowerCase().includes(q)) return false
  }
  if (location) {
    const l = location.toLowerCase()
    if (!(job.location || "").toLowerCase().includes(l)) return false
  }
  return true
}

export function applyLocationsFilter(jobs: NormalizedJob[], entry: RegistryEntry): NormalizedJob[] {
  const filters = entry.locations_filter
  if (!filters || filters.length === 0) return jobs
  const lowered = filters.map((f) => f.toLowerCase())
  return jobs.filter((j) => {
    if (!j.location) return true // keep unknown-location records rather than silently dropping them
    const loc = j.location.toLowerCase()
    return lowered.some((f) => loc.includes(f))
  })
}

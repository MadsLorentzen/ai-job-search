// Data source: Xing has no lightweight keyword-search endpoint reachable without
// hitting its GraphQL API, which robots.txt disallows for every crawler (including
// the "ClaudeBot"/"GPTBot"/"PerplexityBot" group that robots.txt otherwise carves an
// explicit exception for on /jobs/search/ - that page is a client-rendered shell with
// no server-side job data, so the exception doesn't actually unlock anything usable).
//
// Job *detail* pages are different: they are fully server-rendered with a schema.org
// JobPosting JSON-LD block, and both those pages and Xing's own job-URL sitemap
// (https://www.xing.com/jobs/sitemap.xml.gz) are unrestricted for every crawler under
// robots.txt's generic `User-agent: *` block. So "search" here means: cache the full
// job-URL sitemap locally (13 shards, ~650k URLs as of 2026-09, refreshed at most once
// per SITEMAP_CACHE_TTL_MS), keyword-match the query against each URL's slug, then
// fetch and verify the most-likely-newest matches against their real detail pages.
//
// The sitemap keeps years-old expired postings mixed in with current ones and carries
// no reliable freshness signal of its own - a shard's <lastmod> reflects Xing's last
// sitemap-regeneration touch, not the posting date (verified against live data: a
// posting last-modified two days before this was written carried a datePosted over a
// year older). A job's numeric ID is a much better proxy - IDs are issued roughly
// sequentially, so a higher ID correlates with a later posting date - but it is still
// only a sort heuristic, never a substitute for the real datePosted/validThrough each
// candidate's own detail page carries. Recency and liveness are only knowable after
// that fetch, which is why `search` below probes candidates instead of trusting the
// sitemap alone.

import { gunzipSync } from "node:zlib"
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

export const SITEMAP_INDEX_URL = "https://www.xing.com/jobs/sitemap.xml.gz"
export const JOBS_BASE_URL = "https://www.xing.com/jobs"

const UA = "Mozilla/5.0 (compatible; xing-search-cli/1.0)"

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".cache")
const CACHE_FILE = join(CACHE_DIR, "sitemap-cache.json")
// Matches the sitemap's own roughly-daily regeneration cadence observed live.
export const SITEMAP_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

async function withBackoff<T>(url: string, accept: string, timeoutMs: number, onResponse: (r: Response) => Promise<T | null>): Promise<T | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
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
    return onResponse(response)
  }
  throw new Error("Request failed after max retries")
}

/** Fetch HTML/XML with exponential backoff on 429/5xx. Returns null on 404/410 (gone). */
export async function fetchText(url: string): Promise<string | null> {
  return withBackoff(url, "text/html,application/xml,*/*;q=0.8", 20000, async (response) => {
    if (response.status === 404 || response.status === 410) return null
    if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    return response.text()
  })
}

/** Fetch and gunzip a .gz URL, with the same backoff as fetchText. */
async function fetchGunzipped(url: string): Promise<string> {
  const result = await withBackoff(url, "application/gzip,*/*;q=0.8", 30000, async (response) => {
    if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    const buf = Buffer.from(await response.arrayBuffer())
    return gunzipSync(buf).toString("utf-8")
  })
  if (result === null) throw new Error(`Unexpected empty response fetching ${url}`)
  return result
}

export interface SitemapEntry {
  /** The full URL slug (path segment after /jobs/), e.g. "koeln-ot-cyber-security-senior-consultant-122981029". */
  id: string
  url: string
}

// Cache stores bare URLs only (id is always the URL's own trailing slug, so
// persisting it a second time would roughly double a ~50MB+ cache file for
// nothing).
interface SitemapCache {
  fetchedAt: string
  urls: string[]
}

function parseLocs(xml: string): string[] {
  const locs: string[] = []
  const re = /<loc>([^<]+)<\/loc>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) locs.push(m[1])
  return locs
}

function toEntries(urls: string[]): SitemapEntry[] {
  const entries: SitemapEntry[] = []
  for (const url of urls) {
    const id = url.split("/").filter(Boolean).pop()
    if (id) entries.push({ id, url })
  }
  return entries
}

/** Download every job-posting sitemap shard and build the flat URL list. */
async function syncSitemap(): Promise<string[]> {
  const indexXml = await fetchGunzipped(SITEMAP_INDEX_URL)
  // The sitemap index also lists non-posting sitemaps (roles, skills, locations,
  // companies, employment types); only the numbered shards are individual postings.
  const shardUrls = parseLocs(indexXml).filter((u) => /\/jobs\/\d+-sitemap\.xml\.gz$/.test(u))
  const urls: string[] = []
  for (const shardUrl of shardUrls) {
    const xml = await fetchGunzipped(shardUrl)
    urls.push(...parseLocs(xml))
  }
  return urls
}

/** Load the cached sitemap, refreshing it if missing, corrupt, or older than the TTL. */
export async function loadSitemap(): Promise<{ entries: SitemapEntry[]; syncedAt: string; resynced: boolean }> {
  if (existsSync(CACHE_FILE)) {
    try {
      const cache = JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as SitemapCache
      if (Date.now() - new Date(cache.fetchedAt).getTime() < SITEMAP_CACHE_TTL_MS) {
        return { entries: toEntries(cache.urls), syncedAt: cache.fetchedAt, resynced: false }
      }
    } catch {
      // Corrupt cache file - fall through and resync.
    }
  }
  const urls = await syncSitemap()
  const fetchedAt = new Date().toISOString()
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(CACHE_FILE, JSON.stringify({ fetchedAt, urls } satisfies SitemapCache))
  return { entries: toEntries(urls), syncedAt: fetchedAt, resynced: true }
}

/** Xing's own slug transliteration: lowercase, äöüß -> ae/oe/ue/ss, everything else -> "-". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** The numeric suffix of a slug - see the file-header note on why this is only a sort heuristic. */
function trailingId(slug: string): number {
  const m = slug.match(/-(\d+)$/)
  return m ? parseInt(m[1], 10) : 0
}

/** Keyword-match (AND, substring) each cached slug against the query/location words, newest-ID first. */
export function matchSitemap(entries: SitemapEntry[], queryWords: string[], locationWords: string[]): SitemapEntry[] {
  const matches = entries.filter((e) => {
    if (!queryWords.every((w) => e.id.includes(w))) return false
    if (locationWords.length > 0 && !locationWords.some((w) => e.id.includes(w))) return false
    return true
  })
  return matches.sort((a, b) => trailingId(b.id) - trailingId(a.id))
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  employmentType: string | null
  industry: string | null
  validThrough: string | null
  /** null when Xing gave no validThrough to check liveness against - never inferred. */
  isActive: boolean | null
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

function htmlToText(html: string): string {
  const withBreaks = html.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|li|ul|ol|div|h\d|article)>/gi, "\n")
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, "")).replace(/\n{3,}/g, "\n\n").trim()
}

interface RawJobPosting {
  ["@type"]?: string
  title?: string
  description?: string
  datePosted?: string
  validThrough?: string
  employmentType?: string
  industry?: string
  hiringOrganization?: { name?: string }
  jobLocation?: Array<{ address?: { addressLocality?: string; addressRegion?: string } }>
}

/** Extract and parse the page's schema.org JobPosting JSON-LD block. */
function extractJobPosting(html: string): RawJobPosting | null {
  const m = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) return null
  try {
    const obj = JSON.parse(m[1])
    return obj && obj["@type"] === "JobPosting" ? obj : null
  } catch {
    return null
  }
}

/** Parse a job detail page. Returns null if the page carries no JobPosting JSON-LD (markup drift). */
export function parseJobDetail(html: string, id: string, url: string): JobDetail | null {
  const posting = extractJobPosting(html)
  if (!posting || !posting.title) return null

  const addr = posting.jobLocation?.[0]?.address
  const location = addr ? [addr.addressLocality, addr.addressRegion].filter(Boolean).join(", ") || null : null

  const isActive = posting.validThrough ? new Date(posting.validThrough).getTime() >= Date.now() : null

  return {
    id,
    title: decodeHtmlEntities(posting.title),
    company: posting.hiringOrganization?.name ?? null,
    location,
    date: posting.datePosted ?? null,
    validThrough: posting.validThrough ?? null,
    employmentType: posting.employmentType ?? null,
    industry: posting.industry ?? null,
    description: posting.description ? htmlToText(posting.description) : null,
    isActive,
    url,
  }
}

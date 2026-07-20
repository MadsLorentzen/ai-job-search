export const BASE_URL = "https://www.jobindex.dk"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export async function apiFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  let url = `${BASE_URL}${path}`
  if (params && Object.keys(params).length > 0) {
    const qs = new URLSearchParams(params)
    url += `?${qs.toString()}`
  }

  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((resolve) => setTimeout(resolve, delay + jitter))
      delay = Math.min(delay * 2, 5000)
      continue
    }
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`)
    }
    return response.json() as Promise<T>
  }
  throw new Error("API request failed after max retries")
}

export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; jobindex-cli/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "da,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((resolve) => setTimeout(resolve, delay + jitter))
      delay = Math.min(delay * 2, 5000)
      continue
    }
    if (response.status === 404) {
      throw new Error(`Job not found`)
    }
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`)
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
  deadline: string | null
  url: string
  description: string | null
}

/**
 * Jobindex moved its search results client-side. The /jobsoegning.json endpoint
 * now returns 204 No Content. The HTML page (/jobsoegning) embeds the full result
 * payload in a `var Stash = {...}` script blob, under
 * jobsearch/result_app -> storeData -> searchResponse -> { hitcount, results[] }.
 * This extracts and parses that blob.
 */
export function extractStash(html: string): any {
  const marker = "var Stash = "
  const start = html.indexOf(marker)
  if (start === -1) throw new Error("Could not locate Stash blob in jobindex HTML")
  const open = start + marker.length
  let depth = 0
  let inStr = false
  let esc = false
  let end = -1
  for (let j = open; j < html.length; j++) {
    const c = html[j]
    if (inStr) {
      if (esc) esc = false
      else if (c === "\\") esc = true
      else if (c === '"') inStr = false
    } else {
      if (c === '"') inStr = true
      else if (c === "{") depth++
      else if (c === "}") {
        depth--
        if (depth === 0) {
          end = j + 1
          break
        }
      }
    }
  }
  if (end === -1) throw new Error("Unterminated Stash blob in jobindex HTML")
  return JSON.parse(html.slice(open, end))
}

function findSearchResponse(node: any): any {
  if (node && typeof node === "object") {
    if (!Array.isArray(node)) {
      if (
        node.searchResponse &&
        typeof node.searchResponse === "object" &&
        Array.isArray(node.searchResponse.results)
      ) {
        return node.searchResponse
      }
      for (const key of Object.keys(node)) {
        const found = findSearchResponse(node[key])
        if (found) return found
      }
    } else {
      for (const item of node) {
        const found = findSearchResponse(item)
        if (found) return found
      }
    }
  }
  return null
}

export interface SearchPageResult {
  total: number
  results: JobCard[]
}

export function parseSearchPage(html: string): SearchPageResult {
  const stash = extractStash(html)
  const sr = findSearchResponse(stash)
  if (!sr) throw new Error("Could not locate searchResponse in jobindex Stash")

  const results: JobCard[] = (sr.results ?? []).map((r: any): JobCard => {
    const tid: string = r.tid ?? ""
    let location: string | null = r.area ?? null
    if (!location) {
      try {
        location = r.geojson?.features?.[0]?.properties?.title ?? null
      } catch {
        location = null
      }
    }
    let deadline: string | null = null
    if (r.apply_deadline_asap) deadline = "ASAP"
    else if (typeof r.apply_deadline === "string") deadline = r.apply_deadline.slice(0, 10)
    else if (typeof r.lastdate === "string") deadline = r.lastdate

    return {
      id: tid,
      title: r.headline ?? "",
      company: r.company?.name ?? r.companytext ?? null,
      companyUrl: r.company?.homeurl ?? null,
      location,
      date: r.firstdate ?? null,
      deadline,
      url: tid ? `${BASE_URL}/jobannonce/${tid}` : (r.share_url ?? r.url ?? ""),
      description: null,
    }
  })

  const total = typeof sr.hitcount === "number" ? sr.hitcount : results.length
  return { total, results }
}

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji, U+1F600)
 * decode correctly, and drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

/**
 * Decode HTML entities in text
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Numeric character references: decimal (&#233;) and hexadecimal (&#xE9;).
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

/**
 * Strip HTML tags from text
 */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim()
}

/**
 * Parse job cards from result_list_box_html using regex.
 * node-html-parser has nesting bugs with this specific HTML structure
 * (unclosed tags inside buttons cause incorrect DOM tree).
 * Regex parsing is more reliable for this specific HTML format.
 */
export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []

  // Split HTML by jobad-wrapper to get individual card HTML chunks
  const wrapperPattern = /<div[^>]+id="jobad-wrapper-(h\d+|r\d+)"[^>]*>([\s\S]*?)(?=<div[^>]+id="jobad-wrapper-|$)/g

  let match: RegExpExecArray | null
  while ((match = wrapperPattern.exec(html)) !== null) {
    const id = match[1]
    const cardHtml = match[2]

    // Extract title: look for <h4>...<a|A href="...">Title</a>...</h4>
    const titleMatch = cardHtml.match(/<h4[^>]*>[\s\S]*?<[Aa][^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/[Aa]>/i)
    if (!titleMatch) continue
    const rawTitle = stripTags(titleMatch[2])
    const title = decodeHtmlEntities(rawTitle)
    if (!title) continue

    // Determine URL: prefer jobindex.dk /jobannonce/ URL, fallback to constructed URL
    let url: string
    const jobannonce = cardHtml.match(/href="(https:\/\/www\.jobindex\.dk\/jobannonce\/[^"]+)"/)
    if (jobannonce) {
      url = jobannonce[1]
    } else {
      // Construct canonical URL from ID
      url = `${BASE_URL}/jobannonce/${id}`
    }

    // Extract company: <a ...> inside jix-toolbar-top__company
    let company: string | null = null
    let companyUrl: string | null = null
    const companySection = cardHtml.match(/class="jix-toolbar-top__company"[^>]*>([\s\S]*?)<\/div>/i)
    if (companySection) {
      const companyLinkMatch = companySection[1].match(/<[Aa][^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/[Aa]>/i)
      if (companyLinkMatch) {
        company = decodeHtmlEntities(stripTags(companyLinkMatch[2])) || null
        companyUrl = companyLinkMatch[1] || null
      }
    }

    // Extract location: <span class="jix_robotjob--area">Location</span>
    const locMatch = cardHtml.match(/<span[^>]+class="jix_robotjob--area"[^>]*>([\s\S]*?)<\/span>/i)
    const location = locMatch ? decodeHtmlEntities(stripTags(locMatch[1])) || null : null

    // Extract date: <time datetime="YYYY-MM-DD">
    const dateMatch = cardHtml.match(/<time[^>]+datetime="([^"]+)"/)
    const date = dateMatch ? dateMatch[1] : null

    // Extract description: first <p class="..."> or first standalone <p> (not in toolbar)
    // Skip the toolbar/menu section and look for the description paragraph
    let description: string | null = null
    const innerSection = cardHtml.match(/class="PaidJob-inner"[^>]*>([\s\S]*?)(?:<\/div>\s*<\/div>|$)/i) ||
                         cardHtml.match(/class="jix_robotjob-inner"[^>]*>([\s\S]*?)(?:<\/div>\s*<\/div>|$)/i)
    if (innerSection) {
      const pMatch = innerSection[1].match(/<p[^>]*>([\s\S]*?)<\/p>/i)
      if (pMatch) {
        const text = decodeHtmlEntities(stripTags(pMatch[1]))
        description = text.length > 0 ? text.substring(0, 300) : null
      }
    } else {
      // Fallback: look for p after the jobannonce link
      const pMatches = [...cardHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      for (const pm of pMatches) {
        const text = decodeHtmlEntities(stripTags(pm[1]))
        if (text.length > 20) {
          description = text.substring(0, 300)
          break
        }
      }
    }

    results.push({
      id,
      title,
      company: company || null,
      companyUrl: companyUrl || null,
      location: location || null,
      date: date || null,
      deadline: null,
      url,
      description: description || null,
    })
  }

  return results
}

export function parseHitCount(html: string): number {
  const match = html.match(/af <strong>([\d.]+)<\/strong>/)
  if (!match) return 0
  const numStr = match[1].replace(/\./g, "")
  return parseInt(numStr, 10) || 0
}

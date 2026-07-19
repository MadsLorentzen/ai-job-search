import { parse as parseHtml } from "node-html-parser"

export const BASE_URL = "https://jobbank.dk"

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export async function fetchWithUA(url: string): Promise<Response> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((resolve) => setTimeout(resolve, delay + jitter))
      delay = Math.min(delay * 2, 5000)
      continue
    }
    return response
  }
  throw new Error("Request failed after max retries")
}

export interface RssItem {
  title: string
  description: string
  link: string
  pubDate: string
}

function extractCdata(xml: string, tag: string): string {
  // Try CDATA first
  const cdataRe = new RegExp(`<${tag}><\\!\\[CDATA\\[(.*?)\\]\\]><\\/${tag}>`, "s")
  const cdataMatch = xml.match(cdataRe)
  if (cdataMatch) return cdataMatch[1].trim()
  // Plain content
  const plainRe = new RegExp(`<${tag}>(.*?)<\\/${tag}>`, "s")
  const plainMatch = xml.match(plainRe)
  return plainMatch ? plainMatch[1].trim() : ""
}

function extractLink(xml: string): string {
  // <link> in RSS can conflict with atom namespace — extract text node after <link>
  // Try CDATA variant first
  const cdataMatch = xml.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>/s)
  if (cdataMatch) return cdataMatch[1].trim()
  // Plain link
  const plainMatch = xml.match(/<link>(.*?)<\/link>/s)
  if (plainMatch) return plainMatch[1].trim()
  // Some RSS feeds put the URL as text after <link> without a closing tag (self-closing style)
  // Try matching href in atom:link
  return ""
}

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = []
  // Split on <item> boundaries
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g)
  for (const match of itemMatches) {
    const itemXml = match[1]
    const title = extractCdata(itemXml, "title")
    const description = extractCdata(itemXml, "description")
    const link = extractLink(itemXml)
    const pubDate = extractCdata(itemXml, "pubDate") || itemXml.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() || ""
    items.push({ title, description, link, pubDate })
  }
  return items
}

export async function rssFetch(params: Record<string, string | string[]>): Promise<RssItem[]> {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        searchParams.append(key, v)
      }
    } else {
      searchParams.append(key, value)
    }
  }
  const url = `${BASE_URL}/job/rss?${searchParams.toString()}`
  const response = await fetchWithUA(url)
  if (!response.ok) {
    const body = await response.clone().text()
    if (response.status === 403 && /just a moment|cloudflare|cf-chl/i.test(body)) {
      throw new Error(
        "Jobbank is blocking automated requests with Cloudflare bot protection. Skip this portal or use the WebSearch fallback."
      )
    }
    throw new Error(`Failed to fetch RSS feed: ${response.status} ${response.statusText}`)
  }
  const xml = await response.text()
  return parseRssItems(xml)
}

export interface ParsedDescription {
  jobType: string
  company: string
  location: string
  deadline: string | null
}

export function parseRssDescription(desc: string): ParsedDescription {
  // Format: "JobType hos Company, Location (Ansøgningsfrist: DD.MM.YYYY)"
  // or: "JobType hos Company, Location (Ansøgningsfrist: løbende)"
  // or multiple types: "Fuldtidsjob, Graduate/trainee hos Company, Location (Ansøgningsfrist: ...)"

  let jobType = ""
  let company = ""
  let location = ""
  let deadline: string | null = null

  const hosIdx = desc.indexOf(" hos ")
  if (hosIdx === -1) {
    // Can't parse — return desc as company
    return { jobType: "", company: desc, location: "", deadline: null }
  }

  jobType = desc.substring(0, hosIdx).trim()
  let rest = desc.substring(hosIdx + 5) // skip " hos "

  // Extract deadline from parenthetical at the end
  const deadlineMatch = rest.match(/\(Ans[øo]gningsfrist:\s*(.*?)\)\s*$/)
  if (deadlineMatch) {
    const deadlineStr = deadlineMatch[1].trim()
    if (deadlineStr.toLowerCase() === "løbende" || deadlineStr.toLowerCase() === "lobende") {
      deadline = null
    } else {
      deadline = deadlineStr
    }
    // Remove the deadline portion from rest
    rest = rest.substring(0, deadlineMatch.index).trim()
  }

  // rest is now "Company, Location"
  // Split on first ", " to get company and location
  const firstComma = rest.indexOf(", ")
  if (firstComma !== -1) {
    company = rest.substring(0, firstComma).trim()
    location = rest.substring(firstComma + 2).trim()
  } else {
    company = rest.trim()
    location = ""
  }

  return { jobType, company, location, deadline }
}

export function extractJobIdFromUrl(url: string): string {
  // URL format: https://jobbank.dk/job/{id}/{company-slug}/{title-slug}
  const match = url.match(/\/job\/(\d+)\//)
  return match ? match[1] : ""
}

function findJobPosting(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const jobPosting = findJobPosting(item)
      if (jobPosting) return jobPosting
    }
    return null
  }

  if (!value || typeof value !== "object") return null

  const record = value as Record<string, unknown>
  if (record["@type"] === "JobPosting") return record

  return findJobPosting(record["@graph"])
}

export function parseJobPostingJsonLd(html: string): Record<string, unknown> | null {
  const root = parseHtml(html)
  const scripts = root.querySelectorAll('script[type="application/ld+json"]')

  for (const script of scripts) {
    try {
      const jobPosting = findJobPosting(JSON.parse(script.text) as unknown)
      if (jobPosting) return jobPosting
    } catch {
      // Invalid JSON-LD should not prevent later scripts from being checked.
    }
  }

  return null
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; rss-search-cli/1.0)"

export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  description?: string | null
}

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tag(block: string, name: string): string | null {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i")
  const match = re.exec(block)
  return match ? decode(match[1]) : null
}

function attrLink(block: string): string | null {
  const rss = /<link[^>]*>([\s\S]*?)<\/link>/i.exec(block)
  if (rss) return decode(rss[1])
  const atom = /<link[^>]+href=["']([^"']+)["']/i.exec(block)
  return atom ? atom[1].trim() : null
}

export function parseFeed(xml: string, feedUrl: string): JobResult[] {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? []
  const out: JobResult[] = []
  for (const block of items) {
    const title = tag(block, "title")
    const url = attrLink(block) ?? tag(block, "guid")
    if (!title || !url) continue
    const date = tag(block, "pubDate") ?? tag(block, "updated") ?? tag(block, "published")
    let iso: string | null = null
    if (date) {
      const d = new Date(date)
      if (!Number.isNaN(d.getTime())) iso = d.toISOString().slice(0, 10)
    }
    const description = tag(block, "description") ?? tag(block, "summary") ?? tag(block, "content")
    const company = tag(block, "dc:creator") ?? new URL(feedUrl).hostname
    out.push({
      id: url,
      title,
      company,
      location: null,
      date: iso,
      url,
      description,
    })
  }
  return out
}

export function parseFeedsFile(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as { feeds?: unknown }
    if (Array.isArray(parsed.feeds)) {
      return parsed.feeds.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    }
  } catch {
    // plain text, one URL per line
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
}

export async function fetchText(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      })
    } catch (e) {
      throw new Error(`could not reach ${url} (${e instanceof Error ? e.message : String(e)})`)
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) throw new Error(`request failed: ${response.status}`)
      await new Promise((r) => setTimeout(r, delay + Math.floor(Math.random() * 500)))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return ""
    if (!response.ok) throw new Error(`request failed: ${response.status}`)
    return await response.text()
  }
  throw new Error("request failed after retries")
}

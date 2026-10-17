export const BASE_URL = "https://www.rozee.pk"

const USER_AGENT = "Mozilla/5.0 (compatible; rozee-search-cli/1.0)"
const CITY_IDS: Record<string, string> = {
  islamabad: "1180",
  faisalabad: "1181",
  karachi: "1184",
  lahore: "1185",
  rawalpindi: "1190",
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export interface JobCard {
  id: string
  jobId: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  validThrough: string | null
  employmentType: string | null
}

export interface SearchPage {
  jobs: JobCard[]
  total: number | null
  malformedRecords: number
}

export function cityIdForLocation(location: string): string | null {
  const normalized = location
    .trim()
    .replace(/,\s*pakistan$/i, "")
    .toLowerCase()
  return CITY_IDS[normalized] ?? null
}

/** Fetch HTML with backoff on 429/5xx. Returns an empty string on 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en,ur;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((resolve) => setTimeout(resolve, delay + jitter))
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function textValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
  }
  return null
}

function decodedText(...values: unknown[]): string | null {
  const value = textValue(...values)
  return value ? decodeEntities(value) : null
}

function firstText(value: unknown): string | null {
  if (Array.isArray(value)) return textValue(...value)
  return textValue(value)
}

function extractBalancedObject(source: string, start: number): string | null {
  if (source[start] !== "{") return null
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < source.length; index++) {
    const char = source[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
    } else if (char === "{") {
      depth++
    } else if (char === "}") {
      depth--
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return null
}

/** Decode the common named and numeric entities used in Rozee descriptions. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_match, dec: string) => {
      const codePoint = Number(dec)
      return codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : ""
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16)
      return codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : ""
    })
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function readJobCard(value: unknown): JobCard | null {
  if (!isRecord(value)) return null
  const id = textValue(value.rozeePermaLink, value.permaLink)
  const title = decodedText(value.title_exact_en, value.title_exact, value.title)
  if (!id || !title) return null

  const jobId = textValue(value.jid, value.id) ?? id.match(/(\d{5,})$/)?.[1]
  if (!jobId) return null
  const city = decodedText(firstText(value.city_exact), value.city)

  return {
    id,
    jobId,
    title,
    company: decodedText(value.company_name, value.company_exact_en, value.company),
    location: city,
    date: textValue(value.displayDate, value.created, value.date),
    url: `${BASE_URL}/${id}`,
  }
}

/** Parse the embedded result records independently so one bad record is isolated. */
export function parseSearchPage(html: string): SearchPage {
  const jobs: JobCard[] = []
  const seen = new Set<string>()
  let malformedRecords = 0
  const totalMatch = html.match(/"numFound"\s*:\s*(\d+)/)
  const total = totalMatch ? Number(totalMatch[1]) : null
  const idPattern = /"jid"\s*:/g
  let match: RegExpExecArray | null

  while ((match = idPattern.exec(html)) !== null) {
    const start = html.lastIndexOf("{", match.index)
    const objectSource = start >= 0 ? extractBalancedObject(html, start) : null
    if (!objectSource) {
      malformedRecords++
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(objectSource)
    } catch {
      malformedRecords++
      continue
    }

    const job = readJobCard(parsed)
    if (!job) {
      malformedRecords++
      continue
    }
    if (seen.has(job.id)) continue
    seen.add(job.id)
    jobs.push(job)
  }

  return { jobs, total, malformedRecords }
}

function isJobPosting(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]]
  return types.some((type) => typeof type === "string" && type.toLowerCase() === "jobposting")
}

function findJobPosting(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const posting = findJobPosting(item)
      if (posting) return posting
    }
    return null
  }
  if (!isRecord(value)) return null
  if (isJobPosting(value)) return value
  return findJobPosting(value["@graph"])
}

function parseJobPosting(html: string): Record<string, unknown> | null {
  const scripts = html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )
  for (const script of scripts) {
    try {
      const parsed: unknown = JSON.parse(script[1])
      const posting = findJobPosting(parsed)
      if (posting) return posting
    } catch {
      continue
    }
  }
  return null
}

function nestedText(value: unknown, ...keys: string[]): string | null {
  let current: unknown = value
  for (const key of keys) {
    if (!isRecord(current)) return null
    current = current[key]
  }
  return textValue(current)
}

export function parseJobDetail(html: string, url: string, fallbackId: string): JobDetail | null {
  const posting = parseJobPosting(html)
  if (!posting) return null
  const title = textValue(posting.title)
  if (!title) return null

  const location = nestedText(posting.jobLocation, "address", "addressLocality")
  const employmentType = firstText(posting.employmentType)
  const description = textValue(posting.description)

  return {
    id: fallbackId,
    jobId: textValue(nestedText(posting.identifier, "value")) ?? fallbackId.match(/(\d{5,})$/)?.[1] ?? fallbackId,
    title,
    company: nestedText(posting.hiringOrganization, "name"),
    location,
    date: textValue(posting.datePosted),
    url,
    description: description ? htmlToText(description) : null,
    validThrough: textValue(posting.validThrough),
    employmentType,
  }
}

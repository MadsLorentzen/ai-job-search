// Public ATS job-board APIs (Greenhouse, Lever, Ashby). No authentication.
// Country-agnostic: a board token identifies a company, not a market.

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; ats-boards-search-cli/1.0)"

export type BoardKind = "greenhouse" | "lever" | "ashby"

export interface BoardRef {
  kind: BoardKind
  token: string
  raw: string
}

export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  description?: string | null
  source?: string
}

export function parseBoard(raw: string): BoardRef {
  const trimmed = raw.trim()
  const split = trimmed.indexOf(":")
  if (split <= 0) {
    throw new Error(`board must be kind:token (got ${JSON.stringify(raw)})`)
  }
  const kind = trimmed.slice(0, split).toLowerCase()
  const token = trimmed.slice(split + 1).trim()
  if (!token) throw new Error(`board ${JSON.stringify(raw)} is missing a token`)
  if (kind !== "greenhouse" && kind !== "lever" && kind !== "ashby") {
    throw new Error(`unknown board kind ${JSON.stringify(kind)} (use greenhouse, lever, or ashby)`)
  }
  return { kind, token, raw: `${kind}:${token}` }
}

export function parseBoardsFile(text: string): BoardRef[] {
  const parsed = JSON.parse(text) as { boards?: unknown }
  if (!Array.isArray(parsed.boards)) {
    throw new Error("boards file must be { \"boards\": [\"greenhouse:acme\", ...] }")
  }
  return parsed.boards.map((item) => {
    if (typeof item !== "string") throw new Error("each board must be a string")
    return parseBoard(item)
  })
}

export function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
  return text || null
}

export function isoDate(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null
  if (typeof value === "number") {
    const ms = value < 1e12 ? value * 1000 : value
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

export function parseGreenhouseJobs(payload: unknown, company: string | null): JobResult[] {
  const root = payload as { jobs?: unknown[] }
  if (!Array.isArray(root.jobs)) return []
  const out: JobResult[] = []
  for (const raw of root.jobs) {
    const job = raw as {
      id?: number | string
      title?: string
      absolute_url?: string
      updated_at?: string
      location?: { name?: string }
      content?: string
    }
    if (job.id == null || !job.title || !job.absolute_url) continue
    out.push({
      id: `greenhouse:${job.id}`,
      title: job.title,
      company,
      location: job.location?.name ?? null,
      date: isoDate(job.updated_at),
      url: job.absolute_url,
      description: stripHtml(job.content),
      source: "greenhouse",
    })
  }
  return out
}

export function parseLeverJobs(payload: unknown, fallbackCompany: string | null): JobResult[] {
  if (!Array.isArray(payload)) return []
  const out: JobResult[] = []
  for (const raw of payload) {
    const job = raw as {
      id?: string
      text?: string
      hostedUrl?: string
      createdAt?: number
      categories?: { location?: string; commitment?: string }
      descriptionPlain?: string
      description?: string
    }
    if (!job.id || !job.text || !job.hostedUrl) continue
    out.push({
      id: `lever:${job.id}`,
      title: job.text,
      company: fallbackCompany,
      location: job.categories?.location ?? null,
      date: isoDate(job.createdAt),
      url: job.hostedUrl,
      description: job.descriptionPlain ?? stripHtml(job.description),
      source: "lever",
    })
  }
  return out
}

export function parseAshbyJobs(payload: unknown, fallbackCompany: string | null): JobResult[] {
  const root = payload as { jobs?: unknown[] }
  if (!Array.isArray(root.jobs)) return []
  const out: JobResult[] = []
  for (const raw of root.jobs) {
    const job = raw as {
      id?: string
      title?: string
      jobUrl?: string
      location?: string
      publishedAt?: string
      descriptionHtml?: string
      descriptionPlain?: string
    }
    if (!job.id || !job.title || !job.jobUrl) continue
    out.push({
      id: `ashby:${job.id}`,
      title: job.title,
      company: fallbackCompany,
      location: job.location ?? null,
      date: isoDate(job.publishedAt),
      url: job.jobUrl,
      description: job.descriptionPlain ?? stripHtml(job.descriptionHtml),
      source: "ashby",
    })
  }
  return out
}

export async function jsonFetch(url: string): Promise<unknown | null> {
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
      throw new Error(`could not reach ${url} (${e instanceof Error ? e.message : String(e)})`)
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`request failed: ${response.status} ${response.statusText}`)
      }
      await new Promise((r) => setTimeout(r, delay + Math.floor(Math.random() * 500)))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`request failed: ${response.status} ${response.statusText}`)
    }
    return await response.json()
  }
  throw new Error("request failed after retries")
}

export function boardUrls(board: BoardRef): { list: string; company?: string; job: (id: string) => string } {
  const token = encodeURIComponent(board.token)
  if (board.kind === "greenhouse") {
    return {
      list: `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
      company: `https://boards-api.greenhouse.io/v1/boards/${token}`,
      job: (id) => `https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${encodeURIComponent(id)}`,
    }
  }
  if (board.kind === "lever") {
    return {
      list: `https://api.lever.co/v0/postings/${token}?mode=json`,
      job: (id) => `https://api.lever.co/v0/postings/${token}/${encodeURIComponent(id)}`,
    }
  }
  return {
    list: `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`,
    job: (id) => `https://api.ashbyhq.com/posting-api/job-board/${token}/job/${encodeURIComponent(id)}`,
  }
}

export function matchesQuery(job: JobResult, query: string | undefined): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const hay = `${job.title} ${job.company ?? ""} ${job.location ?? ""} ${job.description ?? ""}`.toLowerCase()
  return hay.includes(q)
}

export function matchesLocation(job: JobResult, location: string | undefined): boolean {
  if (!location) return true
  return (job.location ?? "").toLowerCase().includes(location.toLowerCase())
}

export function withinJobAge(job: JobResult, days: number | undefined): boolean {
  if (days == null) return true
  if (!job.date) return true
  const then = new Date(`${job.date}T00:00:00Z`).getTime()
  if (Number.isNaN(then)) return true
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return then >= cutoff
}

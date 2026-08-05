// Data source: USAJOBS Search API — https://developer.usajobs.gov/api-reference/get-api-search
// The official US federal government job board. Covers every federal agency.
//
// ⚠️ REQUIRES A FREE API KEY. Unlike every other portal in this fork, USAJOBS
// authenticates: requests without an `Authorization-Key` header return HTTP 401.
// Register at https://developer.usajobs.gov/apirequest/ (free, email-confirmed).
//
// Credentials are read from the environment, never stored in the repo:
//   USAJOBS_API_KEY  — the key from the registration email
//   USAJOBS_EMAIL    — the email you registered, sent as the User-Agent header
//                      (USAJOBS requires this; it is how they identify callers)

export const API_BASE = "https://data.usajobs.gov/api/search"
export const REGISTER_URL = "https://developer.usajobs.gov/apirequest/"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export interface Credentials {
  apiKey: string
  email: string
}

/** Read credentials from the environment. Returns null when either is missing. */
export function readCredentials(env: Record<string, string | undefined>): Credentials | null {
  const apiKey = env.USAJOBS_API_KEY?.trim()
  const email = env.USAJOBS_EMAIL?.trim()
  if (!apiKey || !email) return null
  return { apiKey, email }
}

export const MISSING_CREDENTIALS_MESSAGE =
  "USAJOBS requires a free API key. Set USAJOBS_API_KEY and USAJOBS_EMAIL in your environment " +
  `(register at ${REGISTER_URL} — the email you register is sent as the User-Agent header). ` +
  'e.g. export USAJOBS_API_KEY="..." USAJOBS_EMAIL="you@example.com"'

/**
 * Fetch JSON with exponential backoff + jitter on 429/5xx. Returns null on 404.
 * A 401/403 is translated into an actionable credentials error rather than a
 * bare status code, since that is the failure users will actually hit.
 */
export async function jsonFetch<T>(url: string, creds: Credentials): Promise<T | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        Host: "data.usajobs.gov",
        "User-Agent": creds.email,
        "Authorization-Key": creds.apiKey,
        Accept: "application/json",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
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
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `USAJOBS rejected the credentials (HTTP ${response.status}). Check USAJOBS_API_KEY and that ` +
          `USAJOBS_EMAIL matches the address you registered at ${REGISTER_URL}.`,
      )
    }
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return (await response.json()) as T
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
  positionId: string | null
  department: string | null
  salary: string | null
  grade: string | null
  schedule: string | null
  remote: boolean | null
  closeDate: string | null
  source: "USAJOBS"
}

export interface JobDetail extends JobCard {
  description: string | null
  qualifications: string | null
  applyUrl: string | null
}

export interface RawRemuneration {
  MinimumRange?: string
  MaximumRange?: string
  /** A terse code, e.g. "PA". Prefer `Description` for display. */
  RateIntervalCode?: string
  /** Human-readable interval, e.g. "Per Year". Present alongside the code. */
  Description?: string
}

/**
 * PositionSchedule entries come back with an EMPTY `Name` and only a `Code`
 * populated (verified live 2026-08-05). Values from USAJOBS' own codelist:
 * https://data.usajobs.gov/api/codelist/positionscheduletypes
 */
export const SCHEDULE_CODES: Record<string, string> = {
  "1": "Full-time",
  "2": "Part-time",
  "3": "Shift work",
  "4": "Intermittent",
  "5": "Job sharing",
  "6": "Multiple Schedules",
}

export interface RawDescriptor {
  PositionID?: string
  PositionTitle?: string
  PositionURI?: string
  ApplyURI?: string[]
  PositionLocationDisplay?: string
  OrganizationName?: string
  DepartmentName?: string
  JobGrade?: Array<{ Code?: string }>
  PositionSchedule?: Array<{ Name?: string; Code?: string }>
  PositionRemuneration?: RawRemuneration[]
  PublicationStartDate?: string
  ApplicationCloseDate?: string
  QualificationSummary?: string
  UserArea?: {
    Details?: {
      JobSummary?: string
      MajorDuties?: string[]
      Requirements?: string
      Evaluations?: string
    }
    IsRadialSearch?: boolean
  }
}

export interface RawItem {
  MatchedObjectId?: string
  MatchedObjectDescriptor?: RawDescriptor
  RelevanceRank?: number
}

export interface UsaJobsResponse {
  SearchResult?: {
    SearchResultCount?: number
    SearchResultCountAll?: number
    SearchResultItems?: RawItem[]
  }
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
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

export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim()
}

/**
 * Format the salary band. USAJOBS reports it as an array of ranges with a rate
 * interval ("Per Year", "Per Hour"), not a single number.
 */
export function formatSalary(rem: RawRemuneration[] | undefined): string | null {
  if (!Array.isArray(rem) || rem.length === 0) return null
  const r = rem[0]!
  const min = r.MinimumRange
  const max = r.MaximumRange
  if (!min && !max) return null
  // `Description` is the readable form ("Per Year"); `RateIntervalCode` is a
  // terse code ("PA") that reads as noise on its own.
  const label = r.Description?.trim() || r.RateIntervalCode?.trim() || ""
  const interval = label ? ` ${label}` : ""
  const num = (v: string | undefined) => {
    if (!v) return null
    const n = Number(v)
    return Number.isFinite(n) ? `$${Math.round(n).toLocaleString("en-US")}` : `$${v}`
  }
  const lo = num(min)
  const hi = num(max)
  if (lo && hi) return `${lo} - ${hi}${interval}`
  return `${lo ?? hi}${interval}`
}

/**
 * USAJOBS returns PositionURI with an explicit default port —
 * `https://www.usajobs.gov:443/job/879339400`. Strip it: `/scrape` dedupes on
 * URL, so the `:443` and bare forms would otherwise count as two distinct jobs.
 */
export function normalizeUrl(url: string): string {
  return url.replace(/^(https):\/\/([^/:]+):443(?=\/|$)/i, "$1://$2")
            .replace(/^(http):\/\/([^/:]+):80(?=\/|$)/i, "$1://$2")
}

export function toIsoDate(raw: string | undefined): string | null {
  if (!raw || typeof raw !== "string") return null
  // USAJOBS returns local-ish ISO strings without a zone on some fields.
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`
  const t = Date.parse(normalized)
  if (!Number.isNaN(t)) return new Date(t).toISOString()
  const fallback = Date.parse(raw)
  return Number.isNaN(fallback) ? null : new Date(fallback).toISOString()
}

export function normalizeJob(item: RawItem): JobCard | null {
  if (item == null || typeof item !== "object") return null
  const d = item.MatchedObjectDescriptor
  if (!d) return null
  // MatchedObjectId is the control number — the stable identifier.
  const id = item.MatchedObjectId?.trim() || d.PositionID?.trim() || null
  const title = typeof d.PositionTitle === "string" ? d.PositionTitle.trim() : ""
  if (!id || !title) return null

  const grade = Array.isArray(d.JobGrade)
    ? d.JobGrade.map((g) => g?.Code).filter((c): c is string => !!c).join(", ")
    : ""
  // `Name` is empty in practice — resolve the code instead, keeping Name when
  // USAJOBS does populate it.
  const schedule = Array.isArray(d.PositionSchedule)
    ? d.PositionSchedule.map((s) => {
        const name = s?.Name?.trim()
        if (name) return name
        const code = s?.Code?.trim()
        return code ? (SCHEDULE_CODES[code] ?? `Schedule ${code}`) : null
      })
        .filter((n): n is string => !!n)
        .join(", ")
    : ""
  const location = d.PositionLocationDisplay?.trim() || null

  return {
    id,
    title,
    company: d.OrganizationName?.trim() || d.DepartmentName?.trim() || null,
    location,
    date: toIsoDate(d.PublicationStartDate),
    url: d.PositionURI ? normalizeUrl(d.PositionURI) : `https://www.usajobs.gov/job/${id}`,
    positionId: d.PositionID?.trim() || null,
    department: d.DepartmentName?.trim() || null,
    salary: formatSalary(d.PositionRemuneration),
    grade: grade || null,
    schedule: schedule || null,
    // "Remote" appears in the location display for telework-eligible postings.
    remote: location ? /remote|telework|anywhere/i.test(location) : null,
    closeDate: toIsoDate(d.ApplicationCloseDate),
    source: "USAJOBS",
  }
}

export function parseJobs(response: UsaJobsResponse | null): JobCard[] {
  const items = response?.SearchResult?.SearchResultItems
  if (!Array.isArray(items)) return []
  const out: JobCard[] = []
  for (const item of items) {
    const card = normalizeJob(item)
    if (card) out.push(card)
  }
  return out
}

/** Assemble the readable description from the UserArea detail block. */
export function buildDescription(d: RawDescriptor | undefined): string | null {
  if (!d) return null
  const details = d.UserArea?.Details
  const parts: string[] = []
  if (details?.JobSummary) parts.push(htmlToText(details.JobSummary))
  if (Array.isArray(details?.MajorDuties) && details.MajorDuties.length) {
    parts.push("Duties\n" + details.MajorDuties.map((m) => `- ${htmlToText(m)}`).join("\n"))
  }
  if (details?.Requirements) parts.push("Requirements\n" + htmlToText(details.Requirements))
  const joined = parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim()
  return joined || null
}

/** DatePosted is capped at 60 days by the API; clamp rather than error. */
export function clampDatePosted(days: number): number | null {
  if (!days || days <= 0 || days >= 9999) return null
  return Math.min(days, 60)
}

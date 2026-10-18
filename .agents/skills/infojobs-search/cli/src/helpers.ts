// Data source: the official InfoJobs REST API (https://developer.infojobs.net).
// Unlike the other portal CLIs this one needs credentials: an InfoJobs developer
// application's client id and secret, sent as HTTP Basic auth. They are read
// only from the INFOJOBS_API_TOKEN environment variable, never from a flag
// (flags leak into shell history and process listings) and never logged.
//
// Written from the published API documentation. It has not been run against
// the live API by the author (that needs the user's own credentials), so SKILL.md
// ships it disabled until the user's first successful search.

export const API_HOST = "https://api.infojobs.net"
export const WEB_HOST = "https://www.infojobs.net"
export const SEARCH_PATH = "/api/9/offer"
export const DETAIL_PATH = "/api/7/offer"

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

const UA = "Mozilla/5.0 (compatible; infojobs-search-cli/1.0)"

/**
 * Build the Authorization header from INFOJOBS_API_TOKEN, which holds
 * "<client_id>:<client_secret>". The value is never echoed in an error.
 */
export function authHeader(env: Record<string, string | undefined> = process.env): string {
  const token = env.INFOJOBS_API_TOKEN?.trim()
  if (!token) {
    throw new CliError(
      "INFOJOBS_API_TOKEN is not set. Export your InfoJobs API credentials as client_id:client_secret (see SKILL.md, Setup); it is read only from the environment, never from a flag.",
      "MISSING_CREDENTIALS",
    )
  }
  if (!/^[^:\s]+:[^:\s]+$/.test(token)) {
    throw new CliError(
      "INFOJOBS_API_TOKEN must have the form client_id:client_secret (one colon, no spaces).",
      "BAD_CREDENTIALS_FORMAT",
    )
  }
  return `Basic ${Buffer.from(token, "utf8").toString("base64")}`
}

/** GET a JSON document from the API with backoff on 429/5xx. Returns null on a 404. */
export async function apiFetch(path: string, params?: URLSearchParams): Promise<any | null> {
  const authorization = authHeader()
  const url = `${API_HOST}${path}${params && [...params].length ? `?${params.toString()}` : ""}`
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", Authorization: authorization },
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
    if (response.status === 404) return null
    if (response.status === 401 || response.status === 403) {
      throw new CliError(
        "InfoJobs rejected the credentials (HTTP " +
          response.status +
          "). Check that INFOJOBS_API_TOKEN is your application's client_id:client_secret and that the application is active.",
        "INVALID_CREDENTIALS",
      )
    }
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    try {
      return await response.json()
    } catch {
      throw new CliError("InfoJobs returned a response that was not JSON", "PARSE_FAILED")
    }
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
  contract: string | null
  workday: string | null
  experience: string | null
  teleworking: string | null
  summary: string | null
}

export interface JobDetail {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  deadline: null
  url: string
  description: string | null
  minRequirements: string | null
  desiredRequirements: string | null
  salary: string | null
  contract: string | null
  workday: string | null
  experience: string | null
  studies: string | null
  skills: string[]
  active: boolean | null
}

/** Read a value that the API sends either as a string or as {id, value}/{key, value}. */
export function dv(x: unknown): string | null {
  if (typeof x === "string") return x.trim() || null
  if (x && typeof x === "object") {
    const v = (x as { value?: unknown }).value
    if (typeof v === "string") return v.trim() || null
  }
  return null
}

function toDate(x: unknown): string | null {
  if (typeof x !== "string") return null
  const m = x.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

function textOrNull(x: unknown): string | null {
  return typeof x === "string" && x.trim() ? x.replace(/\r/g, "").trim() : null
}

function join(...parts: Array<string | null>): string | null {
  const out = parts.filter((p): p is string => !!p)
  return out.length ? out.join(", ") : null
}

export function parseSearchResponse(data: any): { cards: JobCard[]; total: number | null; pages: number | null } {
  const list = data?.offers ?? data?.items
  if (!Array.isArray(list)) {
    throw new CliError("InfoJobs returned no offers list; the API response shape may have changed", "PARSE_FAILED")
  }
  const cards: JobCard[] = []
  for (const o of list) {
    // One malformed offer must not break the rest.
    const id = typeof o?.id === "string" ? o.id : null
    const title = textOrNull(o?.title)
    if (!id || !title) continue
    const province = dv(o.province)
    const city = textOrNull(o.city)
    cards.push({
      id,
      title,
      company: textOrNull(o.author?.name),
      location: join(city, province && province !== city ? province : null),
      date: toDate(o.published) ?? toDate(o.updated),
      url: typeof o.link === "string" && o.link ? o.link : `${WEB_HOST}/of-i${id}`,
      salary: textOrNull(o.salaryDescription),
      contract: dv(o.contractType),
      workday: dv(o.workDay),
      experience: dv(o.experienceMin),
      teleworking: dv(o.teleworking),
      summary: textOrNull(o.requirementMin),
    })
  }
  return {
    cards,
    total: Number.isFinite(data?.totalResults) ? data.totalResults : null,
    pages: Number.isFinite(data?.totalPages) ? data.totalPages : null,
  }
}

function pay(p: any): string | null {
  return dv(p?.amountValue) ? `${dv(p.amountValue)}${dv(p?.periodValue) ? ` ${dv(p.periodValue)}` : ""}` : null
}

export function parseDetailResponse(data: any, id: string): JobDetail | null {
  if (!data || typeof data !== "object") return null
  const title = textOrNull(data.title)
  if (!title) return null
  const min = pay(data.minPay)
  const max = pay(data.maxPay)
  const profile = data.profile ?? {}
  const skills = Array.isArray(data.skillsList)
    ? data.skillsList.map((s: any) => (typeof s === "string" ? s : s?.skill)).filter((s: unknown) => typeof s === "string" && s)
    : []
  return {
    id,
    title,
    company: textOrNull(profile.name),
    location: join(textOrNull(data.city), dv(data.province)),
    date: toDate(data.creationDate) ?? toDate(data.updateDate),
    // The API publishes no application deadline; null means "not stated".
    deadline: null,
    url: typeof data.link === "string" && data.link ? data.link : `${WEB_HOST}/of-i${id}`,
    description: textOrNull(data.description),
    minRequirements: textOrNull(data.minRequirements),
    desiredRequirements: textOrNull(data.desiredRequirements),
    salary: data.showPay === false ? null : min && max && min !== max ? `${min} - ${max}` : min ?? max,
    contract: dv(data.contractType),
    workday: dv(data.journey),
    experience: dv(data.experienceMin),
    studies: dv(data.studiesMin),
    skills,
    active: typeof data.active === "boolean" ? data.active : null,
  }
}

/** InfoJobs' `sinceDate` takes _24_HOURS, _7_DAYS, _15_DAYS or ANY. */
export function jobageToSinceDate(days: number): string | null {
  if (!days || days <= 0 || days >= 9999) return null
  if (days <= 1) return "_24_HOURS"
  if (days <= 7) return "_7_DAYS"
  if (days <= 15) return "_15_DAYS"
  return null
}

/** Province keys in the InfoJobs dictionaries are lowercase, accent-free and hyphenated. */
export function toProvinceKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

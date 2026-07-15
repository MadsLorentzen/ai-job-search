export const BASE_URL = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service"
export const API_KEY = "jobboerse-jobsuche"
export const JOB_PAGE_URL = "https://www.arbeitsagentur.de/jobsuche/jobdetail"

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
    const response = await fetch(url, {
      headers: {
        "X-API-Key": API_KEY,
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; arbeitsagentur-cli/1.0)",
      },
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

    if (response.status === 404 || response.status === 403) {
      // The v3 jobdetails endpoint answers 403/404 for unknown or externally
      // hosted postings — surface both as "not found" rather than crashing.
      throw new NotFoundError("Job not found (or details not available via the API)")
    }

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`)
    }

    return response.json() as Promise<T>
  }
  throw new Error("API request failed after max retries")
}

export class NotFoundError extends Error {}

export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  startDate: string | null
  externalUrl: string | null
  distanceKm: string | null
}

interface RawArbeitsort {
  plz?: string
  ort?: string
  region?: string
  land?: string
  entfernung?: string
}

export interface RawStellenangebot {
  refnr: string
  titel?: string
  beruf?: string
  arbeitgeber?: string
  arbeitsort?: RawArbeitsort
  aktuelleVeroeffentlichungsdatum?: string
  eintrittsdatum?: string
  externeUrl?: string
}

export interface SearchResponse {
  stellenangebote?: RawStellenangebot[]
  maxErgebnisse?: number
  page?: number
  size?: number
}

function formatLocation(ort?: RawArbeitsort): string | null {
  if (!ort) return null
  const parts = [ort.plz, ort.ort].filter((p) => p && p !== "null")
  let s = parts.join(" ")
  if (ort.land && ort.land !== "null" && ort.land !== "Deutschland" && ort.land !== "DEUTSCHLAND") {
    s = s ? `${s} (${ort.land})` : ort.land
  }
  return s || ort.region || null
}

export function mapJob(raw: RawStellenangebot): JobResult {
  return {
    id: raw.refnr,
    title: raw.titel || raw.beruf || "(ohne Titel)",
    company: raw.arbeitgeber || null,
    location: formatLocation(raw.arbeitsort),
    date: raw.aktuelleVeroeffentlichungsdatum || null,
    url: `${JOB_PAGE_URL}/${encodeURIComponent(raw.refnr)}`,
    startDate: raw.eintrittsdatum || null,
    externalUrl: raw.externeUrl || null,
    distanceKm: raw.arbeitsort?.entfernung ?? null,
  }
}

/** Encode a refnr for the v3 jobdetails endpoint (base64 of the raw refnr). */
export function encodeRefnr(refnr: string): string {
  return Buffer.from(refnr, "utf-8").toString("base64")
}

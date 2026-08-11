// Data source: Sweden's official JobSearch API (jobtechdev.se / Arbetsförmedlingen's
// open-data platform), which backs the Platsbanken job board at arbetsformedlingen.se.
// Public, unauthenticated, returns clean JSON — no HTML parsing needed.

export const BASE_URL = "https://jobsearch.api.jobtechdev.se"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

/**
 * Fetch JSON with exponential backoff on 429/5xx (max 6 retries, jittered).
 * Returns null on a 404. Throws on other non-2xx responses (e.g. 400 for a
 * malformed query) so the caller can surface a clear error immediately.
 */
export async function apiFetch<T>(path: string, params?: Record<string, string>): Promise<T | null> {
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
        "User-Agent": UA,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    })

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }

    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`)
    }

    return response.json() as Promise<T>
  }
  throw new Error("API request failed after max retries")
}

export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  deadline: string | null
  occupation: string | null
}

/** Raw shape of one item in the JobSearch API's `hits` array (fields we use). */
export interface RawHit {
  id: string
  headline: string
  webpage_url: string
  application_deadline: string | null
  publication_date: string | null
  employer: { name: string | null } | null
  workplace_address: { municipality: string | null; region: string | null; country: string | null } | null
  occupation: { label: string | null } | null
  description: { text: string | null } | null
  employment_type: { label: string | null } | null
  working_hours_type: { label: string | null } | null
  duration: { label: string | null } | null
  application_details: { url: string | null; email: string | null; information: string | null } | null
}

export interface RawSearchResponse {
  total: { value: number }
  hits: RawHit[]
}

function formatLocation(addr: RawHit["workplace_address"]): string | null {
  if (!addr) return null
  const parts = [addr.municipality, addr.region].filter((p): p is string => !!p)
  return parts.length > 0 ? parts.join(", ") : (addr.country ?? null)
}

export function toJobResult(hit: RawHit): JobResult {
  return {
    id: hit.id,
    title: hit.headline,
    company: hit.employer?.name ?? null,
    location: formatLocation(hit.workplace_address),
    date: hit.publication_date ?? null,
    url: hit.webpage_url,
    deadline: hit.application_deadline ?? null,
    occupation: hit.occupation?.label ?? null,
  }
}

/** Convert a job-age in days to the API's `published-after` date (YYYY-MM-DD). */
export function jobageToPublishedAfter(days: number | undefined): string | null {
  if (!days || days <= 0 || days >= 9999) return null
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

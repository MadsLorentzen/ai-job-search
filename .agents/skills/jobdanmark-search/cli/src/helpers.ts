export const BASE_URL = "https://jobdanmark.dk"
export const USER_AGENT = "Mozilla/5.0 (compatible; jobdanmark-cli/1.0)"

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
      headers: { "User-Agent": USER_AGENT },
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
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`)
    }
    return response.json() as Promise<T>
  }
  throw new Error("API request failed after max retries")
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const url = `${BASE_URL}${path}`

  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(body),
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
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`)
    }
    return response.json() as Promise<T>
  }
  throw new Error("API request failed after max retries")
}

/**
 * Fetch a rendered jobdanmark.dk page as text, with the same 429/5xx backoff,
 * request timeout, and User-Agent as apiFetch/apiPost. `detail` reads HTML
 * rather than the JSON API; it used to call fetch() directly with none of the
 * three, so a rate-limited detail page failed on the first 429 while every
 * other portal's detail command retried. Returns null on 404 so the caller
 * keeps its own NOT_FOUND contract.
 */
export async function htmlFetch(url: string): Promise<string | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
      },
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
      return null
    }
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("API request failed after max retries")
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
}

const JOBDANMARK_HOST = /(^|\.)jobdanmark\.dk$/i

/**
 * Extract a jobdanmark slug from a bare slug, a relative `/job/<slug>` path,
 * or a jobdanmark.dk `/job/<slug>` URL.
 *
 * A URL on any other host is rejected. The previous pattern took the segment
 * after `/job/` from ANY string, so an off-host posting URL (e.g. from
 * Greenhouse or another ATS) was accepted and `detail` fetched the portal's
 * fallback search page, exiting 0 with a bogus posting. URLs are parsed for real:
 * scheme-less portal links and subdomains are accepted, while look-alike hosts
 * (jobdanmark.dk.evil.io), userinfo tricks (jobdanmark.dk@evil.io), and non-web
 * schemes fall on the reject side.
 */
export function normalizeSlug(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // A bare slug: alphanumerics, hyphens and underscores (no slashes or schemes).
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed

  let url: URL
  try {
    if (trimmed.startsWith("/")) {
      url = new URL(trimmed, BASE_URL)
    } else {
      const hasScheme = /^https?:\/\//i.test(trimmed)
      const hostLike = /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)
      if (!hasScheme && !hostLike) return null
      url = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    }
  } catch {
    return null
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (!JOBDANMARK_HOST.test(url.hostname)) return null

  // A matching path on a different site or in a query string is not a Jobdanmark
  // posting. Read only the parsed pathname.
  const match = url.pathname.match(/^\/job\/([a-zA-Z0-9_-]+)(?:\/|$)/)
  return match ? match[1] : null
}


export const BASE_URL = "https://jobnet.dk/bff"
export const USER_AGENT = "Mozilla/5.0 (compatible; jobnet-cli/1.0)"

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
        "User-Agent": USER_AGENT,
        "x-csrf": "1",
      },
      signal: AbortSignal.timeout(15000),
    })

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`)
      }
      // Add jitter to spread out retries: base delay + random 0-500ms
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

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function normalizeJobId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed
  let url: URL
  try {
    const hostLike = /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)
    url = new URL(hostLike ? `https://${trimmed}` : trimmed)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (url.hostname !== "jobnet.dk" && !url.hostname.endsWith(".jobnet.dk")) return null
  // Otherwise an unrelated site's matching path silently selects a Jobnet ad.
  // Keep legacy routes, but never interpret a query or fragment as a job path.
  const match = url.pathname.match(/(?:\/find-job\/|\/JobAdDetails\/|\/Details\/)(?:detaljer\/)?([a-zA-Z0-9_-]+)(?:\/|$)/i)
  if (match) return match[1]
  return null
}


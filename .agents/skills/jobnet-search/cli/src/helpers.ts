export const BASE_URL = "https://jobnet.dk/bff"

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
        "x-csrf": "1",
      },
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

/**
 * Cap a result list to the first `limit` items.
 *
 * Only applies when `limit` is a positive, finite number; a negative, zero,
 * NaN, or `undefined` limit returns the full list unchanged. This mirrors the
 * linkedin-search CLI's `limit > 0` guard and avoids `Array.prototype.slice`'s
 * negative-index semantics, where `slice(0, -1)` silently drops the trailing
 * item instead of capping (e.g. `--limit -1` on 20 results would return 19).
 */
export function capResults<T>(items: T[], limit?: number): T[] {
  if (limit !== undefined && Number.isFinite(limit) && limit > 0) {
    return items.slice(0, limit)
  }
  return items
}

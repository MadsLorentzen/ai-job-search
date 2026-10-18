import { BASE_URL, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const INDEED_HOST = /(^|\.)indeed\.com$/i

/**
 * Accept a 16-hex job key or an indeed.com URL carrying `jk=<key>`. Host and
 * query are read through real URL parsing, so look-alike hosts
 * (indeed.com.evil.io) and userinfo tricks (indeed.com@evil.io) are rejected.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (/^[0-9a-f]{16}$/i.test(trimmed)) return trimmed.toLowerCase()

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (!hasScheme && !/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) return null
  let parsed: URL
  try {
    parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (!INDEED_HOST.test(parsed.hostname)) return null
  const jk = parsed.searchParams.get("jk")
  return jk && /^[0-9a-f]{16}$/i.test(jk) ? jk.toLowerCase() : null
}

/**
 * Indeed posting pages live under /viewjob, which Indeed's robots.txt
 * disallows for automated clients (they also answer 401 until a JavaScript
 * challenge completes). This command therefore never fetches the page: it
 * validates the input, then exits 1 with DETAIL_UNAVAILABLE and the way
 * forward. The search card's own `snippet`, `salary` and `date` are the
 * automated data; the full text has to be pasted in by the user.
 */
export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse an Indeed job key from "${opts.id}"`, "BAD_ID")
    return 1
  }
  writeError(
    `Indeed disallows automated access to posting pages (/viewjob in robots.txt), so no detail is fetched. ` +
      `Use the snippet from \`search\`, or open ${BASE_URL}/viewjob?jk=${id} in a browser and paste the posting text into /apply.`,
    "DETAIL_UNAVAILABLE",
  )
  return 1
}

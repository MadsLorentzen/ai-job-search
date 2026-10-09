import type { StandardJob } from "./job-schema.js"

export function canonicalJobKey(job: Pick<StandardJob, "portal" | "id" | "url" | "company" | "title" | "location">): string {
  if (job.id.trim() || job.url.trim()) return sourceJobKey(job)
  return crossPortalJobKey(job)
}

/**
 * A stable source-local key. Prefer this when the same portal can expose a
 * posting through multiple URLs or when a portal-native ID is available.
 */
export function sourceJobKey(job: Pick<StandardJob, "portal" | "id" | "url">): string {
  const source = "portal:" + job.portal.trim().toLowerCase()
  if (job.id.trim()) return source + "|id:" + job.id.trim()
  return source + "|url:" + normalizeUrl(job.url)
}

/**
 * A conservative cross-portal key. It intentionally excludes salary/date:
 * those change over time and would defeat dedupe. Empty company/location parts
 * are retained so a weakly populated record never collapses unrelated jobs.
 */
export function crossPortalJobKey(job: Pick<StandardJob, "company" | "title" | "location">): string {
  return "text:" + [job.company, job.title, job.location]
    .map((value) => (value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim())
    .join("|")
}

export function normalizeUrl(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ""
    url.search = ""
    return url.toString().replace(/\/$/, "")
  } catch {
    return value.trim().replace(/#.*$/, "").replace(/\/$/, "")
  }
}

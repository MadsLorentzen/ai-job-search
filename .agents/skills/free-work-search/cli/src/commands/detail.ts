import {
  API_BASE,
  SEARCH_PATH,
  jsonFetch,
  normalizeDetail,
  writeError,
  type JobDetail,
  type RawPosting,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * Free-Work keys single postings by **slug**, not by numeric id
 * (`/job_postings/{slug}`; the numeric id 404s). Accept either a bare slug or a
 * full www.free-work.com posting URL, and pull the slug off the end of the URL.
 */
export function slugFromInput(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const path = new URL(trimmed).pathname.replace(/\/+$/, "")
      const last = path.split("/").pop() ?? ""
      return last || null
    } catch {
      return null
    }
  }
  // A bare number is a search-result id, which this endpoint cannot resolve.
  if (/^\d+$/.test(trimmed)) return null
  return trimmed
}

function renderPlain(d: JobDetail): string {
  const lines = [
    d.title,
    "",
    `Company:    ${d.company ?? "—"}`,
    `Location:   ${d.location ?? "—"}`,
    `Category:   ${d.category ?? "—"}`,
    `Contracts:  ${d.contracts.length ? d.contracts.join(", ") : "—"}`,
    `TJM:        ${d.dailyRate ?? "—"}`,
    `Salary:     ${d.annualSalary ?? "—"}`,
    `Duration:   ${d.duration ?? "—"}${d.renewable ? " (renewable)" : ""}`,
    `Remote:     ${d.remote ?? "—"}`,
    `Experience: ${d.experienceLevel ?? "—"}`,
    `Published:  ${d.date ?? "—"}`,
    `Expires:    ${d.expiresAt ?? "—"}`,
    `URL:        ${d.url}`,
  ]
  if (d.applyUrl) lines.push(`Apply:      ${d.applyUrl}`)
  lines.push("", d.description ?? "(no description)")
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const slug = slugFromInput(opts.id)
  if (!slug) {
    writeError(
      `"${opts.id}" is not a usable identifier. Free-Work keys postings by slug, not by ` +
        `numeric id — pass the "slug" field from a search result, or the full posting URL.`,
      "BAD_ID",
    )
    return 1
  }

  try {
    const raw = await jsonFetch<RawPosting>(`${API_BASE}${SEARCH_PATH}/${encodeURIComponent(slug)}`)
    if (raw === null) {
      writeError(`No posting found for slug "${slug}" (it may have expired)`, "NOT_FOUND")
      return 1
    }
    const detail = normalizeDetail(raw)
    if (opts.format === "plain") {
      process.stdout.write(renderPlain(detail) + "\n")
    } else {
      process.stdout.write(JSON.stringify(detail, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}

import {
  API_BASE,
  jsonFetch,
  normalizeJob,
  normalizeUrl,
  buildDescription,
  htmlToText,
  writeError,
  type Credentials,
  type JobDetail,
  type RawItem,
  type UsaJobsResponse,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * Accept a control number (MatchedObjectId, all digits), an announcement number
 * (PositionID, e.g. "ST-12345678-26-XY"), or a usajobs.gov job URL.
 */
export function extractId(input: string): string | null {
  const trimmed = input.trim()
  const urlMatch = trimmed.match(/usajobs\.gov\/(?:job|GetJob\/ViewDetails)\/(\d+)/i)
  if (urlMatch) return urlMatch[1]!
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{2,}$/.test(trimmed)) return trimmed
  return null
}

/**
 * USAJOBS' public Search API has no fetch-by-id endpoint — the per-announcement
 * detail lives behind a separate `/api/announcementtext` API that needs extra
 * authorization. So `detail` searches for the identifier as a keyword (both
 * control and announcement numbers are indexed) and selects the exact match.
 */
export function buildDetailUrl(id: string): string {
  const params = new URLSearchParams()
  params.set("Keyword", id)
  params.set("WhoMayApply", "Public")
  params.set("ResultsPerPage", "25")
  // fields=all returns the UserArea.Details block carrying the full description.
  params.set("fields", "all")
  return `${API_BASE}?${params.toString()}`
}

/** Pick the item whose control number or announcement number matches exactly. */
export function selectMatch(response: UsaJobsResponse | null, id: string): RawItem | null {
  const items = response?.SearchResult?.SearchResultItems
  if (!Array.isArray(items)) return null
  const want = id.trim().toLowerCase()
  const exact = items.find(
    (i) =>
      i?.MatchedObjectId?.trim().toLowerCase() === want ||
      i?.MatchedObjectDescriptor?.PositionID?.trim().toLowerCase() === want,
  )
  return exact ?? null
}

export function buildDetail(item: RawItem): JobDetail | null {
  const card = normalizeJob(item)
  if (!card) return null
  const d = item.MatchedObjectDescriptor
  return {
    ...card,
    description: buildDescription(d),
    qualifications: d?.QualificationSummary ? htmlToText(d.QualificationSummary) || null : null,
    applyUrl: d?.ApplyURI?.[0] ? normalizeUrl(d.ApplyURI[0]!) : card.url,
  }
}

export async function runDetail(opts: DetailOpts, creds: Credentials): Promise<number> {
  try {
    const id = extractId(opts.id)
    if (!id) {
      writeError(`could not extract a job id from "${opts.id}"`, "BAD_ID")
      return 1
    }

    const response = await jsonFetch<UsaJobsResponse>(buildDetailUrl(id), creds)
    const item = selectMatch(response, id)
    if (!item) {
      writeError(
        `no open announcement matching "${id}". USAJOBS' search API only returns CURRENTLY OPEN postings, so a closed announcement is unfindable here even if the id is correct.`,
        "NOT_FOUND",
      )
      return 1
    }

    const detail = buildDetail(item)
    if (!detail) {
      writeError(`announcement ${id} returned an unparseable record`, "PARSE_FAILED")
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        detail.title,
        `${detail.company || "—"} · ${detail.location || "—"}`,
        detail.department ? `Department: ${detail.department}` : null,
        `Posted: ${detail.date || "—"}`,
        detail.closeDate ? `Closes: ${detail.closeDate}` : null,
        detail.salary ? `Salary: ${detail.salary}` : null,
        detail.grade ? `Grade: ${detail.grade}` : null,
        detail.schedule ? `Schedule: ${detail.schedule}` : null,
        `URL: ${detail.url}`,
        "",
        detail.description || "(no description)",
        detail.qualifications ? `\nQualifications\n${detail.qualifications}` : null,
      ].filter((l): l is string => l !== null)
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(detail, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}

import { JOBS_BASE_URL, fetchText, parseJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * Accept a full xing.com job URL, or the bare slug (path segment after /jobs/)
 * as returned in `search` results' `id` field. Xing's trailing numeric ID alone
 * does NOT reliably resolve to the same posting (verified live: /jobs/<number>
 * without its slug words served a completely different job) - the full slug is
 * required, not just the number at its end.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim()
  if (/^https?:\/\/(www\.)?xing\.com\/jobs\/[^/?#]+/i.test(trimmed)) {
    return trimmed.replace(/^http:/i, "https:").split(/[?#]/)[0]
  }
  if (/^[a-z0-9]+(-[a-z0-9]+)*-\d+$/i.test(trimmed)) {
    return `${JOBS_BASE_URL}/${trimmed}`
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const url = normalizeUrl(opts.id)
  if (!url) {
    writeError(
      `Could not resolve a Xing job URL from "${opts.id}" - Xing requires the full slug ` +
        `(e.g. "koeln-ot-cyber-security-senior-consultant-122981029"), not just the trailing ` +
        `numeric ID; pass the id/url exactly as returned by search`,
      "BAD_ID",
    )
    return 1
  }
  try {
    const html = await fetchText(url)
    if (!html) {
      writeError("Job not found (404/410 - likely removed)", "NOT_FOUND")
      return 1
    }
    const id = url.split("/").filter(Boolean).pop()!
    const detail = parseJobDetail(html, id, url)
    if (!detail) {
      writeError("Could not parse job details from the response - Xing may have changed its markup", "PARSE_FAILED")
      return 1
    }

    if (opts.format === "plain") {
      const activeLine =
        detail.isActive === null ? "Status: UNKNOWN (no validThrough on the posting)" : `Status: ${detail.isActive ? "ACTIVE" : "EXPIRED"}`
      const lines = [
        detail.title,
        `${detail.company || "—"} · ${detail.location || "—"}`,
        "",
        detail.employmentType ? `Employment: ${detail.employmentType}` : "",
        detail.industry ? `Industry: ${detail.industry}` : "",
        detail.date ? `Posted: ${detail.date}` : "",
        detail.validThrough ? `Valid through: ${detail.validThrough}` : "",
        activeLine,
        "",
        detail.description || "(no description)",
        "",
        `URL: ${detail.url}`,
      ].filter((l) => l !== "")
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

import { BASE, htmlFetch, parseJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a bare numeric job id or any apna /job/... URL. */
function normalizeId(input: string): string | null {
  const url = input.match(/-(\d{6,})(?:[/?#]|$)/) || input.match(/\/(\d{6,})(?:[/?#]|$)/)
  if (url) return url[1]
  const bare = input.match(/^\d{6,}$/)
  if (bare) return input
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a job id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    // Slug segments in /job/<slug>/<slug>-<id> are cosmetic; the bare id resolves.
    const html = await htmlFetch(`${BASE}/job/${id}`)
    if (!html) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(html, id)
    if (!job) {
      writeError("Could not parse job detail from apna.co", "PARSE_FAILED")
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        job.salary ? `Salary: ${job.salary}` : "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.category ? `Category: ${job.category}` : "",
        job.industry ? `Industry: ${job.industry}` : "",
        job.date ? `Posted: ${job.date}` : "",
        job.validThrough ? `Apply by: ${job.validThrough}` : "",
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
        job.applyUrl ? `Apply: ${job.applyUrl}` : "",
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}

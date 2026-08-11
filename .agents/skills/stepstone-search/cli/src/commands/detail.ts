import { BASE_URL, htmlFetch, parseJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a raw job ID or a full stellenangebote URL. */
function normalize(input: string): { id: string; url: string } | null {
  const urlMatch = input.match(/--(\d+)-inline\.html/)
  if (urlMatch) {
    const url = input.startsWith("http") ? input : `${BASE_URL}${input.startsWith("/") ? "" : "/"}${input}`
    return { id: urlMatch[1]!, url }
  }
  const bare = input.match(/^\d{5,}$/)
  if (bare) {
    // A bare ID has no known slug — StepStone's detail URLs require the slug text before the
    // ID, so pass the raw ID through as-is; the caller likely has the full URL from `search`.
    return { id: input, url: input }
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const normalized = normalize(opts.id)
  if (!normalized) {
    writeError(`Could not parse a job ID from "${opts.id}" — pass a full stellenangebote URL from search results, or a bare numeric ID`, "BAD_ID")
    return 1
  }
  if (!normalized.url.startsWith("http")) {
    writeError(
      "A bare numeric ID is not enough to fetch a StepStone detail page (the URL needs the job's slug text). Pass the full URL from a `search` result instead.",
      "ID_NEEDS_URL",
    )
    return 1
  }
  try {
    const html = await htmlFetch(normalized.url, `${BASE_URL}/`)
    if (!html) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(html, normalized.id, normalized.url)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.contractType ? `Contract: ${job.contractType}` : "",
        job.workType ? `Work type: ${job.workType}` : "",
        job.onlineDate ? job.onlineDate : "",
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
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

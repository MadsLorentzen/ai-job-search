import {
  DETAIL_URL,
  jsonFetch,
  parseDetail,
  writeError,
  type DetailResponse,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a raw job ID or a job-detail URL (…/j/<slug>-<id>). */
function normalizeId(input: string): string | null {
  const bare = input.match(/^\d{5,}$/)
  if (bare) return input
  const url = input.match(/-(\d{5,})(?:\?|#|$)/) || input.match(/\/(\d{5,})(?:\?|#|$)/)
  if (url) return url[1]
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a job ID from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const resp = await jsonFetch<DetailResponse>(`${DETAIL_URL}?jobcode=${id}`)
    if (!resp || !resp.data || !resp.data.id) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = parseDetail(resp.data)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        job.minExp !== null || job.maxExp !== null
          ? `Experience: ${job.minExp ?? "?"}-${job.maxExp ?? "?"} yrs`
          : "",
        job.date ? `Posted: ${job.date}` : "",
        job.tags.length ? `Skills: ${job.tags.join(", ")}` : "",
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

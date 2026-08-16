import { DETAIL_URL, jsonFetch, toDetail, writeError, type RawJob } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

interface DetailResponse {
  data?: RawJob
}

/** Accept a raw job id or a hirist job URL (…/j/<slug>-<id>). */
function normalizeId(input: string): string | null {
  const bare = input.match(/^\d{4,}$/)
  if (bare) return input
  const url = input.match(/-(\d{4,})(?:\?|#|$)/) || input.match(/\/(\d{4,})(?:\?|#|$)/)
  if (url) return url[1]
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a job id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const res = await jsonFetch<DetailResponse>(`${DETAIL_URL}?jobcode=${id}`)
    if (!res?.data) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = toDetail(res.data)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"} · ${job.experience || "—"}`,
        job.workFromHome ? "Work from home: yes" : "",
        job.skills.length ? `Skills: ${job.skills.join(", ")}` : "",
        job.date ? `Posted: ${job.date}` : "",
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

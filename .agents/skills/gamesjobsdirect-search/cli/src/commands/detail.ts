import { detailUrl, htmlFetch, parseJobDetail, writeError, type JobDetail } from "../helpers.js"

export interface DetailOpts {
  id: string // a GamesJobsDirect numeric job id, or a /job/<slug>/<slug>/<id> URL
  format: "json" | "plain"
}

/** Accept a bare numeric id or a full /job/<slug>/<slug>/<id> URL. */
function normalizeId(input: string): string | null {
  const url = input.match(/\/job\/[^/]+\/[^/]+\/(\d+)/)
  if (url) return url[1]
  const bare = input.match(/^\d+$/)
  return bare ? input : null
}

function renderPlain(job: JobDetail): string {
  const lines = [job.title, `${job.company || "—"} · ${job.location || "—"}`, ""]
  if (job.employmentType) lines.push(`Employment: ${job.employmentType}`)
  if (job.workHours) lines.push(`Hours: ${job.workHours}`)
  if (job.industry) lines.push(`Industry: ${job.industry}`)
  if (job.deadline) lines.push(`Deadline: ${job.deadline}`)
  lines.push("", job.description || "(no description)", "", `URL: ${job.url}`, `id: ${job.id}`)
  if (job.applyUrl) lines.push(`Apply: ${job.applyUrl}`)
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a job id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const html = await htmlFetch(detailUrl(id))
    const job = parseJobDetail(html, id)
    if (!job) {
      writeError("Job not found (expired or invalid id)", "NOT_FOUND")
      return 1
    }

    if (opts.format === "plain") {
      process.stdout.write(renderPlain(job) + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}

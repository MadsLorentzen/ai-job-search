import { apiGet, normalizeId, toDetail, writeError, type ArtStationJob, type JobDetailResult } from "../helpers.js"

export interface DetailOpts {
  id: string // an ArtStation job hash_id or a /jobs/<hash_id> URL
  format: "json" | "plain"
}

function renderPlain(job: JobDetailResult): string {
  const lines = [job.title, `${job.company ?? "—"} · ${job.location ?? (job.remote ? "Remote" : "—")}`]

  const field = (label: string, value: string | null) => {
    if (value) lines.push(`${label}: ${value}`)
  }
  field("Posted", job.date && job.date.slice(0, 10))
  field("Level", job.level)
  field("Type", job.job_type)
  field("Salary", job.salary)
  field("Remote", job.remote ? "Yes" : "No")
  field("Relocation offered", job.offerRelocation ? "Yes" : "No")
  field("Skills", job.skills.length ? job.skills.join(", ") : null)

  lines.push("", job.description ?? "(no description)", "", `URL: ${job.url}`, `id: ${job.id}`)
  if (job.applyUrl) lines.push(`Apply: ${job.applyUrl}`)
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`could not parse an ArtStation job id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const job = await apiGet<ArtStationJob>(`/jobs/${encodeURIComponent(id)}.json`)
    if (!job) {
      writeError("job not found", "NOT_FOUND")
      return 1
    }
    const detail = toDetail(job)

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

import { typesenseSearch, normalizeId, toDetail, writeError, type HitmarkerJob, type JobDetailResult } from "../helpers.js"

export interface DetailOpts {
  id: string // a Hitmarker job id or a /jobs/<slug>-<id> URL
  format: "json" | "plain"
}

function renderPlain(job: JobDetailResult): string {
  const lines = [job.title, `${job.company ?? "—"} · ${job.location ?? (job.remote ? "Remote" : "—")}`]

  const field = (label: string, value: string | null) => {
    if (value) lines.push(`${label}: ${value}`)
  }
  field("Posted", job.date && job.date.slice(0, 10))
  field("Level", job.level)
  field("Contract", job.contract)
  field("Salary", job.salary)
  field("Tags", job.tags.length ? job.tags.join(", ") : null)

  lines.push("", job.description ?? "(no description)", "", `URL: ${job.url}`, `id: ${job.id}`)
  if (job.applyUrl) lines.push(`Apply: ${job.applyUrl}`)
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`could not parse a Hitmarker job id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    // The scoped search key cannot retrieve a document directly (401), so
    // detail reuses multi_search filtered to this one id.
    const result = await typesenseSearch<HitmarkerJob>({
      q: "*",
      query_by: "title",
      filter_by: `id:=${id}`,
      per_page: 1,
    })
    const doc = result.hits[0]?.document
    if (!doc) {
      writeError("job not found", "NOT_FOUND")
      return 1
    }
    const detail = toDetail(doc)

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

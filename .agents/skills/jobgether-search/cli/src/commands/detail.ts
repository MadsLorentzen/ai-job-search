import {
  ApiError,
  buildOfferUrl,
  fetchOfferHtml,
  normalizeId,
  parseOfferDetail,
  writeError,
  type JobDetailResult,
} from "../helpers.js"

export interface DetailOpts {
  id: string // a bare 24-hex job id, or a full /offer/<id>-<slug> URL
  format: "json" | "plain"
}

function renderPlain(job: JobDetailResult): string {
  const lines = [job.title, `${job.company || "—"} · ${job.location || "—"}`]
  const field = (label: string, value: string | null) => {
    if (value) lines.push(`${label}: ${value}`)
  }
  field("Posted", job.date && job.date.slice(0, 10))
  field("Employment", job.employmentType)
  field("Deadline", job.deadline && job.deadline.slice(0, 10))
  field("Apply", job.applyUrl)
  lines.push("", job.description || "(no description)", "", `URL: ${job.url}`, `id: ${job.id}`)
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`could not parse a jobgether job id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  const url = /^https?:\/\//i.test(opts.id) ? opts.id : buildOfferUrl(id)

  try {
    const html = await fetchOfferHtml(url)
    if (!html) {
      writeError("job not found (removed or expired)", "NOT_FOUND")
      return 1
    }
    const job = parseOfferDetail(html, id, url)

    if (opts.format === "plain") {
      process.stdout.write(renderPlain(job) + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    if (e instanceof ApiError) writeError(e.message, e.code)
    else writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}

import {
  JOB_BASE,
  fetchText,
  parseJobDetail,
  idFromLoc,
  writeError,
  type JobDetail,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a bare job id, a full /job/ URL, or a slug; resolve to { id, url }. */
function normalize(input: string): { id: string; url: string } {
  const trimmed = input.trim()
  if (/cutshort\.io\/job\//i.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
    return { id: idFromLoc(trimmed), url: trimmed.replace(/[?#].*$/, "") }
  }
  // Bare id or slug — the public page serves the same content from the bare id.
  const id = idFromLoc(trimmed)
  return { id, url: `${JOB_BASE}/${trimmed}` }
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const { id, url } = normalize(opts.id)
  try {
    const html = await fetchText(url)
    if (!html) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job: JobDetail | null = parseJobDetail(html, id, url)
    if (!job) {
      writeError("Could not parse job posting from page", "PARSE_FAILED")
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        job.title || "(untitled)",
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.salary ? `Salary: ${job.salary}` : "",
        job.date ? `Posted: ${job.date}` : "",
        job.validThrough ? `Apply by: ${job.validThrough}` : "",
        job.skills ? `Skills: ${job.skills}` : "",
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

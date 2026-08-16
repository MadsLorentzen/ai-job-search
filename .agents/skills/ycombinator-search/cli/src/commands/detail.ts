import { fetchDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a raw numeric job ID or a /jobs/<id> URL. */
function normalizeId(input: string): string | null {
  const url = input.match(/\/jobs\/(\d+)/)
  if (url) return url[1]
  const bare = input.match(/^\d+$/)
  if (bare) return input
  const any = input.match(/(\d{3,})/)
  return any ? any[1] : null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a job ID from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const job = await fetchDetail(id)
    if (!job) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"}${job.companyBatch ? ` (${job.companyBatch})` : ""} · ${job.location || "—"}`,
        "",
        job.jobType ? `Type: ${job.jobType}` : "",
        job.salaryRange ? `Salary: ${job.salaryRange}` : "",
        job.equityRange ? `Equity: ${job.equityRange}` : "",
        job.minExperience ? `Min experience: ${job.minExperience}` : "",
        job.sponsorsVisa ? `Visa: ${job.sponsorsVisa}` : "",
        job.skills.length ? `Skills: ${job.skills.join(", ")}` : "",
        "",
        job.description || "(no description)",
        job.interviewProcess ? `\nInterview process:\n${job.interviewProcess}` : "",
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

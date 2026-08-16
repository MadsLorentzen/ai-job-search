import { fetchJobs, toJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a raw job ID or a remoteok.com job URL. */
function normalizeId(input: string): string {
  const url = input.match(/\/remote-jobs\/[^/]*-(\d+)(?:\/|$|\?)/) || input.match(/(\d{4,})/)
  return url ? url[1] : input
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  try {
    const raw = await fetchJobs()
    const match = raw.find((j) => j.id === id)
    if (!match) {
      writeError("Job not found (RemoteOK's API only serves the current ~100 live postings)", "NOT_FOUND")
      return 1
    }
    const job = toJobDetail(match)

    if (opts.format === "plain") {
      const salary = job.salaryMin || job.salaryMax ? `Salary: $${job.salaryMin ?? "?"}-${job.salaryMax ?? "?"}` : ""
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "Remote"}`,
        job.tags.length ? `Tags: ${job.tags.join(", ")}` : "",
        salary,
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

import { fetchDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a raw job ID or a remoteok.com job URL. */
function normalizeId(input: string): string | null {
  const url = input.match(/remote-jobs\/(?:[\w-]*-)?(\d+)(?:\?|$|\/)/i)
  if (url) return url[1]
  const bare = input.match(/^\d+$/)
  if (bare) return input
  return null
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
      const salary =
        job.salaryMin || job.salaryMax
          ? `$${job.salaryMin ?? "?"} - $${job.salaryMax ?? "?"}`
          : null
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "Worldwide"}`,
        job.tags.length ? `Tags: ${job.tags.join(", ")}` : "",
        salary ? `Salary: ${salary}` : "",
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

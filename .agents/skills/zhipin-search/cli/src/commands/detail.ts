import { detailPage, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a raw job id, or a full BOSS直聘 job_detail URL. */
function normalizeId(input: string): string | null {
  const url = input.match(/\/job_detail\/([^/?#]+)/)
  if (url) return url[1]
  // BOSS直聘 job ids are long mixed-case alphanumeric tokens (e.g. f902a6107a7a3a6b0nF839q0GVBW).
  if (/^[A-Za-z0-9_-]{12,}$/.test(input)) return input
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a job id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const job = await detailPage(id)
    if (!job) {
      writeError("Job not found (or the detail page did not render)", "NOT_FOUND")
      return 1
    }
    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"} · ${job.salary || "—"}`,
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
      ]
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

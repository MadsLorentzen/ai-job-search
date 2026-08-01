import { ALL_JOBS_FEED, textFetch, parseFeedDetail, slugFromUrl, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a bare slug or a full weworkremotely.com job URL. */
function normalizeId(input: string): string {
  return input.includes("/") ? slugFromUrl(input) : input.trim()
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a job id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const xml = await textFetch(ALL_JOBS_FEED)
    const jobs = parseFeedDetail(xml)
    const job = jobs.find((j) => j.id === id)
    if (!job) {
      writeError(
        "Job not found in the current feed window (We Work Remotely has no older-postings lookup; see url-reference.md)",
        "NOT_FOUND",
      )
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.region || "—"} · ${job.category || "—"}`,
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

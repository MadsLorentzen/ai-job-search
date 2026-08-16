import { ALL_JOBS_FEED, fetchFeed, parseDescription, parseItems, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a raw slug id or a full weworkremotely.com job URL. */
function normalizeId(input: string): string {
  const m = input.match(/\/remote-jobs\/([^/?]+)/)
  return m ? m[1] : input
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  try {
    const xml = await fetchFeed(ALL_JOBS_FEED)
    const items = parseItems(xml)
    const match = items.find((i) => i.card.id === id)
    if (!match) {
      writeError(
        "Job not found (We Work Remotely's feed only serves the current ~99 live postings)",
        "NOT_FOUND",
      )
      return 1
    }
    const job = { ...match.card, description: parseDescription(match.chunk) }

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.category || "—"} · ${job.type || "—"} · ${job.region || "—"}`,
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

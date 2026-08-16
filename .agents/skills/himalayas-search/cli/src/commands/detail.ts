import { fetchJobs, toJobDetail, writeError, type HimalayasRaw } from "../helpers.js"

export interface DetailOpts {
  id: string
  pages: number
  format: "json" | "plain"
}

/** Accept a raw "<companySlug>/<jobSlug>" id or a full himalayas.app job URL. */
function normalizeId(input: string): string {
  const m = input.match(/\/companies\/([^/]+)\/jobs\/([^/?]+)/)
  return m ? `${m[1]}/${m[2]}` : input
}

function idOf(raw: HimalayasRaw): string {
  const m = (raw.guid || "").match(/\/companies\/([^/]+)\/jobs\/([^/?]+)/)
  return m ? `${m[1]}/${m[2]}` : ""
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  try {
    const raw = await fetchJobs(opts.pages)
    const match = raw.find((j) => idOf(j) === id)
    if (!match) {
      writeError(
        `Job not found within the first ${opts.pages * 20} live postings scanned. Try a larger --pages, or pass the id straight from a recent "search" call.`,
        "NOT_FOUND",
      )
      return 1
    }
    const job = toJobDetail(match)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location}${job.salary ? " · " + job.salary : ""}`,
        job.categories.length ? `Categories: ${job.categories.join(", ")}` : "",
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

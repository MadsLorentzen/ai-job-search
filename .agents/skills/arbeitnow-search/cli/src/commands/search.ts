import {
  fetchPage,
  mapJob,
  matchesFilters,
  writeError,
  MAX_PAGES,
  type FilterOpts,
  type JobResult,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  remote?: boolean
  jobage?: number
  page: number
  pages: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(jobs: JobResult[]): string {
  if (jobs.length === 0) return "No results."
  const header =
    "ID".padEnd(44) + " " + "TITLE".padEnd(44) + " " + "COMPANY".padEnd(24) + " " + "LOCATION".padEnd(16) + " " + "REMOTE".padEnd(6) + " DATE"
  const rows = jobs.map((j) => {
    const id = j.id.slice(0, 44).padEnd(44)
    const title = j.title.slice(0, 44).padEnd(44)
    const company = (j.company || "—").slice(0, 24).padEnd(24)
    const loc = (j.location || "—").slice(0, 16).padEnd(16)
    const remote = (j.remote ? "yes" : "no").padEnd(6)
    return `${id} ${title} ${company} ${loc} ${remote} ${j.date || "—"}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const filters: FilterOpts = {
      query: opts.query,
      location: opts.location,
      remote: opts.remote,
      jobageDays: opts.jobage,
    }
    const jobs: JobResult[] = []
    let scanned = 0
    const lastPage = Math.min(opts.page + opts.pages - 1, opts.page + MAX_PAGES - 1)

    for (let p = opts.page; p <= lastPage; p++) {
      const data = await fetchPage(p)
      const raws = data.data ?? []
      scanned += raws.length
      for (const raw of raws) {
        if (matchesFilters(raw, filters)) jobs.push(mapJob(raw))
        if (opts.limit !== undefined && jobs.length >= opts.limit) break
      }
      if (opts.limit !== undefined && jobs.length >= opts.limit) break
      if (!data.links?.next) break
    }

    const out = opts.limit !== undefined ? jobs.slice(0, opts.limit) : jobs

    if (opts.format === "table") {
      process.stdout.write(renderTable(out) + `\n\nMatches: ${out.length} (scanned ${scanned} jobs)\n`)
    } else if (opts.format === "plain") {
      process.stdout.write(
        out
          .map(
            (j) =>
              `${j.title}\n  ${j.company || "—"} · ${j.location || "—"} · ${j.date || "—"}${j.remote ? " · remote" : ""}\n  id: ${j.id}\n  ${j.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: out.length, page: opts.page, scanned }, results: out }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}

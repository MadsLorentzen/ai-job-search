import { fetchJobs, matchesQuery, matchesLocation, toJobCard, writeError, type JobCard } from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  pages: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 38).padEnd(38)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const loc = c.location.slice(0, 20).padEnd(20)
    const salary = (c.salary || "—").slice(0, 20)
    return `${c.id.slice(0, 30).padEnd(30)} ${title} ${company} ${loc} ${salary}`
  })
  const header =
    "ID".padEnd(30) + " " + "TITLE".padEnd(38) + " " + "COMPANY".padEnd(22) + " " + "LOCATION".padEnd(20) + " SALARY"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const raw = await fetchJobs(opts.pages)
    const filtered = raw.filter(
      (j) => (!opts.query || matchesQuery(j, opts.query)) && (!opts.location || matchesLocation(j, opts.location)),
    )
    let cards = filtered.map(toJobCard)
    if (opts.limit && opts.limit > 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map((c) => {
            const salary = c.salary ? ` · ${c.salary}` : ""
            return `${c.title}\n  ${c.company || "—"} · ${c.location}${salary}\n  id: ${c.id}\n  ${c.url}`
          })
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length, scannedPages: opts.pages }, results: cards }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}

import { fetchJobs, matchesQuery, matchesLocation, toJobCard, writeError, type JobCard } from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 42).padEnd(42)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const loc = (c.location || "Remote").slice(0, 20).padEnd(20)
    const date = (c.date || "—").slice(0, 10)
    return `${c.id.padEnd(10)} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(10) + " " + "TITLE".padEnd(42) + " " + "COMPANY".padEnd(24) + " " + "LOCATION".padEnd(20) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const raw = await fetchJobs()
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
            const salary = c.salaryMin || c.salaryMax ? ` · $${c.salaryMin ?? "?"}-${c.salaryMax ?? "?"}` : ""
            return `${c.title}\n  ${c.company || "—"} · ${c.location || "Remote"}${salary}\n  id: ${c.id}\n  ${c.url}`
          })
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(JSON.stringify({ meta: { count: cards.length }, results: cards }, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}

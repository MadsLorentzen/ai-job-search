import {
  textFetch,
  parseFeed,
  matchesQuery,
  matchesRegion,
  daysSince,
  feedUrlForCategory,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  category?: string
  region?: string
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

const PAGE_SIZE = 20

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const region = (c.region || "—").slice(0, 22).padEnd(22)
    const date = c.date ? new Date(c.date).toISOString().slice(0, 10) : "—"
    return `${c.id.slice(0, 10).padEnd(10)} ${title} ${company} ${region} ${date}`
  })
  const header =
    "ID".padEnd(10) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(22) + " " + "REGION".padEnd(22) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const xml = await textFetch(feedUrlForCategory(opts.category))
    const cards = parseFeed(xml)
    let results = cards.filter(
      (c) => matchesQuery(c, opts.query) && matchesRegion(c, opts.region) && daysSince(c.date) <= opts.jobage,
    )

    const start = (opts.page - 1) * PAGE_SIZE
    results = results.slice(start, start + PAGE_SIZE)
    if (opts.limit !== undefined && opts.limit >= 0) results = results.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        results
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.region || "—"} · ${c.category || "—"}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: results.length, page: opts.page }, results }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}

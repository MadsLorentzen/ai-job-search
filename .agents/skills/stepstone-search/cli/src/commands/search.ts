import { buildSearchUrl, htmlFetch, parseSearchResults, writeError, type JobCard } from "../helpers.js"

export interface SearchOpts {
  query: string
  location?: string
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function filterByAge(cards: JobCard[], jobage: number): JobCard[] {
  if (!jobage || jobage >= 9999) return cards
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - jobage)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  // Keep undated results (relative timestamp didn't parse) rather than silently
  // dropping them — we cannot prove they're stale.
  return cards.filter((c) => c.date === null || c.date >= cutoffStr)
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 42).padEnd(42)
    const company = (c.company || "—").slice(0, 26).padEnd(26)
    const loc = (c.location || "—").slice(0, 24).padEnd(24)
    const date = c.date || "—"
    return `${c.id.padEnd(11)} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(11) + " " + "TITLE".padEnd(42) + " " + "COMPANY".padEnd(26) + " " + "LOCATION".padEnd(24) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  if (opts.page > 1) {
    writeError(
      "stepstone.de's robots.txt only allows a bare ?q= query string on /jobs/ paths " +
        "(no &page=); pagination beyond page 1 is not accessible without violating it.",
      "PAGINATION_UNSUPPORTED",
    )
    return 1
  }
  try {
    const html = await htmlFetch(buildSearchUrl(opts.query, opts.location))
    const { total, results } = parseSearchResults(html)
    let cards = filterByAge(results, opts.jobage)
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length, page: opts.page, total }, results: cards }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}

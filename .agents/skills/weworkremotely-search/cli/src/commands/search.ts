import {
  feedUrl,
  textFetch,
  parseFeed,
  matchesQuery,
  matchesRegion,
  withinJobAge,
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

const PAGE_SIZE = 25

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "ID".padEnd(40) +
    " " +
    "TITLE".padEnd(38) +
    " " +
    "COMPANY".padEnd(20) +
    " " +
    "REGION".padEnd(22) +
    " DATE"
  const rows = cards.map((c) => {
    const id = (c.id || "").slice(0, 40).padEnd(40)
    const title = (c.title || "").slice(0, 38).padEnd(38)
    const company = (c.company || "—").slice(0, 20).padEnd(20)
    const loc = (c.region || c.location || "—").slice(0, 22).padEnd(22)
    const date = (c.date || "—").slice(0, 10)
    return `${id} ${title} ${company} ${loc} ${date}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    // Choosing a category feed is the one genuinely server-side filter here.
    const url = feedUrl(opts.category)
    const xml = await textFetch(url)
    if (!xml) {
      writeError(`no feed returned for ${url}`, "NOT_FOUND")
      return 1
    }

    const now = Date.now()
    const parsed = parseFeed(xml)
    const all = parsed.filter(
      (c) =>
        matchesQuery(c, opts.query) &&
        matchesRegion(c, opts.region) &&
        withinJobAge(c, opts.jobage, now),
    )

    all.sort((a, b) => {
      const ta = a.date ? Date.parse(a.date) : 0
      const tb = b.date ? Date.parse(b.date) : 0
      return tb - ta
    })

    // --limit sets the page SIZE rather than trimming inside a fixed 25-row page.
    // Applied after a fixed slice it silently capped every result set at 25, so a
    // larger -n looked like the true total instead of a truncated view.
    const pageSize = opts.limit !== undefined && opts.limit > 0 ? opts.limit : PAGE_SIZE
    const start = Math.max(0, (opts.page - 1) * pageSize)
    const results = all.slice(start, start + pageSize)

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        (results.length === 0
          ? "No results."
          : results
              .map(
                (c) =>
                  `${c.title}\n  ${c.company || "—"} · ${c.region || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
              )
              .join("\n\n")) + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: results.length,
              page: opts.page,
              matchedTotal: all.length,
              // The RSS feed is a fixed-size window, not a paginated corpus.
              feedSize: parsed.length,
              feed: url,
              categoryFilteredServerSide: !!opts.category,
              source: "We Work Remotely",
            },
            results,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}

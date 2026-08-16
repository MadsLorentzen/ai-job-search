import {
  ALL_JOBS_FEED,
  CATEGORY_FEEDS,
  fetchFeed,
  matchesQuery,
  parseItems,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  category?: string
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const cat = (c.category || "—").slice(0, 22).padEnd(22)
    const type = (c.type || "—").slice(0, 10)
    return `${c.id.slice(0, 28).padEnd(28)} ${title} ${company} ${cat} ${type}`
  })
  const header =
    "ID".padEnd(28) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(24) + " " + "CATEGORY".padEnd(22) + " TYPE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    let feedUrl = ALL_JOBS_FEED
    if (opts.category) {
      const known = CATEGORY_FEEDS[opts.category]
      if (!known) {
        writeError(
          `Unknown --category "${opts.category}". Known: ${Object.keys(CATEGORY_FEEDS).join(", ")}`,
          "BAD_CATEGORY",
        )
        return 1
      }
      feedUrl = known
    }

    const xml = await fetchFeed(feedUrl)
    const items = parseItems(xml)
    const filtered = opts.query ? items.filter((i) => matchesQuery(i.card, i.chunk, opts.query!)) : items
    let cards = filtered.map((i) => i.card)
    if (opts.limit && opts.limit > 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.category || "—"} · ${c.type || "—"}\n  id: ${c.id}\n  ${c.url}`,
          )
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

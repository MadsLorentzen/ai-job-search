import {
  SEARCH_URL,
  htmlFetch,
  parseJobCards,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  location?: string
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  params.set("q", opts.query)
  if (opts.location) params.set("l", opts.location)
  if (opts.jobage && opts.jobage < 9999 && opts.jobage <= 30) {
    const pubdate = opts.jobage <= 1 ? "1" : opts.jobage <= 3 ? "3" : opts.jobage <= 7 ? "7" : opts.jobage <= 15 ? "15" : "30"
    params.set("fecha", pubdate)
  }
  if (opts.page > 1) params.set("pag", String(opts.page))
  return `${SEARCH_URL}?${params.toString()}`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 38).padEnd(38)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const loc = (c.location || "—").slice(0, 20).padEnd(20)
    const salary = (c.salary || "—").slice(0, 16).padEnd(16)
    const date = c.date || "—"
    return `${c.id.slice(0, 10).padEnd(10)} ${title} ${company} ${loc} ${salary} ${date}`
  })
  const header =
    "ID".padEnd(10) +
    " TITLE" + " ".repeat(33) +
    " COMPANY" + " ".repeat(15) +
    " LOCATION" + " ".repeat(12) +
    " SALARY" + " ".repeat(10) +
    " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const html = await htmlFetch(buildUrl(opts))
    let cards = parseJobCards(html)
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.salary || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          { meta: { count: cards.length, page: opts.page }, results: cards },
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

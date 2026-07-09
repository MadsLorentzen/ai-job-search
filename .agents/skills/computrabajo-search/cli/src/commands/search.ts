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
  if (opts.jobage && opts.jobage < 9999) {
    if (opts.jobage <= 1) params.set("pubdate", "1")
    else if (opts.jobage <= 3) params.set("pubdate", "3")
    else if (opts.jobage <= 7) params.set("pubdate", "7")
    else if (opts.jobage <= 15) params.set("pubdate", "15")
    else if (opts.jobage <= 30) params.set("pubdate", "30")
  }
  if (opts.page > 1) params.set("pag", String(opts.page))
  return `${SEARCH_URL}?${params.toString()}`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    const salary = (c.salary || "—").slice(0, 18).padEnd(18)
    const date = c.date || "—"
    return `${c.id.slice(0, 8).padEnd(8)} ${title} ${company} ${loc} ${salary} ${date}`
  })
  const header =
    "ID".padEnd(8) +
    " TITLE" + " ".repeat(35) +
    " COMPANY" + " ".repeat(17) +
    " LOCATION" + " ".repeat(14) +
    " SALARY" + " ".repeat(12) +
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

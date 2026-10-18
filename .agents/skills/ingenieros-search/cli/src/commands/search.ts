import {
  CliError,
  LIST_URL,
  filterCards,
  htmlFetch,
  parseJobCards,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 44).padEnd(44)
    const company = (c.company || "—").slice(0, 26).padEnd(26)
    const loc = (c.location || "—").slice(0, 20).padEnd(20)
    return `${c.id.padEnd(6)} ${title} ${company} ${loc} ${c.date || "—"}`
  })
  const header =
    "ID".padEnd(6) + " " + "TITLE".padEnd(44) + " " + "COMPANY".padEnd(26) + " " + "LOCATION".padEnd(20) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    // The board exposes one page: its latest offers. Asking for another page
    // is an error, not an empty result, so a loop over pages terminates loudly.
    if (opts.page > 1) {
      writeError(
        "Ingenieros.es exposes a single listing of its latest offers; only --page 1 exists",
        "BAD_ARG",
      )
      return 1
    }
    const html = await htmlFetch(LIST_URL)
    const listed = parseJobCards(html)
    if (listed.length === 0 && !/bolsa-ultimas/i.test(html)) {
      throw new CliError(
        "Ingenieros.es returned no latest-offers section; the layout may have changed",
        "PARSE_FAILED",
      )
    }
    let cards = filterCards(listed, opts)
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map((c) => `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`)
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          { meta: { count: cards.length, page: opts.page, listed: listed.length }, results: cards },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), e instanceof CliError ? e.code : "SEARCH_FAILED")
    return 1
  }
}

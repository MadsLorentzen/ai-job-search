import {
  BASE_URL,
  htmlFetch,
  parseJobCards,
  citySlug,
  withinJobAge,
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

function buildUrl(opts: SearchOpts): string {
  const segments: string[] = ["jobs"]
  if (opts.query) segments.push("q-" + encodeURIComponent(opts.query.trim()))
  if (opts.location) segments.push("ci-" + citySlug(opts.location))
  return `${BASE_URL}/${segments.join("/")}/`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 26).padEnd(26)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    const date = (c.date ? c.date.slice(0, 10) : "—").padEnd(10)
    return `${title} ${company} ${loc} ${date} ${c.id}`
  })
  const header =
    "TITLE".padEnd(40) +
    " " +
    "COMPANY".padEnd(26) +
    " " +
    "LOCATION".padEnd(22) +
    " " +
    "DATE".padEnd(10) +
    " ID"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const html = await htmlFetch(buildUrl(opts))
    let cards = parseJobCards(html)
    cards = withinJobAge(cards, opts.jobage)
    if (opts.limit && opts.limit > 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.employmentType || "—"} · ${c.date ? c.date.slice(0, 10) : "—"}\n  id: ${c.id}\n  ${c.url}`,
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

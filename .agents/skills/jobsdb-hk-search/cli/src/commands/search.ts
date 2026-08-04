import {
  BASE_URL,
  htmlFetch,
  parseJobCards,
  slugifyQuery,
  slugifyLocation,
  jobageToDateRange,
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
  const slug = slugifyQuery(opts.query)
  const parts: string[] = [BASE_URL, `${slug}-jobs`]
  if (opts.location) {
    parts.push(slugifyLocation(opts.location))
  }
  const url = parts.join("/")
  const params = new URLSearchParams()
  const range = jobageToDateRange(opts.jobage)
  if (range) params.set("daterange", String(range))
  if (opts.page > 1) params.set("page", String(opts.page))
  const query = params.toString()
  return query ? `${url}?${query}` : url
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 30).padEnd(30)
    const loc = (c.location || "—").slice(0, 24).padEnd(24)
    const date = (c.date || "").replace("Listed ", "").slice(0, 20).padEnd(20)
    return `${c.id.padEnd(10)} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(10) +
    " " +
    "TITLE".padEnd(40) +
    " " +
    "COMPANY".padEnd(30) +
    " " +
    "LOCATION".padEnd(24) +
    " POSTED"
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
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
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

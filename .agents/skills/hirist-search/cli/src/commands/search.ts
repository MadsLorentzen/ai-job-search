import {
  SEARCH_URL,
  jsonFetch,
  resolveLocation,
  knownLocations,
  toCard,
  writeError,
  type JobCard,
  type RawJob,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  location?: string
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

interface SearchResponse {
  data?: RawJob[]
  totalJobs?: number
  totalPages?: number
  hasMore?: boolean
}

function buildUrl(opts: SearchOpts): string | { error: string; code: string } {
  const params = new URLSearchParams()
  params.set("query", opts.query)
  params.set("pageNo", String(opts.page - 1)) // API page is 0-indexed
  if (opts.location) {
    const id = resolveLocation(opts.location)
    if (id === null) {
      return {
        error: `unknown location "${opts.location}". Known: ${knownLocations().slice(0, 20).join(", ")}, …`,
        code: "BAD_LOCATION",
      }
    }
    params.set("loc", String(id))
  }
  if (opts.jobage && opts.jobage > 0 && opts.jobage < 9999) {
    params.set("posting", String(opts.jobage))
  }
  return `${SEARCH_URL}?${params.toString()}`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const id = c.id.padEnd(9)
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    const date = c.date || "—"
    return `${id} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(9) +
    " " +
    "TITLE".padEnd(40) +
    " " +
    "COMPANY".padEnd(24) +
    " " +
    "LOCATION".padEnd(22) +
    " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const built = buildUrl(opts)
  if (typeof built !== "string") {
    writeError(built.error, built.code)
    return 1
  }
  try {
    const res = await jsonFetch<SearchResponse>(built)
    let cards = (res?.data ?? []).map(toCard)
    if (opts.limit && opts.limit > 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.experience || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
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

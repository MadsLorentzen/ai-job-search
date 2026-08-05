import {
  API_BASE,
  jsonFetch,
  parseJobs,
  matchesQuery,
  withinJobAge,
  normalizeLocation,
  writeError,
  type JobCard,
  type MuseSearchResponse,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  category?: string
  level?: string
  company?: string
  jobage: number
  page: number
  pages: number
  limit?: number
  format: "json" | "table" | "plain"
}

/** The Muse pages are 0-indexed; the CLI contract exposes 1-indexed `--page`. */
export function buildUrl(opts: SearchOpts, apiPage: number): string {
  const params = new URLSearchParams()
  params.set("page", String(apiPage))
  if (opts.location) params.set("location", normalizeLocation(opts.location))
  if (opts.category) params.set("category", opts.category)
  if (opts.level) params.set("level", opts.level)
  if (opts.company) params.set("company", opts.company)
  params.set("descending", "true")
  return `${API_BASE}?${params.toString()}`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "ID".padEnd(10) +
    " " +
    "TITLE".padEnd(44) +
    " " +
    "COMPANY".padEnd(24) +
    " " +
    "LOCATION".padEnd(26) +
    " DATE"
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 44).padEnd(44)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const loc = (c.location || "—").slice(0, 26).padEnd(26)
    const date = (c.date || "—").slice(0, 10)
    return `${c.id.padEnd(10)} ${title} ${company} ${loc} ${date}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const startPage = opts.page - 1
    // A --query is filtered client-side, so sweep several pages to give it
    // something to bite on. Without a query one page is the honest page size.
    const sweep = opts.query ? Math.max(1, Math.min(opts.pages, 10)) : 1
    const now = Date.now()

    const collected: JobCard[] = []
    let apiTotal: number | null = null
    let pagesFetched = 0
    let truncated = false

    for (let i = 0; i < sweep; i++) {
      const response = await jsonFetch<MuseSearchResponse>(buildUrl(opts, startPage + i))
      if (!response) break
      pagesFetched++
      if (apiTotal === null && typeof response.total === "number") apiTotal = response.total

      const page = parseJobs(response)
      for (const card of page) {
        if (!matchesQuery(card, opts.query)) continue
        if (!withinJobAge(card, opts.jobage, now)) continue
        collected.push(card)
      }

      const pageCount = typeof response.page_count === "number" ? response.page_count : null
      if (pageCount !== null && startPage + i + 1 >= pageCount) break
      if (page.length === 0) break
      if (opts.limit !== undefined && collected.length >= opts.limit) {
        truncated = i < sweep - 1
        break
      }
    }

    let results = collected
    if (opts.limit !== undefined && opts.limit >= 0) results = results.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        (results.length === 0
          ? "No results."
          : results
              .map(
                (c) =>
                  `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
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
              pagesFetched,
              apiTotal,
              // Surfaced so a caller can tell "nothing matched" from "we stopped early".
              queryFilteredClientSide: !!opts.query,
              truncated,
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

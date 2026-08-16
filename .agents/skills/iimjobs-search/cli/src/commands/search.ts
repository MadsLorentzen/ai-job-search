import {
  SEARCH_URL,
  jsonFetch,
  parseSearch,
  resolveLocation,
  writeError,
  type JobCard,
  type SearchResponse,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage: number
  minExp?: number
  maxExp?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function buildUrl(opts: SearchOpts): { url: string; locError?: string } {
  const params = new URLSearchParams()
  if (opts.query) params.set("query", opts.query)
  // API pages are 0-indexed; the CLI exposes 1-indexed --page.
  params.set("page", String(Math.max(0, opts.page - 1)))
  if (opts.location) {
    const loc = resolveLocation(opts.location)
    if (loc === null) {
      return { url: "", locError: `unknown location "${opts.location}"` }
    }
    params.set("loc", String(loc))
  }
  if (opts.jobage > 0 && opts.jobage < 9999) params.set("posting", String(opts.jobage))
  if (opts.minExp !== undefined) params.set("minexp", String(opts.minExp))
  if (opts.maxExp !== undefined) params.set("maxexp", String(opts.maxExp))
  return { url: `${SEARCH_URL}?${params.toString()}` }
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 44).padEnd(44)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const loc = (c.location || "—").slice(0, 20).padEnd(20)
    const exp =
      c.minExp !== null || c.maxExp !== null
        ? `${c.minExp ?? "?"}-${c.maxExp ?? "?"}y`.padEnd(8)
        : "—".padEnd(8)
    const date = c.date || "—"
    return `${c.id.padEnd(9)} ${title} ${company} ${loc} ${exp} ${date}`
  })
  const header =
    "ID".padEnd(9) +
    " " +
    "TITLE".padEnd(44) +
    " " +
    "COMPANY".padEnd(24) +
    " " +
    "LOCATION".padEnd(20) +
    " " +
    "EXP".padEnd(8) +
    " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const { url, locError } = buildUrl(opts)
  if (locError) {
    writeError(locError, "BAD_LOCATION")
    return 1
  }
  try {
    const resp = await jsonFetch<SearchResponse>(url)
    let cards = resp ? parseSearch(resp) : []
    if (opts.limit && opts.limit > 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${
                c.minExp !== null || c.maxExp !== null ? `${c.minExp ?? "?"}-${c.maxExp ?? "?"} yrs` : "—"
              } · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
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

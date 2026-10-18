import {
  CliError,
  SEARCH_PATH,
  apiFetch,
  jobageToSinceDate,
  parseSearchResponse,
  toProvinceKey,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  city?: string
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

/** Largest page the API documentation recommends. */
const MAX_RESULTS = 50
const DEFAULT_RESULTS = 20

export function buildParams(opts: SearchOpts): URLSearchParams {
  const params = new URLSearchParams()
  if (opts.query) params.set("q", opts.query)
  if (opts.location) params.set("province", toProvinceKey(opts.location))
  if (opts.city) params.set("city", opts.city)
  const since = jobageToSinceDate(opts.jobage)
  if (since) params.set("sinceDate", since)
  params.set("maxResults", String(Math.min(opts.limit ?? DEFAULT_RESULTS, MAX_RESULTS)))
  if (opts.page > 1) params.set("page", String(opts.page))
  return params
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 42).padEnd(42)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    return `${c.id.slice(0, 12).padEnd(12)} ${title} ${company} ${loc} ${c.date || "—"}`
  })
  const header =
    "ID".padEnd(12) + " " + "TITLE".padEnd(42) + " " + "COMPANY".padEnd(24) + " " + "LOCATION".padEnd(22) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const data = await apiFetch(SEARCH_PATH, buildParams(opts))
    if (data === null) throw new CliError("InfoJobs answered 404 for the search endpoint", "SEARCH_FAILED")
    const { cards: all, total, pages } = parseSearchResponse(data)
    let cards = all
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}${c.salary ? ` · ${c.salary}` : ""}\n  ${c.summary || ""}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length, page: opts.page, total, pages }, results: cards }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), e instanceof CliError ? e.code : "SEARCH_FAILED")
    return 1
  }
}

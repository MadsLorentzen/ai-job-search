import {
  API_BASE,
  jsonFetch,
  parseJobs,
  clampDatePosted,
  writeError,
  type Credentials,
  type JobCard,
  type UsaJobsResponse,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  title?: string
  location?: string
  organization?: string
  remote?: boolean
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

/**
 * Build the search URL. Unlike every other portal here, USAJOBS filters
 * server-side across the board — keyword, title, location, remote and recency
 * are all real API parameters.
 */
export function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  if (opts.query) params.set("Keyword", opts.query)
  if (opts.title) params.set("PositionTitle", opts.title)
  if (opts.location) params.set("LocationName", opts.location)
  if (opts.organization) params.set("Organization", opts.organization)
  if (opts.remote !== undefined) params.set("RemoteIndicator", opts.remote ? "True" : "False")

  const days = clampDatePosted(opts.jobage)
  if (days !== null) params.set("DatePosted", String(days))

  // Public = roles US citizens can apply for. "All"/"Status" need extra
  // authorization that a standard key does not carry.
  params.set("WhoMayApply", "Public")
  params.set("ResultsPerPage", String(Math.min(opts.limit ?? 25, 500)))
  params.set("Page", String(opts.page))
  params.set("SortField", "opendate")
  params.set("SortDirection", "Desc")
  return `${API_BASE}?${params.toString()}`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "ID".padEnd(11) +
    " " +
    "TITLE".padEnd(38) +
    " " +
    "AGENCY".padEnd(26) +
    " " +
    "LOCATION".padEnd(24) +
    " DATE"
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 38).padEnd(38)
    const company = (c.company || "—").slice(0, 26).padEnd(26)
    const loc = (c.location || "—").slice(0, 24).padEnd(24)
    const date = (c.date || "—").slice(0, 10)
    return `${c.id.slice(0, 11).padEnd(11)} ${title} ${company} ${loc} ${date}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts, creds: Credentials): Promise<number> {
  try {
    const response = await jsonFetch<UsaJobsResponse>(buildUrl(opts), creds)
    if (!response) {
      writeError("USAJOBS returned no result set", "NOT_FOUND")
      return 1
    }

    let results = parseJobs(response)
    if (opts.limit !== undefined && opts.limit >= 0) results = results.slice(0, opts.limit)

    const total = response.SearchResult?.SearchResultCountAll ?? null

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        (results.length === 0
          ? "No results."
          : results
              .map(
                (c) =>
                  `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  ${c.salary || "salary n/a"}${c.grade ? ` · ${c.grade}` : ""}\n  id: ${c.id}${c.positionId ? ` (announcement ${c.positionId})` : ""}\n  ${c.url}`,
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
              apiTotal: total,
              allFiltersServerSide: true,
              source: "USAJOBS",
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

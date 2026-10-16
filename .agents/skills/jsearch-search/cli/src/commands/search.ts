import {
  SEARCH_URL,
  apiFetch,
  cursorOf,
  dataOf,
  filterByAge,
  jobageToDatePosted,
  readToken,
  toResult,
  type JobResult,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  location?: string
  country?: string
  jobage?: number
  remote?: boolean
  excludePublishers?: string // comma-separated, e.g. "LinkedIn"
  cursor?: string
  limit?: number
  format: "json" | "table" | "plain"
}

export function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  // JSearch takes the place inside the free-text query ("data engineer in Dublin").
  params.set("query", opts.location ? `${opts.query} in ${opts.location}` : opts.query)
  params.set("num_pages", "1") // one billed page per call
  if (opts.cursor) params.set("cursor", opts.cursor) // search-v2 pages by cursor, not page number
  params.set("date_posted", jobageToDatePosted(opts.jobage))
  if (opts.country) params.set("country", opts.country.toLowerCase())
  if (opts.remote) params.set("work_from_home", "true")
  if (opts.excludePublishers) params.set("exclude_job_publishers", opts.excludePublishers)
  return `${SEARCH_URL}?${params.toString()}`
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const header =
    "TITLE".padEnd(40) + " " + "COMPANY".padEnd(24) + " " + "LOCATION".padEnd(20) + " " + "DATE".padEnd(10) + " SOURCE"
  const body = rows.map(
    (r) =>
      `${r.title.slice(0, 40).padEnd(40)} ${(r.company || "—").slice(0, 24).padEnd(24)} ${(r.location || "—").slice(0, 20).padEnd(20)} ${(r.date || "—").padEnd(10)} ${r.publisher || "—"}`,
  )
  return [header, "-".repeat(header.length), ...body].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const token = readToken()
  const body = await apiFetch(buildUrl(opts), token)
  const next = cursorOf(body)
  let rows = dataOf(body)
    .map(toResult)
    .filter((r): r is JobResult => r !== null)
  rows = filterByAge(rows, opts.jobage)
  if (opts.limit !== undefined) rows = rows.slice(0, opts.limit)

  if (opts.format === "table") {
    process.stdout.write(renderTable(rows) + "\n")
  } else if (opts.format === "plain") {
    process.stdout.write(
      rows
        .map(
          (r) =>
            `${r.title}\n  ${r.company || "—"} · ${r.location || "—"} · ${r.date || "—"} · via ${r.publisher || "—"}\n  id: ${r.id}\n  ${r.url || "—"}`,
        )
        .join("\n\n") + "\n",
    )
  } else {
    process.stdout.write(JSON.stringify({ meta: { count: rows.length, page: opts.cursor ? null : 1, nextCursor: next }, results: rows }, null, 2) + "\n")
  }
  return 0
}

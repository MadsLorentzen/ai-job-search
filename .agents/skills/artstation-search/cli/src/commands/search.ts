import { apiGet, toResult, withinJobAge, writeError, type ArtStationJob, type JobResult } from "../helpers.js"

const SEARCH_PATH = "/jobs.json"

export interface SearchOpts {
  query?: string
  jobage: number
  page: number
  limit: number
  format: "json" | "table" | "plain"
}

interface SearchResponse {
  total_count: number
  data: ArtStationJob[]
}

function buildQuery(opts: SearchOpts): URLSearchParams {
  const p = new URLSearchParams()
  if (opts.query) p.set("query", opts.query)
  // The API rejects per_page < 3, so we always ask for at least 3 and trim
  // client-side to the user's --limit afterward.
  p.set("per_page", String(Math.max(3, opts.limit)))
  p.set("page", String(opts.page))
  return p
}

function shortDate(date: string | null): string {
  return date ? date.slice(0, 10) : "—"
}

interface Column {
  header: string
  width: number
  cell: (r: JobResult) => string
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const columns: Column[] = [
    { header: "ID", width: Math.max(4, ...rows.map((r) => r.id.length)), cell: (r) => r.id },
    { header: "TITLE", width: 38, cell: (r) => r.title },
    { header: "COMPANY", width: 22, cell: (r) => r.company ?? "—" },
    { header: "LOCATION", width: 24, cell: (r) => r.location ?? (r.remote ? "Remote" : "—") },
    { header: "DATE", width: 10, cell: (r) => shortDate(r.date) },
  ]
  const row = (cells: string[]) =>
    cells.map((c, i) => c.slice(0, columns[i].width).padEnd(columns[i].width)).join("  ")
  const header = row(columns.map((c) => c.header))
  const body = rows.map((r) => row(columns.map((c) => c.cell(r))))
  return [header, "-".repeat(header.length), ...body].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const block = (r: JobResult) =>
    [
      r.title,
      `  ${r.company ?? "—"} · ${r.location ?? (r.remote ? "Remote" : "—")} · ${shortDate(r.date)}`,
      `  id: ${r.id}`,
      `  ${r.url}`,
    ].join("\n")
  return rows.map(block).join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const res = await apiGet<SearchResponse>(`${SEARCH_PATH}?${buildQuery(opts).toString()}`)
    if (!res) {
      writeError("ArtStation jobs search endpoint not found", "SEARCH_FAILED")
      return 1
    }
    let rows = (res.data ?? []).map(toResult).filter((r) => withinJobAge(r.date, opts.jobage))
    if (opts.limit >= 0) rows = rows.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          { meta: { count: rows.length, page: opts.page, total: res.total_count }, results: rows },
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

import { typesenseSearch, toResult, writeError, type HitmarkerJob, type JobResult } from "../helpers.js"

export interface SearchOpts {
  query?: string
  jobage: number
  page: number
  limit: number
  format: "json" | "table" | "plain"
}

const QUERY_BY = "title,jobDescription,jobCompany.title,jobTags.title"

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
    let filterBy: string | undefined
    if (opts.jobage > 0 && opts.jobage < 9999) {
      const cutoff = Math.floor(Date.now() / 1000) - opts.jobage * 86400
      filterBy = `postDate:>${cutoff}`
    }
    const result = await typesenseSearch<HitmarkerJob>({
      q: opts.query || "*",
      query_by: QUERY_BY,
      page: opts.page,
      per_page: Math.max(1, opts.limit),
      // Only force newest-first when browsing with no keyword (q: "*", where
      // every doc matches equally and relevance rank is meaningless). A real
      // keyword query keeps Typesense's default text-match relevance sort —
      // overriding it to postDate:desc surfaces the newest posting of *any*
      // kind ahead of the best textual match, which defeats the search.
      sort_by: opts.query ? undefined : "postDate:desc",
      filter_by: filterBy,
    })
    const rows = result.hits.map((h) => toResult(h.document))

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          { meta: { count: rows.length, page: result.page, total: result.found }, results: rows },
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

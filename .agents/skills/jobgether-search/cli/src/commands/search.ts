import {
  apiGet,
  toResult,
  writeError,
  ApiError,
  type SearchEnvelope,
  type JobResult,
} from "../helpers.js"

const SEARCH_PATH = "/api/v1/jobs"

export interface SearchOpts {
  query?: string
  locations: string[]
  jobFunctions: string[]
  industries: string[]
  contractType: string[]
  experience: string[]
  remoteType?: string
  includeHybrid: boolean
  salaryMin?: number
  salaryMax?: number
  currency?: string
  sort?: string
  jobage: number
  page: number
  limit: number
  format: "json" | "table" | "plain"
}

function buildQuery(opts: SearchOpts): URLSearchParams {
  const p = new URLSearchParams()
  if (opts.query) p.set("keyword", opts.query)
  if (opts.locations.length) p.set("locations", opts.locations.join(","))
  if (opts.jobFunctions.length) p.set("jobReferences", opts.jobFunctions.join(","))
  if (opts.industries.length) p.set("industries", opts.industries.join(","))
  if (opts.contractType.length) p.set("contractType", opts.contractType.join(","))
  if (opts.experience.length) p.set("experience", opts.experience.join(","))
  if (opts.remoteType) p.set("remoteType", opts.remoteType)
  if (opts.includeHybrid) p.set("includeHybrid", "true")
  if (opts.salaryMin !== undefined) p.set("salaryMin", String(opts.salaryMin))
  if (opts.salaryMax !== undefined) p.set("salaryMax", String(opts.salaryMax))
  if (opts.currency) p.set("currency", opts.currency)
  if (opts.sort) p.set("sort", opts.sort)
  p.set("page", String(opts.page))
  p.set("limit", String(opts.limit))
  return p
}

function shortDate(date: string | null): string {
  return date ? date.slice(0, 10) : "—"
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const cols: Array<{ header: string; width: number; cell: (r: JobResult) => string }> = [
    { header: "ID", width: 24, cell: (r) => r.id },
    { header: "TITLE", width: 40, cell: (r) => r.title },
    { header: "COMPANY", width: 24, cell: (r) => r.company ?? "—" },
    { header: "LOCATION", width: 24, cell: (r) => r.location ?? "—" },
    { header: "DATE", width: 10, cell: (r) => shortDate(r.date) },
  ]
  const row = (cells: string[]) =>
    cells.map((c, i) => c.slice(0, cols[i].width).padEnd(cols[i].width)).join("  ")
  const header = row(cols.map((c) => c.header))
  const body = rows.map((r) => row(cols.map((c) => c.cell(r))))
  return [header, "-".repeat(header.length), ...body].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  return rows
    .map((r) =>
      [
        r.title,
        `  ${r.company ?? "—"} · ${r.location ?? "—"} · ${shortDate(r.date)}`,
        `  id: ${r.id}`,
        `  ${r.url}`,
      ].join("\n"),
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const env = await apiGet<SearchEnvelope>(`${SEARCH_PATH}?${buildQuery(opts).toString()}`)
    let jobs = env.jobs ?? []

    // No server-side "posted within N days" parameter exists (see url-reference.md),
    // so --jobage filters client-side, on this page's results only. It does not
    // reduce or re-fetch prior pages — combine with --sort date to see the freshest
    // postings first.
    if (opts.jobage < 9999) {
      const cutoff = Date.now() - opts.jobage * 86400000
      jobs = jobs.filter((j) => {
        const t = Date.parse(j.postedAt)
        return !Number.isNaN(t) && t >= cutoff
      })
    }

    const results = jobs.map(toResult)

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(results) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: { count: results.length, page: opts.page, hasMore: env.pagination?.hasMore ?? null },
            results,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    if (e instanceof ApiError) writeError(e.message, e.code)
    else writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}

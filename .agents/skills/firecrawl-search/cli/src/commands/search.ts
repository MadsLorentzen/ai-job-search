import {
  JOB_PROMPT,
  JOB_SCHEMA,
  MAX_SEARCH_RESULTS,
  apiPost,
  jobageToTbs,
  toResult,
  writeError,
  type JobResult,
  type SearchItem,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  jobage?: number
  page: number
  limit: number
  format: "json" | "table" | "plain"
  sites: string[] // includeDomains — restrict to these job boards
  excludeSites: string[] // excludeDomains — mutually exclusive with sites
  country?: string // ISO-3166 alpha-2, biases the search locale
  location?: string // geo-targeting string, e.g. "Germany"
  enrich: boolean // scrape each hit for company/location/date
}

interface SearchData {
  web?: SearchItem[]
}

export function buildPayload(opts: SearchOpts, wanted: number): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    query: opts.query,
    sources: ["web"],
    limit: wanted,
  }
  const tbs = jobageToTbs(opts.jobage)
  if (tbs) payload.tbs = tbs
  if (opts.country) payload.country = opts.country
  if (opts.location) payload.location = opts.location
  // The API rejects both filters together; the CLI validates first (see cli.ts).
  if (opts.sites.length) payload.includeDomains = opts.sites
  else if (opts.excludeSites.length) payload.excludeDomains = opts.excludeSites

  if (opts.enrich) {
    // Firecrawl scrapes each hit and extracts the job fields against JOB_SCHEMA,
    // which is what lets one skill cover every board: no markup anchors, so
    // nothing to re-learn when a site changes its HTML. It costs extra credits
    // per result, hence the --no-enrich escape hatch.
    payload.scrapeOptions = {
      onlyMainContent: true,
      formats: [{ type: "json", prompt: JOB_PROMPT, schema: JOB_SCHEMA }],
    }
  }
  return payload
}

// Table columns: header, width, and the cell value. The URL column is sized to the
// longest URL so it is never truncated - the URL is also the result's `id`, and a
// cut one cannot be looked up with `detail`; the rest truncate for scanning.
interface Column {
  header: string
  width: number
  cell: (r: JobResult) => string
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const columns: Column[] = [
    { header: "TITLE", width: 42, cell: (r) => r.title },
    { header: "COMPANY", width: 22, cell: (r) => r.company ?? "—" },
    { header: "LOCATION", width: 20, cell: (r) => r.location ?? "—" },
    { header: "DATE", width: 10, cell: (r) => r.date ?? "—" },
    { header: "URL", width: Math.max(3, ...rows.map((r) => r.url.length)), cell: (r) => r.url },
  ]
  const row = (cells: string[]) => cells.map((c, i) => c.slice(0, columns[i].width).padEnd(columns[i].width)).join("  ")

  const header = row(columns.map((c) => c.header))
  const body = rows.map((r) => row(columns.map((c) => c.cell(r))))
  return [header, "-".repeat(header.length), ...body].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const block = (r: JobResult) =>
    [
      r.title,
      `  ${r.company ?? "—"} · ${r.location ?? "—"} · ${r.date ?? "—"}`,
      `  ${r.url}`,
      r.snippet ? `  ${r.snippet}` : "",
    ]
      .filter((l) => l !== "")
      .join("\n")
  return rows.map(block).join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  // Firecrawl search has no offset parameter, so page N is served by asking for
  // page*limit results and returning the last window. Page 1 (the common case)
  // fetches exactly what it needs; deeper pages re-fetch the earlier ones.
  const wanted = opts.page * opts.limit
  if (wanted > MAX_SEARCH_RESULTS) {
    writeError(
      `--page ${opts.page} x --limit ${opts.limit} needs ${wanted} results, but Firecrawl search ` +
        `returns at most ${MAX_SEARCH_RESULTS} per query — narrow the query or lower --limit`,
      "BAD_ARG",
    )
    return 1
  }

  try {
    const envelope = await apiPost<SearchData>("/v2/search", buildPayload(opts, wanted))
    const items = envelope.data?.web ?? []
    // Items without a resolvable URL are dropped by toResult.
    const all = items.map(toResult).filter((r): r is JobResult => r !== null)
    const rows = all.slice((opts.page - 1) * opts.limit, wanted)

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: rows.length,
              page: opts.page,
              total: all.length,
              enriched: opts.enrich,
              credits_used: envelope.creditsUsed ?? null,
            },
            results: rows,
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

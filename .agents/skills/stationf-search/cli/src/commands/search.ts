import {
  algoliaQuery,
  cutoffDate,
  dedupe,
  timestamp,
  toResult,
  writeError,
  type JobResult,
  type WkHit,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  jobage: number
  page: number
  limit: number
  format: "json" | "table" | "plain"
  sort: "relevance" | "date"
  // Facet filters, already split into value lists (empty means unset).
  cities: string[]
  regions: string[]
  countries: string[]
  contracts: string[]
  remote: string[]
  departments: string[]
  companies: string[]
  languages: string[]
  // Escape hatch for the long tail of the facet vocabulary: attribute -> values.
  facets: Record<string, string[]>
}

/**
 * Algolia facetFilters: the outer array ANDs, each inner array ORs. So
 * `--location Paris,Lyon --contract cdi` means (Paris OR Lyon) AND CDI.
 */
export function buildFacetFilters(opts: SearchOpts): string[][] {
  const groups: Array<[string, string[]]> = [
    ["offices.city", opts.cities],
    ["offices.state", opts.regions],
    ["offices.country_code", opts.countries],
    ["contract_type", opts.contracts],
    ["remote", opts.remote],
    ["department", opts.departments],
    ["organization.slug", opts.companies],
    ["language", opts.languages],
    ...Object.entries(opts.facets),
  ]
  return groups
    .filter(([, values]) => values.length > 0)
    .map(([attribute, values]) => values.map((v) => `${attribute}:${v}`))
}

/**
 * How many hits to pull for one page of output. The board has no date-sorted
 * replica index, so `--jobage` and `--sort date` are applied client-side — that
 * only tells the truth if the window is wide enough to hold the recent tail, so
 * those modes widen it. The window is capped at Algolia's 1000-hit maximum.
 */
export function windowSize(opts: SearchOpts): number {
  const wide = opts.sort === "date" || (opts.jobage > 0 && opts.jobage < 9999)
  const size = wide ? Math.max(opts.limit * 5, 100) : Math.max(opts.limit * 3, 20)
  return Math.min(1000, size)
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
  if (rows.length === 0) return "Aucun résultat."
  const columns: Column[] = [
    { header: "TITRE", width: 38, cell: (r) => r.title },
    { header: "ENTREPRISE", width: 20, cell: (r) => r.company ?? "—" },
    { header: "LIEU", width: 18, cell: (r) => r.location ?? "—" },
    { header: "CONTRAT", width: 16, cell: (r) => r.contract ?? "—" },
    { header: "DATE", width: 10, cell: (r) => shortDate(r.date) },
    // Last, and sized to the longest value: an id truncated mid-slug cannot be
    // passed to `detail`, and these ids are long.
    { header: "ID", width: Math.max(2, ...rows.map((r) => r.id.length)), cell: (r) => r.id },
  ]
  const row = (cells: string[]) =>
    cells.map((c, i) => c.slice(0, columns[i].width).padEnd(columns[i].width)).join("  ")
  const header = row(columns.map((c) => c.header))
  return [header, "-".repeat(header.length), ...rows.map((r) => row(columns.map((c) => c.cell(r))))].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "Aucun résultat."
  return rows
    .map((r) =>
      [
        r.title,
        `  ${r.company ?? "—"} · ${r.location ?? "—"} · ${r.contract ?? "—"} · ${shortDate(r.date)}`,
        `  id: ${r.id}`,
        `  ${r.url}`,
      ].join("\n"),
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const length = windowSize(opts)
    const response = await algoliaQuery({
      query: opts.query ?? "",
      facetFilters: buildFacetFilters(opts),
      // offset/length (rather than page/hitsPerPage) keeps --page honest while
      // over-fetching: page 2 starts one --limit further in, so widening the
      // window never skips postings.
      offset: (opts.page - 1) * opts.limit,
      length,
      attributesToHighlight: [],
      attributesToSnippet: [],
    })

    const hits: WkHit[] = response.hits ?? []
    let rows = dedupe(hits.map(toResult).filter((r): r is JobResult => r !== null))

    if (opts.jobage > 0 && opts.jobage < 9999) {
      const cutoff = cutoffDate(opts.jobage)
      rows = rows.filter((r) => timestamp(r.date) >= cutoff)
    }
    if (opts.sort === "date") {
      rows = [...rows].sort((a, b) => timestamp(b.date) - timestamp(a.date))
    }
    const truncated = rows.length > opts.limit
    rows = rows.slice(0, opts.limit)

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
              total: response.nbHits ?? rows.length,
              // The client-side window matters for interpreting --jobage: a
              // filtered result set that filled the limit may have more behind it.
              window: length,
              truncated,
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

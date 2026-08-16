import {
  SEARCH_URL,
  jsonFetch,
  parseSearchPage,
  resolveLocation,
  resolveDomain,
  jobageToFreshness,
  writeError,
  type JobResult,
  type SearchResponse,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  domain?: string
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function buildFilters(opts: SearchOpts): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (opts.query) filters.keyword = opts.query
  const loc = resolveLocation(opts.location)
  if (loc) filters.locations = [loc]
  const dom = resolveDomain(opts.domain)
  if (dom) filters.domain = [dom]
  const fresh = jobageToFreshness(opts.jobage)
  if (fresh) filters.jobFreshness = [fresh]
  return filters
}

function fmtSalary(s: JobResult["salary"]): string {
  if (!s || (s.minValue == null && s.maxValue == null)) return "—"
  const lo = s.minValue != null ? `${s.minValue}` : "?"
  const hi = s.maxValue != null ? `${s.maxValue}` : "?"
  return `${lo}-${hi} LPA`
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const line = (c: JobResult) => {
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    const date = (c.date || "—").slice(0, 10)
    return `${c.id.padEnd(24)} ${title} ${company} ${loc} ${date}`
  }
  const header =
    "ID".padEnd(24) +
    " " +
    "TITLE".padEnd(40) +
    " " +
    "COMPANY".padEnd(24) +
    " " +
    "LOCATION".padEnd(22) +
    " DATE"
  return [header, "-".repeat(header.length), ...rows.map(line)].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  return rows
    .map(
      (c) =>
        `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${fmtSalary(c.salary)} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url || "(apply link unavailable)"}`,
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const filters = buildFilters(opts)
    const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 100) : 20

    let cursor: string | null = null
    let parsed = parseSearchPage(null)
    for (let p = 1; p <= opts.page; p++) {
      const data = await jsonFetch<SearchResponse>(SEARCH_URL, {
        filters,
        page: { limit, cursor },
      })
      parsed = parseSearchPage(data)
      if (p === opts.page) break
      if (!parsed.nextCursor) {
        parsed = { results: [], nextCursor: null, totalCount: parsed.totalCount }
        break
      }
      cursor = parsed.nextCursor
    }

    let results = parsed.results
    if (opts.limit && opts.limit > 0) results = results.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(results) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: results.length,
              page: opts.page,
              total: parsed.totalCount,
              hasMore: parsed.nextCursor != null,
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

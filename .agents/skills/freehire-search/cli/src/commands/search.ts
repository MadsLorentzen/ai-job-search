import { apiGet, toResult, writeError, type FreehireJob, type JobResult } from "../helpers.js"

export interface SearchOpts {
  query?: string
  jobage: number
  page: number
  limit: number
  format: "json" | "table" | "plain"
  // Facet filters (already parsed into value lists; empty means unset).
  regions: string[]
  countries: string[]
  cities: string[]
  seniority: string[]
  category: string[]
  skills: string[]
  company?: string
  workMode?: string // work_mode facet: remote | hybrid | onsite
  // Arbitrary facet escape hatch: param -> values, for the long tail of the vocabulary.
  facets: Record<string, string[]>
}

function buildQuery(opts: SearchOpts): URLSearchParams {
  const p = new URLSearchParams()
  if (opts.query) p.set("q", opts.query)
  p.set("limit", String(opts.limit))
  p.set("offset", String((opts.page - 1) * opts.limit))
  // Keyword search, matching the freehire web client (semantic index is opt-in).
  p.set("semantic_ratio", "0")
  if (opts.jobage > 0 && opts.jobage < 9999) p.set("posted_within_days", String(opts.jobage))
  if (opts.workMode) p.set("work_mode", opts.workMode)
  if (opts.company) p.set("company_slug", opts.company)

  const multi: Array<[string, string[]]> = [
    ["regions", opts.regions],
    ["countries", opts.countries],
    ["cities", opts.cities],
    ["seniority", opts.seniority],
    ["category", opts.category],
    ["skills", opts.skills],
  ]
  for (const [param, values] of multi) {
    for (const v of values) if (v) p.append(param, v)
  }
  for (const [param, values] of Object.entries(opts.facets)) {
    for (const v of values) if (v) p.append(param, v)
  }
  return p
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  // The slug is the `detail` key, so it is NEVER truncated (a cut slug can't be
  // looked up); it is only padded to a shared min width. Other columns are
  // truncated for scanning. Long slugs make a row ragged — a deliberate trade
  // for a copy-pasteable id.
  const slugWidth = Math.max(4, ...rows.map((r) => r.id.length))
  const line = (id: string, title: string, company: string, loc: string, date: string) =>
    `${id.padEnd(slugWidth)}  ${title.slice(0, 38).padEnd(38)} ${company.slice(0, 22).padEnd(22)} ${loc.slice(0, 20).padEnd(20)} ${date}`
  const header = line("SLUG", "TITLE", "COMPANY", "LOCATION", "DATE")
  const body = rows.map((r) =>
    line(r.id, r.title || "", r.company || "—", r.location || "—", (r.date || "—").slice(0, 10)),
  )
  return [header, "-".repeat(header.length), ...body].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  return rows
    .map(
      (r) =>
        `${r.title}\n  ${r.company || "—"} · ${r.location || "—"} · ${(r.date || "—").slice(0, 10)}\n  slug: ${r.id}\n  ${r.url}`,
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const env = await apiGet<FreehireJob[]>(`/api/v1/jobs/search?${buildQuery(opts).toString()}`)
    // The search endpoint returns an envelope; a null (404) is treated as empty.
    const jobs = env?.data ?? []
    const rows = jobs.map(toResult)
    const total = env?.meta?.total ?? rows.length

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          { meta: { count: rows.length, page: opts.page, total }, results: rows },
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

import { dedupe, filterByAge, readToken, runActor, searchUrl, toResult, type JobResult } from "../helpers.js"

export interface SearchOpts {
  queries: string[] // one Indeed search per entry, all in a single billed actor run
  location?: string
  country: string
  jobage?: number
  limit: number // jobs per query (the actor's maxItemsPerSearch) - the cost driver
  maxCharge: number // hard USD cap for the run
  withDescription: boolean
  broad: boolean // plain keyword search instead of an exact title phrase
  format: "json" | "table" | "plain"
}

export function buildInput(opts: SearchOpts): Record<string, unknown> {
  return {
    startUrls: opts.queries.map((q) => ({ url: searchUrl(q, opts.location, opts.country, opts.jobage, opts.broad) })),
    maxItemsPerSearch: opts.limit,
    parseCompanyDetails: false,
    saveOnlyUniqueItems: true,
  }
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const header = "TITLE".padEnd(42) + " " + "COMPANY".padEnd(26) + " " + "LOCATION".padEnd(22) + " DATE"
  const body = rows.map(
    (r) =>
      `${r.title.slice(0, 42).padEnd(42)} ${(r.company || "—").slice(0, 26).padEnd(26)} ${(r.location || "—").slice(0, 22).padEnd(22)} ${r.date || "—"}`,
  )
  return [header, "-".repeat(header.length), ...body].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const token = readToken()
  const items = await runActor(buildInput(opts), token, opts.maxCharge)
  let rows = dedupe(
    items.map((i) => toResult(i as Record<string, unknown>)).filter((r): r is JobResult => r !== null && !r.isExpired),
  )
  rows = filterByAge(rows, opts.jobage)
  if (!opts.withDescription) rows = rows.map((r) => ({ ...r, description: null }))

  if (opts.format === "table") {
    process.stdout.write(renderTable(rows) + "\n")
  } else if (opts.format === "plain") {
    process.stdout.write(
      rows
        .map((r) => `${r.title}\n  ${r.company || "—"} · ${r.location || "—"} · ${r.date || "—"}\n  id: ${r.id}\n  ${r.url || "—"}${r.applyUrl ? `\n  employer apply: ${r.applyUrl}` : ""}`)
        .join("\n\n") + "\n",
    )
  } else {
    process.stdout.write(JSON.stringify({ meta: { count: rows.length, page: 1, queries: opts.queries.length }, results: rows }, null, 2) + "\n")
  }
  return 0
}

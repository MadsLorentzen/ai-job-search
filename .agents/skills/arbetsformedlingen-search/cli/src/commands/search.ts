import { apiFetch, jobageToPublishedAfter, toJobResult, writeError, type RawSearchResponse, type JobResult } from "../helpers.js"

export interface SearchOpts {
  query?: string
  jobage?: number
  sort?: string // "relevance" | "date"
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

const DEFAULT_LIMIT = 20

function buildParams(opts: SearchOpts, effectiveLimit: number): Record<string, string> {
  const params: Record<string, string> = {
    limit: String(effectiveLimit),
    offset: String((opts.page - 1) * effectiveLimit),
  }
  if (opts.query) params.q = opts.query
  const publishedAfter = jobageToPublishedAfter(opts.jobage)
  if (publishedAfter) params["published-after"] = publishedAfter
  if (opts.sort === "date") params.sort = "pubdate-desc"
  return params
}

function renderTable(results: JobResult[]): string {
  if (results.length === 0) return "No results."
  const rows = results.map((r) => {
    const title = (r.title || "").slice(0, 42).padEnd(42)
    const company = (r.company || "—").slice(0, 26).padEnd(26)
    const loc = (r.location || "—").slice(0, 20).padEnd(20)
    const date = (r.date || "—").slice(0, 10)
    return `${r.id.padEnd(9)} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(9) + " " + "TITLE".padEnd(42) + " " + "COMPANY".padEnd(26) + " " + "LOCATION".padEnd(20) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const effectiveLimit = opts.limit !== undefined ? opts.limit : DEFAULT_LIMIT
    // The API caps `limit` per request; request only what we'll emit.
    const requestLimit = Math.max(1, Math.min(effectiveLimit || DEFAULT_LIMIT, 100))
    const data = await apiFetch<RawSearchResponse>("/search", buildParams(opts, requestLimit))
    const hits = data?.hits ?? []
    let results = hits.map(toJobResult)
    if (opts.limit !== undefined) results = results.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        results
          .map((r) => `${r.title}\n  ${r.company || "—"} · ${r.location || "—"} · ${r.date || "—"}\n  id: ${r.id}\n  ${r.url}`)
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          { meta: { count: results.length, total: data?.total?.value ?? 0, page: opts.page }, results },
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

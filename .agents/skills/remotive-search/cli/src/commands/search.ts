import {
  API_BASE,
  jsonFetch,
  parseJobs,
  matchesQuery,
  matchesCategory,
  matchesLocation,
  withinJobAge,
  writeError,
  type JobCard,
  type RemotiveResponse,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  category?: string
  location?: string
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

const PAGE_SIZE = 25

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "ID".padEnd(10) +
    " " +
    "TITLE".padEnd(42) +
    " " +
    "COMPANY".padEnd(24) +
    " " +
    "ELIGIBILITY".padEnd(22) +
    " DATE"
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 42).padEnd(42)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    const date = (c.date || "—").slice(0, 10)
    return `${c.id.padEnd(10)} ${title} ${company} ${loc} ${date}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    // Every documented filter parameter is ignored by the free API, so we fetch
    // the whole feed once and filter locally. See helpers.ts for the evidence.
    const response = await jsonFetch<RemotiveResponse>(API_BASE)
    if (!response) {
      writeError("Remotive returned no feed", "NOT_FOUND")
      return 1
    }

    const now = Date.now()
    const feedTotal = response["total-job-count"] ?? null

    const all = parseJobs(response).filter(
      (c) =>
        matchesQuery(c, opts.query) &&
        matchesCategory(c, opts.category) &&
        matchesLocation(c, opts.location) &&
        withinJobAge(c, opts.jobage, now),
    )

    all.sort((a, b) => {
      const ta = a.date ? Date.parse(a.date) : 0
      const tb = b.date ? Date.parse(b.date) : 0
      return tb - ta
    })

    // --limit sets the page SIZE rather than trimming inside a fixed 25-row page.
    // Applied after a fixed slice it silently capped every result set at 25, so a
    // larger -n looked like the true total instead of a truncated view.
    const pageSize = opts.limit !== undefined && opts.limit > 0 ? opts.limit : PAGE_SIZE
    const start = Math.max(0, (opts.page - 1) * pageSize)
    const results = all.slice(start, start + pageSize)

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
      process.stdout.write(`\nSource: Remotive (https://remotive.com) — feed holds ${feedTotal ?? "?"} jobs.\n`)
    } else if (opts.format === "plain") {
      process.stdout.write(
        (results.length === 0
          ? "No results."
          : results
              .map(
                (c) =>
                  `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
              )
              .join("\n\n")) + "\nSource: Remotive (https://remotive.com)\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: results.length,
              page: opts.page,
              matchedTotal: all.length,
              // The whole feed is this small — surfaced so a caller can tell a
              // narrow filter from an exhausted source.
              feedTotal,
              allFiltersClientSide: true,
              source: "Remotive",
              attribution: "https://remotive.com",
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

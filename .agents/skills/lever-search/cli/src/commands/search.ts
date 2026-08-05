import {
  API_BASE,
  jsonFetch,
  parseJobs,
  matchesQuery,
  matchesLocation,
  matchesWorkplace,
  withinJobAge,
  writeError,
  type JobCard,
  type RawLeverPosting,
} from "../helpers.js"

export interface SearchOpts {
  sites: string[]
  query?: string
  location?: string
  team?: string
  commitment?: string
  remote?: string
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

const PAGE_SIZE = 25

/**
 * Build the postings URL. `mode=json` is set exactly once — passing it twice
 * makes Lever return HTTP 406.
 */
export function buildUrl(site: string, opts: SearchOpts): string {
  const params = new URLSearchParams()
  params.set("mode", "json")
  if (opts.team) params.set("team", opts.team)
  if (opts.commitment) params.set("commitment", opts.commitment)
  return `${API_BASE}/${encodeURIComponent(site)}?${params.toString()}`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "ID".padEnd(38) +
    " " +
    "TITLE".padEnd(40) +
    " " +
    "COMPANY".padEnd(16) +
    " " +
    "LOCATION".padEnd(24) +
    " DATE"
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 16).padEnd(16)
    const loc = (c.location || "—").slice(0, 24).padEnd(24)
    const date = (c.date || "—").slice(0, 10)
    return `${c.id.padEnd(38)} ${title} ${company} ${loc} ${date}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const now = Date.now()
    const all: JobCard[] = []
    const siteErrors: Array<{ site: string; error: string }> = []

    for (const site of opts.sites) {
      let response: RawLeverPosting[] | null
      try {
        response = await jsonFetch<RawLeverPosting[]>(buildUrl(site, opts))
      } catch (e) {
        siteErrors.push({ site, error: e instanceof Error ? e.message : String(e) })
        continue
      }
      if (!response) {
        siteErrors.push({ site, error: `no Lever posting site found for "${site}"` })
        continue
      }
      if (!Array.isArray(response)) {
        siteErrors.push({ site, error: `unexpected response shape for "${site}"` })
        continue
      }
      // A valid site with zero postings is not an error, just empty.
      for (const card of parseJobs(response, site)) {
        if (!matchesQuery(card, opts.query)) continue
        if (!matchesLocation(card, opts.location)) continue
        if (!matchesWorkplace(card, opts.remote)) continue
        if (!withinJobAge(card, opts.jobage, now)) continue
        all.push(card)
      }
    }

    all.sort((a, b) => {
      const ta = a.date ? Date.parse(a.date) : 0
      const tb = b.date ? Date.parse(b.date) : 0
      return tb - ta
    })

    const start = (opts.page - 1) * PAGE_SIZE
    let results = all.slice(start, start + PAGE_SIZE)
    if (opts.limit !== undefined && opts.limit >= 0) results = results.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        (results.length === 0
          ? "No results."
          : results
              .map(
                (c) =>
                  `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id} (site: ${c.site})\n  ${c.url}`,
              )
              .join("\n\n")) + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: results.length,
              page: opts.page,
              matchedTotal: all.length,
              sites: opts.sites,
              queryFilteredClientSide: !!opts.query,
              ...(siteErrors.length ? { siteErrors } : {}),
            },
            results,
          },
          null,
          2,
        ) + "\n",
      )
    }

    if (siteErrors.length === opts.sites.length && all.length === 0) {
      writeError(
        `all ${opts.sites.length} site(s) failed: ${siteErrors.map((s) => s.site).join(", ")}`,
        "ALL_SITES_FAILED",
      )
      return 1
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}

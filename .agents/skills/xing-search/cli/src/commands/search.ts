import { fetchText, loadSitemap, matchSitemap, parseJobDetail, slugify, writeError, type JobCard } from "../helpers.js"

export interface SearchOpts {
  query: string
  location?: string
  jobage?: number // days; undefined = no filter
  page: number
  limit: number
  format: "json" | "table" | "plain"
}

// Keep per-call live traffic to Xing low regardless of --limit: the sitemap mixes
// years of expired postings with current ones (see helpers.ts), so most keyword
// matches need to be probed via a real fetch before we know whether they're live -
// this bounds that probing instead of letting a broad query fan out unboundedly.
const PROBE_MIN = 15
const PROBE_MAX = 30

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 42).padEnd(42)
    const company = (c.company || "—").slice(0, 26).padEnd(26)
    const loc = (c.location || "—").slice(0, 24).padEnd(24)
    const date = (c.date || "—").slice(0, 10)
    return `${title} ${company} ${loc} ${date}`
  })
  const header = "TITLE".padEnd(42) + " " + "COMPANY".padEnd(26) + " " + "LOCATION".padEnd(24) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const queryWords = opts.query.split(/\s+/).filter(Boolean).map(slugify).filter(Boolean)
    if (queryWords.length === 0) {
      writeError("--query must contain at least one searchable word", "BAD_ARG")
      return 1
    }
    const locationWords = opts.location ? [slugify(opts.location)].filter(Boolean) : []

    const { entries, syncedAt, resynced } = await loadSitemap()
    const allMatches = matchSitemap(entries, queryWords, locationWords)

    const pageStart = (opts.page - 1) * opts.limit
    const candidates = allMatches.slice(pageStart)

    const probeCap = Math.min(Math.max(opts.limit * 3, PROBE_MIN), PROBE_MAX)
    const jobageMs = opts.jobage !== undefined ? opts.jobage * 86400000 : undefined
    const now = Date.now()

    const results: JobCard[] = []
    let probed = 0
    for (const candidate of candidates) {
      if (results.length >= opts.limit || probed >= probeCap) break
      probed++
      const html = await fetchText(candidate.url)
      if (!html) continue
      const detail = parseJobDetail(html, candidate.id, candidate.url)
      if (!detail) continue
      if (detail.isActive === false) continue
      if (jobageMs !== undefined) {
        if (!detail.date) continue
        if (now - new Date(detail.date).getTime() > jobageMs) continue
      }
      results.push({
        id: detail.id,
        title: detail.title,
        company: detail.company,
        location: detail.location,
        date: detail.date,
        url: detail.url,
      })
    }

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        results
          .map((c) => `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  ${c.url}`)
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: results.length,
              page: opts.page,
              matched: allMatches.length,
              probed,
              sitemapSyncedAt: syncedAt,
              sitemapResynced: resynced,
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

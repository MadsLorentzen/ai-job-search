import {
  SITEMAP_URL,
  PAGE_SIZE,
  fetchText,
  parseSitemap,
  parseJobDetail,
  cardFromDetail,
  slugHaystack,
  matchesTokens,
  titleFromSlug,
  mapPool,
  writeError,
  type JobCard,
  type SitemapEntry,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

const ENRICH_CONCURRENCY = 5

/** Fall back to a slug-derived card when a detail page can't be enriched. */
function cardFromSitemap(entry: SitemapEntry): JobCard {
  return {
    id: entry.id,
    title: titleFromSlug(entry.slug),
    company: null,
    location: null,
    date: entry.lastmod,
    url: entry.url,
  }
}

async function enrich(entry: SitemapEntry): Promise<JobCard> {
  try {
    const html = await fetchText(entry.url)
    if (!html) return cardFromSitemap(entry)
    const detail = parseJobDetail(html, entry.id, entry.url)
    if (!detail) return cardFromSitemap(entry)
    const card = cardFromDetail(detail)
    if (!card.date) card.date = entry.lastmod
    return card
  } catch {
    return cardFromSitemap(entry)
  }
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "ID".padEnd(10) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(24) + " " + "LOCATION".padEnd(24)
  const rows = cards.map((c) => {
    const id = (c.id || "").slice(0, 10).padEnd(10)
    const title = (c.title || "—").slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const loc = (c.location || "—").slice(0, 24).padEnd(24)
    return `${id} ${title} ${company} ${loc}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const xml = await fetchText(SITEMAP_URL)
    if (!xml) {
      writeError("Could not fetch the CutShort jobs sitemap", "SEARCH_FAILED")
      return 1
    }

    let entries = parseSitemap(xml)

    if (opts.query) {
      const q = opts.query
      entries = entries.filter((e) => matchesTokens(slugHaystack(e), q))
    }
    if (opts.location) {
      const loc = opts.location
      entries = entries.filter((e) => matchesTokens(slugHaystack(e), loc))
    }
    if (opts.jobage < 9999) {
      const cutoff = Date.now() - opts.jobage * 86400_000
      entries = entries.filter((e) => e.lastmod !== null && Date.parse(e.lastmod) >= cutoff)
    }

    entries.sort((a, b) => {
      const ta = a.lastmod ? Date.parse(a.lastmod) : 0
      const tb = b.lastmod ? Date.parse(b.lastmod) : 0
      return tb - ta
    })

    const start = (opts.page - 1) * PAGE_SIZE
    let pageEntries = entries.slice(start, start + PAGE_SIZE)
    if (opts.limit && opts.limit > 0) pageEntries = pageEntries.slice(0, opts.limit)

    const cards = await mapPool(pageEntries, ENRICH_CONCURRENCY, (e) => enrich(e))

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map((c) => `${c.title}\n  ${c.company || "—"} · ${c.location || "—"}\n  id: ${c.id}\n  ${c.url}`)
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length, page: opts.page }, results: cards }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}

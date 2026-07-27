import {
  BASE,
  htmlFetch,
  listingUrl,
  mapLimit,
  matchesQuery,
  parseJobCards,
  parseJobDetail,
  fold,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  group?: string
  tag?: string
  jobage?: number
  tjmMin?: number
  includeFilled: boolean
  enrich: boolean
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

/** Results per page when `--page` is used (the board is served as one long list). */
const PAGE_SIZE = 20

/** Safety cap on detail fetches performed for `--location` / `--jobage` / `--enrich`. */
const MAX_ENRICH = 100

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 44).padEnd(44)
    const loc = (c.location || "—").slice(0, 18).padEnd(18)
    const tjm = (c.tjm !== null ? `${c.tjm} ${c.currency ?? ""}`.trim() : "—").padEnd(9)
    const date = (c.date || "—").padEnd(10)
    const status = c.filled ? "pourvue" : ""
    return `${c.id.padEnd(12)} ${title} ${loc} ${tjm} ${date} ${status}`.trimEnd()
  })
  const header =
    "ID".padEnd(12) +
    " " +
    "TITLE".padEnd(44) +
    " " +
    "LOCATION".padEnd(18) +
    " " +
    "TJM".padEnd(9) +
    " " +
    "POSTED".padEnd(10) +
    " STATUS"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

function renderPlain(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  return cards
    .map((c) => {
      const bits = [
        c.location || "—",
        c.tjm !== null ? `${c.tjm} ${c.currency ?? ""}`.trim() + "/j" : "TJM —",
        c.date || "date —",
      ]
      if (c.filled) bits.push("OFFRE POURVUE")
      return [
        c.title,
        `  ${bits.join(" · ")}`,
        `  client: ${c.clientProfile ? c.clientProfile.split("\n")[0].slice(0, 100) : "non nommé"} (via ${c.intermediary})`,
        c.tags.length ? `  tags: ${c.tags.join(", ")}` : "",
        `  id: ${c.id}`,
        `  ${c.url}`,
      ]
        .filter(Boolean)
        .join("\n")
    })
    .join("\n\n")
}

/** Fill in location/date/duration from each mission's detail page. */
async function enrichCards(cards: JobCard[]): Promise<JobCard[]> {
  return mapLimit(cards, 4, async (card) => {
    try {
      const html = await htmlFetch(`${BASE}/jobs/${card.id}`)
      if (!html) return card
      const detail = parseJobDetail(html, card.id)
      return {
        ...card,
        location: detail.location ?? card.location,
        date: detail.date ?? card.date,
        group: card.group ?? detail.group,
        tjm: card.tjm ?? detail.tjm,
        currency: card.currency ?? detail.currency,
        clientProfile: card.clientProfile ?? detail.clientProfile,
      }
      // A single unreachable detail page must not fail the whole search.
    } catch {
      return card
    }
  })
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const url = listingUrl({ group: opts.group, tag: opts.tag })
    const html = await htmlFetch(url)
    if (!html) {
      writeError(
        opts.tag
          ? `No listing page for tag "${opts.tag}" (tags are exact — check spelling)`
          : `No listing page for group "${opts.group}" (valid groups: electronique, "infra & ops", "logiciel embarqué", management, "test & qa", "web & edition")`,
        "NO_LISTING",
      )
      return 1
    }

    let cards = parseJobCards(html)
    const total = cards.length

    if (!opts.includeFilled) cards = cards.filter((c) => !c.filled)
    if (opts.query) cards = cards.filter((c) => matchesQuery(c, opts.query!))
    if (opts.tjmMin !== undefined) {
      cards = cards.filter((c) => c.tjm !== null && c.tjm >= opts.tjmMin!)
    }

    // `location` and `jobage` only exist on detail pages, so they force enrichment.
    const needsEnrich = opts.enrich || opts.location !== undefined || opts.jobage !== undefined
    let enrichTruncated = false
    if (needsEnrich && cards.length > 0) {
      if (cards.length > MAX_ENRICH) {
        enrichTruncated = true
        cards = cards.slice(0, MAX_ENRICH)
      }
      cards = await enrichCards(cards)
    }

    if (opts.location) {
      const needle = fold(opts.location)
      cards = cards.filter((c) => c.location !== null && fold(c.location).includes(needle))
    }
    if (opts.jobage !== undefined) {
      cards = cards.filter((c) => {
        const age = daysAgo(c.date)
        return age !== null && age <= opts.jobage!
      })
    }

    // Newest first once dates are known; otherwise keep the board's own order.
    if (needsEnrich) {
      cards = [...cards].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    }

    const matched = cards.length
    const start = (opts.page - 1) * PAGE_SIZE
    cards = cards.slice(start, start + PAGE_SIZE)
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(cards) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: cards.length,
              page: opts.page,
              pageSize: PAGE_SIZE,
              matched,
              boardSize: total,
              source: url,
              query: opts.query ?? null,
              enriched: needsEnrich,
              enrichTruncated,
            },
            results: cards,
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

import {
  API_BASE,
  SEARCH_PATH,
  jsonFetch,
  normalizeCard,
  buildLocationKey,
  withinJobAge,
  writeError,
  type JobCard,
  type RawPosting,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  contract?: string
  remote?: string
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

/** Results requested per API page. The API honours values up to at least 100. */
const PER_PAGE = 50

function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  // NOTE: the keyword parameter is `searchKeywords`. The site's own front-end
  // uses `query=`, which the API silently ignores — see url-reference.md.
  if (opts.query) params.set("searchKeywords", opts.query)
  if (opts.contract) params.set("contracts", opts.contract)
  if (opts.location) params.set("locationKeys", buildLocationKey(opts.location))
  params.set("itemsPerPage", String(PER_PAGE))
  params.set("page", String(opts.page))
  // Newest first. The API exposes no date *filter*, so --jobage is applied
  // client-side; sorting by date keeps the recent postings on early pages.
  params.set("order", "date")
  return `${API_BASE}${SEARCH_PATH}?${params.toString()}`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "ID".padEnd(8) +
    " " +
    "TITLE".padEnd(44) +
    " " +
    "COMPANY".padEnd(22) +
    " " +
    "LOCATION".padEnd(22) +
    " " +
    "TJM".padEnd(16) +
    " DATE"
  const rows = cards.map((c) => {
    const id = (c.id || "—").slice(0, 8).padEnd(8)
    const title = (c.title || "").slice(0, 44).padEnd(44)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    const tjm = (c.dailyRate || "—").slice(0, 16).padEnd(16)
    const date = (c.date || "—").slice(0, 10)
    return `${id} ${title} ${company} ${loc} ${tjm} ${date}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

function renderPlain(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  return cards
    .map((c) => {
      const bits = [
        c.company || "—",
        c.location || "—",
        (c.date || "—").slice(0, 10),
      ]
      const extra = [
        c.contracts.length ? c.contracts.join("/") : null,
        c.dailyRate ? `TJM ${c.dailyRate}` : null,
        c.duration ? `${c.duration}${c.renewable ? ", renewable" : ""}` : null,
        c.remote ? `remote: ${c.remote}` : null,
      ].filter(Boolean)
      return (
        `${c.title}\n  ${bits.join(" · ")}` +
        (extra.length ? `\n  ${extra.join(" · ")}` : "") +
        `\n  id: ${c.id}${c.slug ? `  slug: ${c.slug}` : ""}\n  ${c.url}`
      )
    })
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const raw = await jsonFetch<RawPosting[]>(buildUrl(opts))
    if (raw === null) {
      writeError("Search endpoint returned 404", "NOT_FOUND")
      return 1
    }
    if (!Array.isArray(raw)) {
      writeError("Unexpected response shape (expected a JSON array)", "BAD_RESPONSE")
      return 1
    }

    // Parse each posting independently so one malformed record cannot break
    // the rest of the page.
    let cards: JobCard[] = []
    for (const p of raw) {
      try {
        cards.push(normalizeCard(p))
      } catch {
        continue
      }
    }

    cards = withinJobAge(cards, opts.jobage)
    if (opts.remote) cards = cards.filter((c) => c.remote === opts.remote)
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(cards) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length, page: opts.page }, results: cards }, null, 2) +
          "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}

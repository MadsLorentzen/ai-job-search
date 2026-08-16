import {
  ALGOLIA_URL,
  JOBS_INDEX,
  jsonPost,
  parseHit,
  remoteFacet,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  remote?: string
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

const PAGE_SIZE = 30

// Common country names → ISO 3166-1 alpha-2, so `-l "India"` works as well as `-l IN`.
const COUNTRY_CODES: Record<string, string> = {
  india: "IN",
  "united kingdom": "GB",
  uk: "GB",
  england: "GB",
  france: "FR",
  germany: "DE",
  spain: "ES",
  "united states": "US",
  usa: "US",
  us: "US",
  netherlands: "NL",
  ireland: "IE",
  canada: "CA",
  singapore: "SG",
  australia: "AU",
  belgium: "BE",
  portugal: "PT",
  italy: "IT",
  poland: "PL",
}

function countryCode(location: string | undefined): string | null {
  if (!location) return null
  const trimmed = location.trim()
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase()
  return COUNTRY_CODES[trimmed.toLowerCase()] ?? null
}

function buildBody(opts: SearchOpts): unknown {
  const filters: string[] = []
  const code = countryCode(opts.location)
  if (code) filters.push(`offices.country_code:${code}`)
  const rf = remoteFacet(opts.remote)
  if (rf) filters.push(`remote:${rf}`)

  const params = new URLSearchParams()
  params.set("query", opts.query ?? "")
  params.set("hitsPerPage", String(PAGE_SIZE))
  params.set("page", String(Math.max(0, opts.page - 1)))
  if (filters.length) params.set("filters", filters.join(" AND "))

  return { requests: [{ indexName: JOBS_INDEX, params: params.toString() }] }
}

/** Client-side recency filter: keep hits published within `jobage` days. */
function withinAge(cards: JobCard[], jobage: number): JobCard[] {
  if (!jobage || jobage <= 0 || jobage >= 9999) return cards
  const cutoff = Date.now() - jobage * 86400000
  return cards.filter((c) => {
    if (!c.date) return true
    const t = Date.parse(c.date)
    return isNaN(t) ? true : t >= cutoff
  })
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const loc = (c.location || "—").slice(0, 18).padEnd(18)
    const remote = (c.remote || "—").slice(0, 8).padEnd(8)
    const date = (c.date || "—").slice(0, 10)
    return `${c.id.padEnd(9)} ${title} ${company} ${loc} ${remote} ${date}`
  })
  const header =
    "ID".padEnd(9) +
    " " +
    "TITLE".padEnd(40) +
    " " +
    "COMPANY".padEnd(22) +
    " " +
    "LOCATION".padEnd(18) +
    " " +
    "REMOTE".padEnd(8) +
    " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const data = await jsonPost(ALGOLIA_URL, buildBody(opts))
    const hits: any[] = data?.results?.[0]?.hits ?? []
    let cards = hits
      .map(parseHit)
      .filter((c): c is JobCard => c !== null)
    cards = withinAge(cards, opts.jobage)
    if (opts.limit && opts.limit > 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.remote || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          { meta: { count: cards.length, page: opts.page }, results: cards },
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

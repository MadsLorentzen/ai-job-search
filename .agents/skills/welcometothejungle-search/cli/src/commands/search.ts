import {
  JOBS_INDEX,
  algoliaQuery,
  toCard,
  remoteFacet,
  contractFacet,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  city?: string
  country?: string
  remote?: string
  contract?: string
  since?: number // client-side: only jobs published within N days
  page: number // 1-indexed
  limit?: number
  format: "json" | "table" | "plain"
}

// Only pull the fields the CLI needs — the raw hits embed the full company
// description, which bloats every result by kilobytes.
const ATTRS = [
  "objectID",
  "reference",
  "name",
  "slug",
  "organization.name",
  "organization.slug",
  "offices",
  "remote",
  "contract_type",
  "contract_type_names",
  "published_at",
]

function buildParams(opts: SearchOpts): string {
  const params = new URLSearchParams()
  params.set("query", opts.query || "")
  params.set("hitsPerPage", "20")
  params.set("page", String(Math.max(0, opts.page - 1))) // Algolia is 0-indexed
  params.set("attributesToRetrieve", JSON.stringify(ATTRS))

  // Each entry is ANDed together (nested arrays would be ORed).
  const facetFilters: string[] = []
  if (opts.city) facetFilters.push(`offices.city:${opts.city}`)
  if (opts.country) facetFilters.push(`offices.country_code:${opts.country.toUpperCase()}`)
  const rf = remoteFacet(opts.remote)
  if (rf) facetFilters.push(`remote:${rf}`)
  const cf = contractFacet(opts.contract)
  if (cf) facetFilters.push(`contract_type:${cf}`)
  if (facetFilters.length) params.set("facetFilters", JSON.stringify(facetFilters))

  return params.toString()
}

function withinDays(dateStr: string | null, days: number): boolean {
  if (!dateStr) return false
  const t = Date.parse(dateStr)
  if (Number.isNaN(t)) return false
  return Date.now() - t <= days * 86400 * 1000
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const ref = (c.reference || c.objectID).slice(0, 14).padEnd(14)
    const title = (c.title || "").slice(0, 38).padEnd(38)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const loc = (c.location || "—").slice(0, 20).padEnd(20)
    const remote = (c.remote || "—").slice(0, 8).padEnd(8)
    const date = (c.date || "—").slice(0, 10)
    return `${ref} ${title} ${company} ${loc} ${remote} ${date}`
  })
  const header =
    "REFERENCE".padEnd(14) +
    " " +
    "TITLE".padEnd(38) +
    " " +
    "COMPANY".padEnd(22) +
    " " +
    "LOCATION".padEnd(20) +
    " " +
    "REMOTE".padEnd(8) +
    " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const result = await algoliaQuery(buildParams(opts))
    let cards = result.hits.map(toCard)
    if (opts.since && opts.since > 0) {
      cards = cards.filter((c) => withinDays(c.date, opts.since as number))
    }
    if (opts.limit && opts.limit > 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · remote: ${c.remote || "—"} · ${c.contractType || "—"} · ${c.date || "—"}\n  ref: ${c.reference || "—"}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: { count: cards.length, totalHits: result.nbHits, page: opts.page, index: JOBS_INDEX },
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

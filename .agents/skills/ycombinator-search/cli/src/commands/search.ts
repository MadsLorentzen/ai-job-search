import { ROLE_SLUGS, fetchListing, writeError, type JobCard } from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  role?: string
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

const PAGE_SIZE = 20

/** All query tokens must appear somewhere in the job's searchable text. */
function matchesQuery(card: JobCard, query: string): boolean {
  const hay = [
    card.title,
    card.roleType,
    card.company,
    card.companyOneLiner,
    card.location,
    card.jobType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => hay.includes(tok))
}

function matchesLocation(card: JobCard, location: string): boolean {
  return (card.location || "").toLowerCase().includes(location.toLowerCase())
}

/** Collect listings: a single role, or the union of all categories, deduped by id. */
async function collect(role?: string, aggregate?: boolean): Promise<JobCard[]> {
  if (role) return fetchListing(role)
  if (!aggregate) return fetchListing()
  const seen = new Set<string>()
  const out: JobCard[] = []
  for (const slug of ROLE_SLUGS) {
    const cards = await fetchListing(slug)
    for (const c of cards) {
      if (!seen.has(c.id)) {
        seen.add(c.id)
        out.push(c)
      }
    }
  }
  return out
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const id = c.id.padEnd(7)
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const loc = (c.location || "—").slice(0, 28).padEnd(28)
    return `${id} ${title} ${company} ${loc}`
  })
  const header =
    "ID".padEnd(7) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(22) + " " + "LOCATION"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const aggregate = Boolean(opts.query) || Boolean(opts.location)
    let cards = await collect(opts.role, aggregate)

    if (opts.query) cards = cards.filter((c) => matchesQuery(c, opts.query!))
    if (opts.location) cards = cards.filter((c) => matchesLocation(c, opts.location!))

    const total = cards.length
    const start = (opts.page - 1) * PAGE_SIZE
    let pageCards = cards.slice(start, start + PAGE_SIZE)
    if (opts.limit && opts.limit > 0) pageCards = pageCards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(pageCards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        (pageCards.length === 0
          ? "No results."
          : pageCards
              .map(
                (c) =>
                  `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.roleType || "—"}\n  id: ${c.id}\n  ${c.url}`,
              )
              .join("\n\n")) + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          { meta: { count: pageCards.length, page: opts.page, total }, results: pageCards },
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

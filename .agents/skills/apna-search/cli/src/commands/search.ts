import {
  BASE,
  htmlFetch,
  extractPageProps,
  mapJob,
  citySlug,
  resolveSlug,
  keywordMatch,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

/** Build a /jobs listing path from an optional category slug + city token. */
function buildPath(slug: string | null, city: string | null): string {
  if (slug && city) return `/jobs/${slug}-jobs-in-${city}`
  if (slug) return `/jobs/${slug}-jobs`
  if (city) return `/jobs/jobs-in-${city}`
  return "/jobs"
}

function withPage(path: string, page: number): string {
  return page > 1 ? `${BASE}${path}?page=${page}` : `${BASE}${path}`
}

function withinJobAge(card: JobCard, days: number): boolean {
  if (!days || days <= 0 || days >= 9999 || !card.date) return true
  const posted = Date.parse(card.date)
  if (isNaN(posted)) return true
  const ageDays = (Date.now() - posted) / 86_400_000
  return ageDays <= days
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const id = c.id.padEnd(10)
    const title = (c.title || "").slice(0, 30).padEnd(30)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    const sal = (c.salary || "—").slice(0, 22).padEnd(22)
    return `${id} ${title} ${company} ${loc} ${sal} ${c.date || "—"}`
  })
  const header =
    "ID".padEnd(10) +
    " " +
    "TITLE".padEnd(30) +
    " " +
    "COMPANY".padEnd(24) +
    " " +
    "LOCATION".padEnd(22) +
    " " +
    "SALARY".padEnd(22) +
    " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const city = opts.location ? citySlug(opts.location) : null

    // Bootstrap: when we have a query we need apna's live category/department
    // catalog to resolve it to a slug. The bootstrap page also carries jobs, so
    // when the resolved page equals the bootstrap page we avoid a second fetch.
    const bootstrapPath = buildPath(null, city)
    let slug: string | null = null
    let props: any = null

    if (opts.query) {
      const bootHtml = await htmlFetch(withPage(bootstrapPath, 1))
      const bootProps = extractPageProps(bootHtml)
      if (bootProps) {
        slug = resolveSlug(opts.query, bootProps.categoryList || [], bootProps.departmentList || [])
        if (!slug && opts.page === 1) props = bootProps
      }
    }

    const finalPath = buildPath(slug, city)
    if (!props) {
      let html = await htmlFetch(withPage(finalPath, opts.page))
      props = extractPageProps(html)
      // A resolved category+city slug can 404 for sparse combos — fall back to
      // the city-only page and rely on the client-side keyword filter.
      if (!props && slug && city) {
        html = await htmlFetch(withPage(buildPath(null, city), opts.page))
        props = extractPageProps(html)
      }
    }

    if (!props) {
      writeError("Could not parse job listings from apna.co", "PARSE_FAILED")
      return 1
    }

    let cards: JobCard[] = (props.jobs || [])
      .map((j: any) => mapJob(j?.data))
      .filter((c: JobCard | null): c is JobCard => c !== null)

    if (opts.query) {
      const filtered = cards.filter((c) => keywordMatch(c, opts.query!))
      if (filtered.length) cards = filtered
    }

    cards = cards.filter((c) => withinJobAge(c, opts.jobage))
    if (opts.limit && opts.limit > 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.salary || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
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

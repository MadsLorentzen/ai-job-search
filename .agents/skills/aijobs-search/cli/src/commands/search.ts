import { BASE_URL, htmlFetch, parseJobCards, writeError, type JobCard } from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage: number
  remote?: string // "remote" | "hybrid" | "onsite"
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  // aijobs.net has no working GET filter for location/remote/age; only free-text
  // `keyword` and `page` are honored. Location is folded into the keyword string.
  const kw = [opts.query, opts.location].filter(Boolean).join(" ").trim()
  if (kw) params.set("keyword", kw)
  if (opts.page > 1) params.set("page", String(opts.page))
  const qs = params.toString()
  return qs ? `${BASE_URL}/?${qs}` : `${BASE_URL}/`
}

function applyClientFilters(cards: JobCard[], opts: SearchOpts): JobCard[] {
  let out = cards
  if (opts.jobage && opts.jobage > 0 && opts.jobage < 9999) {
    out = out.filter((c) => {
      if (!c.date) return true
      const ageDays = Math.round((Date.now() - new Date(c.date + "T00:00:00Z").getTime()) / 86400000)
      return ageDays <= opts.jobage
    })
  }
  if (opts.remote && opts.remote.toLowerCase() === "remote") {
    out = out.filter((c) => c.remote || /remote/i.test(c.location || ""))
  }
  return out
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 34).padEnd(34)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    const salary = (c.salary || "—").slice(0, 16).padEnd(16)
    const date = c.date || "—"
    return `${title} ${loc} ${salary} ${date}`
  })
  const header =
    "TITLE".padEnd(34) + " " + "LOCATION".padEnd(22) + " " + "SALARY".padEnd(16) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const html = await htmlFetch(buildUrl(opts))
    let cards = parseJobCards(html)
    cards = applyClientFilters(cards, opts)
    if (opts.limit && opts.limit > 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.location || "—"} · ${c.salary || "—"} · ${c.employmentType || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
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

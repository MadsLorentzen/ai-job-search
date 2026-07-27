import {
  SEARCH_URL,
  htmlFetch,
  parseJobCards,
  jobageToParam,
  normalizeContracts,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  contract?: string
  jobage: number
  sort: "relevance" | "date"
  radius?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  if (opts.query) params.set("k", opts.query)
  if (opts.location) params.set("l", opts.location)
  if (opts.contract) {
    // `c` repeats for OR: ?c=Freelance&c=Independant
    for (const v of normalizeContracts(opts.contract).values) params.append("c", v)
  }
  params.set("d", jobageToParam(opts.jobage) ?? "all")
  params.set("st", opts.sort)
  if (opts.radius !== undefined) params.set("ray", String(opts.radius))
  if (opts.page > 1) params.set("p", String(opts.page))
  return `${SEARCH_URL}?${params.toString()}`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const id = c.id.padEnd(10)
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const loc = (c.location || "—").slice(0, 18).padEnd(18)
    const contract = (c.contract || "—").slice(0, 10).padEnd(10)
    const salary = (c.salary || "—").slice(0, 20).padEnd(20)
    return `${id} ${title} ${company} ${loc} ${contract} ${salary} ${c.date || "—"}`
  })
  const header =
    "ID".padEnd(10) +
    " " +
    "TITLE".padEnd(40) +
    " " +
    "COMPANY".padEnd(22) +
    " " +
    "LOCATION".padEnd(18) +
    " " +
    "CONTRACT".padEnd(10) +
    " " +
    "SALARY / TJM".padEnd(20) +
    " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  if (opts.contract) {
    const { values, unknown } = normalizeContracts(opts.contract)
    if (unknown.length) {
      writeError(
        `unknown --contract value(s): ${unknown.join(", ")}. ` +
          `Valid: Freelance, Independant, CDI, CDD, Travail_temp, Stage, Alternance, ` +
          `Franchise, Associe, Fonctionnaire, Stage_de_lycee`,
        "BAD_CONTRACT",
      )
      return 1
    }
    if (!values.length) {
      writeError("--contract was empty after parsing", "BAD_CONTRACT")
      return 1
    }
  }

  try {
    const html = await htmlFetch(buildUrl(opts))
    let cards = parseJobCards(html)

    // HelloWork's `d` filter is coarse (24h / 3d / 1w / 1m), so tighten it here.
    // Cards whose relative label did not parse are kept rather than silently dropped.
    if (opts.jobage > 0 && opts.jobage < 9999) {
      cards = cards.filter((c) => c.ageDays === null || c.ageDays <= opts.jobage)
    }

    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      const body = cards
        .map((c) =>
          [
            c.title,
            `  ${c.company || "—"} · ${c.location || "—"} · ${c.contract || "—"}`,
            c.salary ? `  ${c.salary}` : null,
            `  ${c.dateRelative || "—"}${c.date ? ` (${c.date})` : ""}`,
            `  id: ${c.id}`,
            `  ${c.url}`,
          ]
            .filter((l) => l !== null)
            .join("\n"),
        )
        .join("\n\n")
      process.stdout.write((body || "No results.") + "\n")
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

import {
  BASE_URL,
  SEARCH_PATH,
  htmlFetch,
  matchesLocation,
  parseMissionCards,
  skillMatchesQuery,
  withinJobage,
  writeError,
  type MissionCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage: number
  page: number
  limit?: number
  strict?: boolean
  format: "json" | "table" | "plain"
}

export function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  if (opts.query) params.set("competences", opts.query)
  if (opts.page > 1) params.set("page", String(opts.page))
  const qs = params.toString()
  return `${BASE_URL}${SEARCH_PATH}${qs ? `?${qs}` : ""}`
}

function renderTable(cards: MissionCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 44).padEnd(44)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    const duration = (c.duration || "—").slice(0, 14).padEnd(14)
    const start = (c.startDate || "—").padEnd(10)
    return `${c.id.padEnd(11)} ${title} ${loc} ${duration} ${start} ${c.date || "—"}`
  })
  const header =
    "ID".padEnd(11) +
    " " +
    "TITLE".padEnd(44) +
    " " +
    "LOCATION".padEnd(22) +
    " " +
    "DURATION".padEnd(14) +
    " " +
    "START".padEnd(10) +
    " POSTED"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

function renderPlain(cards: MissionCard[]): string {
  if (cards.length === 0) return "No results."
  return cards
    .map((c) => {
      const meta = [c.location || "—", c.duration || "—", c.startDate ? `start ${c.startDate}` : null]
        .filter(Boolean)
        .join(" · ")
      const skills = c.skills.length ? `\n  skills: ${c.skills.join(", ")}` : ""
      return `${c.title}\n  ${meta}\n  posted: ${c.dateRaw || "—"} (${c.date || "—"})${skills}\n  id: ${c.id}\n  ${c.url}`
    })
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const now = new Date()
    const { html } = await htmlFetch(buildUrl(opts))
    let cards = parseMissionCards(html, now)

    const fetched = cards.length

    // The portal answers an unknown skill term with related-skill missions
    // rather than an empty page, so a non-empty result is not proof the term
    // was understood. Count the genuine tag hits before any other filtering.
    const skillHits = opts.query
      ? cards.filter((c) => skillMatchesQuery(c, opts.query as string)).length
      : null
    if (opts.strict && opts.query) {
      cards = cards.filter((c) => skillMatchesQuery(c, opts.query as string))
    }

    if (opts.location) cards = cards.filter((c) => matchesLocation(c, opts.location as string))
    cards = cards.filter((c) => withinJobage(c, opts.jobage, now))
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    // Warn on stderr so stdout stays parseable in every format.
    if (opts.query && fetched > 0 && skillHits === 0) {
      process.stderr.write(
        JSON.stringify({
          warning: `No mission on this page is tagged "${opts.query}" — the portal substituted a related skill. Treat these results as unrelated, or re-run with --strict.`,
          code: "QUERY_SUBSTITUTED",
        }) + "\n",
      )
    }

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
              fetchedOnPage: fetched,
              filteredClientSide: fetched - cards.length,
              querySkillHits: skillHits,
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

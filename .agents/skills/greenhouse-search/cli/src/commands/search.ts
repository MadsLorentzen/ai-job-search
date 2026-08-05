import {
  API_BASE,
  jsonFetch,
  parseJobs,
  matchesQuery,
  matchesLocation,
  matchesUsRemote,
  withinJobAge,
  pool,
  writeError,
  type JobCard,
  type GreenhouseListResponse,
} from "../helpers.js"

export interface SearchOpts {
  boards: string[]
  query?: string
  location?: string
  usRemote?: boolean
  jobage: number
  page: number
  limit?: number
  concurrency: number
  format: "json" | "table" | "plain"
}

const PAGE_SIZE = 25

/**
 * Client-side pagination over the full matched set.
 *
 * `limit` sets the page SIZE; it does NOT trim inside a fixed 25-row page.
 * The earlier version sliced a fixed PAGE_SIZE window and only then applied
 * `limit`, which silently capped every result set at 25 — so `-n 70` against 66
 * matches returned 25 rows that read as the complete answer. Silent truncation
 * is worse than an error, because nothing signals that results were dropped.
 */
export function paginate<T>(all: T[], page: number, limit?: number): T[] {
  const pageSize = limit !== undefined && limit > 0 ? limit : PAGE_SIZE
  const start = Math.max(0, (page - 1) * pageSize)
  return all.slice(start, start + pageSize)
}

export function buildUrl(board: string): string {
  return `${API_BASE}/${encodeURIComponent(board)}/jobs`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "ID".padEnd(10) +
    " " +
    "TITLE".padEnd(44) +
    " " +
    "COMPANY".padEnd(20) +
    " " +
    "LOCATION".padEnd(26) +
    " DATE"
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 44).padEnd(44)
    const company = (c.company || "—").slice(0, 20).padEnd(20)
    const loc = (c.location || "—").slice(0, 26).padEnd(26)
    const date = (c.date || "—").slice(0, 10)
    return `${c.id.padEnd(10)} ${title} ${company} ${loc} ${date}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const now = Date.now()
    const all: JobCard[] = []
    const boardErrors: Array<{ board: string; error: string }> = []

    // Boards are fetched CONCURRENTLY — a registry sweep is ~79 boards, which
    // sequentially would take minutes. One board can 404 (wrong token) or fail
    // without killing the whole run.
    const perBoard = await pool(opts.boards, opts.concurrency, async (board) => {
      try {
        const response = await jsonFetch<GreenhouseListResponse>(buildUrl(board))
        if (!response) {
          return { board, error: `no Greenhouse board found for "${board}"`, cards: [] as JobCard[] }
        }
        return { board, error: null, cards: parseJobs(response, board) }
      } catch (e) {
        return { board, error: e instanceof Error ? e.message : String(e), cards: [] as JobCard[] }
      }
    })

    for (const result of perBoard) {
      if (result.error) {
        boardErrors.push({ board: result.board, error: result.error })
        continue
      }
      for (const card of result.cards) {
        if (!matchesQuery(card, opts.query)) continue
        if (opts.usRemote && !matchesUsRemote(card)) continue
        if (!matchesLocation(card, opts.location)) continue
        if (!withinJobAge(card, opts.jobage, now)) continue
        all.push(card)
      }
    }

    // Newest first, undated last.
    all.sort((a, b) => {
      const ta = a.date ? Date.parse(a.date) : 0
      const tb = b.date ? Date.parse(b.date) : 0
      return tb - ta
    })

    // Greenhouse returns a whole board in one response, so paginate client-side.
    const results = paginate(all, opts.page, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        (results.length === 0
          ? "No results."
          : results
              .map(
                (c) =>
                  `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id} (board: ${c.board})\n  ${c.url}`,
              )
              .join("\n\n")) + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: results.length,
              page: opts.page,
              matchedTotal: all.length,
              boardsSearched: opts.boards.length,
              // Full list omitted once it gets long (a registry sweep is ~79).
              boards: opts.boards.length <= 12 ? opts.boards : undefined,
              queryFilteredClientSide: !!opts.query,
              ...(boardErrors.length ? { boardErrors } : {}),
            },
            results,
          },
          null,
          2,
        ) + "\n",
      )
    }

    // Every board failed and none produced results — that is a real failure.
    if (boardErrors.length === opts.boards.length && all.length === 0) {
      writeError(
        `all ${opts.boards.length} board(s) failed: ${boardErrors.map((b) => b.board).join(", ")}`,
        "ALL_BOARDS_FAILED",
      )
      return 1
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}

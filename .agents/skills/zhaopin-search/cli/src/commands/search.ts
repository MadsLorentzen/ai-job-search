import { buildSearchUrl, htmlFetch, isBlockedPage, parseJobCards, toStandardJob, writeError } from "../helpers.js"

export interface SearchOptions { query: string; city?: string; page: number; limit?: number; jobage?: number; format: "json" | "table" | "plain" }

export async function runSearch(options: SearchOptions): Promise<number> {
  try {
    const html = await htmlFetch(buildSearchUrl(options.query, options.page, options.city))
    if (isBlockedPage(html)) { writeError("Zhaopin returned a login or verification page", "BLOCKED_PAGE"); return 1 }
    let cards = parseJobCards(html)
    if (!cards.length && /positionlist|joblist-box/.test(html)) { writeError("No parseable jobs found on Zhaopin page", "PARSE_DEGRADED"); return 1 }
    if (options.jobage) {
      const threshold = Date.now() - options.jobage * 86400000
      cards = cards.filter((card) => !card.date || Date.parse(card.date) >= threshold)
    }
    if (options.limit !== undefined) cards = cards.slice(0, options.limit)
    const results = cards.map((card) => toStandardJob(card))
    if (options.format === "json") process.stdout.write(JSON.stringify({ meta: { count: results.length, page: options.page }, results }, null, 2) + "\n")
    else if (options.format === "table") process.stdout.write(["ID | 职位 | 公司 | 地点 | 薪资", ...results.map((r) => `${r.id} | ${r.title} | ${r.company ?? "-"} | ${r.location ?? "-"} | ${r.salary ?? "-"}`)].join("\n") + "\n")
    else process.stdout.write(results.map((r) => `${r.title}\n  ${r.company ?? "-"} · ${r.location ?? "-"}\n  ${r.url}`).join("\n\n") + "\n")
    return 0
  } catch (error) { writeError(error instanceof Error ? error.message : String(error), "SEARCH_FAILED"); return 1 }
}

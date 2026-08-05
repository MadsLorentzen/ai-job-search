import {
  API_BASE,
  jsonFetch,
  normalizeJob,
  htmlToText,
  writeError,
  type JobDetail,
  type RawGreenhouseJob,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  board?: string
  format: "json" | "plain"
}

/**
 * A Greenhouse job id is only meaningful together with its board token, so
 * `detail` accepts either `--company <board> <id>` or a full job URL that
 * carries both (e.g. https://boards.greenhouse.io/stripe/jobs/8023928, or a
 * company careers URL with ?gh_jid=).
 */
export function parseRef(
  input: string,
  boardFlag: string | undefined,
): { board: string; id: string } | null {
  const trimmed = input.trim()

  const urlMatch = trimmed.match(/greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i)
  if (urlMatch) return { board: urlMatch[1]!, id: urlMatch[2]! }

  const ghJid = trimmed.match(/[?&]gh_jid=(\d+)/i)
  if (ghJid && boardFlag) return { board: boardFlag, id: ghJid[1]! }

  if (/^\d+$/.test(trimmed) && boardFlag) return { board: boardFlag, id: trimmed }

  return null
}

export function buildDetail(raw: RawGreenhouseJob, board: string): JobDetail | null {
  const card = normalizeJob(raw, board)
  if (!card) return null
  const departments = Array.isArray(raw.departments)
    ? raw.departments.map((d) => d?.name).filter((n): n is string => !!n)
    : []
  const offices = Array.isArray(raw.offices)
    ? raw.offices.map((o) => o?.name).filter((n): n is string => !!n)
    : []
  return {
    ...card,
    description: raw.content ? htmlToText(raw.content) || null : null,
    departments: departments.length ? departments.join(", ") : null,
    offices: offices.length ? offices.join(", ") : null,
    applyUrl: card.url,
  }
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  try {
    const ref = parseRef(opts.id, opts.board)
    if (!ref) {
      writeError(
        `could not resolve a board + job id from "${opts.id}". Pass a full greenhouse job URL, or an id together with --company <board-token>.`,
        "BAD_ID",
      )
      return 1
    }

    const raw = await jsonFetch<RawGreenhouseJob>(
      `${API_BASE}/${encodeURIComponent(ref.board)}/jobs/${encodeURIComponent(ref.id)}`,
    )
    if (!raw) {
      writeError(`no job found for board "${ref.board}" with id ${ref.id}`, "NOT_FOUND")
      return 1
    }

    const detail = buildDetail(raw, ref.board)
    if (!detail) {
      writeError(`job ${ref.id} returned an unparseable record`, "PARSE_FAILED")
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        detail.title,
        `${detail.company || "—"} · ${detail.location || "—"}`,
        `Posted: ${detail.date || "—"}`,
        detail.departments ? `Department: ${detail.departments}` : null,
        detail.offices ? `Office: ${detail.offices}` : null,
        `URL: ${detail.url}`,
        "",
        detail.description || "(no description)",
      ].filter((l): l is string => l !== null)
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(detail, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}

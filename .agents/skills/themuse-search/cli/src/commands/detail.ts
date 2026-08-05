import {
  API_BASE,
  jsonFetch,
  normalizeJob,
  htmlToText,
  writeError,
  type JobDetail,
  type RawMuseJob,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a bare numeric id, or a themuse.com job URL we can pull an id from. */
export function extractId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) return trimmed
  const m = trimmed.match(/themuse\.com\/jobs\/.*?(\d{5,})/i) || trimmed.match(/(\d{5,})/)
  return m ? m[1] : null
}

export function buildDetail(raw: RawMuseJob): JobDetail | null {
  const card = normalizeJob(raw)
  if (!card) return null
  const description = typeof raw.contents === "string" ? htmlToText(raw.contents) : null
  return {
    ...card,
    description: description || null,
    // The Muse routes applications through its own landing page.
    applyUrl: card.url,
  }
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  try {
    const id = extractId(opts.id)
    if (!id) {
      writeError(`could not extract a job id from "${opts.id}"`, "BAD_ID")
      return 1
    }

    const raw = await jsonFetch<RawMuseJob>(`${API_BASE}/${encodeURIComponent(id)}`)
    if (!raw) {
      writeError(`no job found with id ${id}`, "NOT_FOUND")
      return 1
    }

    const detail = buildDetail(raw)
    if (!detail) {
      writeError(`job ${id} returned an unparseable record`, "PARSE_FAILED")
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        detail.title,
        `${detail.company || "—"} · ${detail.location || "—"}`,
        `Posted: ${detail.date || "—"}`,
        detail.levels ? `Level: ${detail.levels}` : null,
        detail.categories ? `Category: ${detail.categories}` : null,
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

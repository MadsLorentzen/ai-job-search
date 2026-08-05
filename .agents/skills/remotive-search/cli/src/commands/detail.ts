import {
  API_BASE,
  jsonFetch,
  parseJobs,
  normalizeJob,
  htmlToText,
  writeError,
  type JobDetail,
  type RemotiveResponse,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a bare numeric id or a remotive.com job URL ending in `-<id>`. */
export function extractId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) return trimmed
  const m = trimmed.match(/remotive\.com\/remote-jobs\/.*?-(\d{4,})/i) || trimmed.match(/(\d{4,})/)
  return m ? m[1] : null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  try {
    const id = extractId(opts.id)
    if (!id) {
      writeError(`could not extract a job id from "${opts.id}"`, "BAD_ID")
      return 1
    }

    // Remotive has NO per-job endpoint — the feed already carries the full
    // description, so `detail` re-fetches the feed and selects locally.
    const response = await jsonFetch<RemotiveResponse>(API_BASE)
    if (!response) {
      writeError("Remotive returned no feed", "NOT_FOUND")
      return 1
    }

    const raw = (response.jobs ?? []).find((j) => j && String(j.id) === id)
    if (!raw) {
      writeError(
        `no job with id ${id} in the current Remotive feed (the free feed holds only the most recent ${response["total-job-count"] ?? "few"} jobs, so older postings drop out)`,
        "NOT_FOUND",
      )
      return 1
    }

    const card = normalizeJob(raw)
    if (!card) {
      writeError(`job ${id} returned an unparseable record`, "PARSE_FAILED")
      return 1
    }

    const detail: JobDetail = {
      ...card,
      description: raw.description ? htmlToText(raw.description) || null : null,
      applyUrl: card.url,
    }

    if (opts.format === "plain") {
      const lines = [
        detail.title,
        `${detail.company || "—"} · ${detail.location || "—"}`,
        `Posted: ${detail.date || "—"}`,
        detail.category ? `Category: ${detail.category}` : null,
        detail.jobType ? `Type: ${detail.jobType}` : null,
        detail.salary ? `Salary: ${detail.salary}` : null,
        `URL: ${detail.url}`,
        "",
        detail.description || "(no description)",
        "",
        "Source: Remotive (https://remotive.com)",
      ].filter((l): l is string => l !== null)
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(
        JSON.stringify({ ...detail, attribution: "https://remotive.com" }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}

/** Exposed for tests: select + normalize a job from an already-fetched feed. */
export function selectFromFeed(response: RemotiveResponse | null, id: string): JobDetail | null {
  const raw = (response?.jobs ?? []).find((j) => j && String(j.id) === id)
  if (!raw) return null
  const card = normalizeJob(raw)
  if (!card) return null
  return {
    ...card,
    description: raw.description ? htmlToText(raw.description) || null : null,
    applyUrl: card.url,
  }
}

/** Exposed for tests: the feed-wide parse used by search. */
export const _parseJobs = parseJobs

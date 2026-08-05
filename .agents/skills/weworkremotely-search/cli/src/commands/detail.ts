import {
  ALL_FEED,
  CATEGORIES,
  feedUrl,
  textFetch,
  parseFeed,
  descriptionFor,
  idFromLink,
  writeError,
  type JobDetail,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  category?: string
  format: "json" | "plain"
}

/** Accept a WWR posting URL or the bare slug id. */
export function extractId(input: string): string | null {
  const trimmed = input.trim()
  if (/weworkremotely\.com/i.test(trimmed)) return idFromLink(trimmed)
  if (/^[a-z0-9][a-z0-9-]{3,}$/i.test(trimmed)) return trimmed
  return null
}

/** Build the ordered list of feeds to try when locating a posting. */
export function feedsToTry(category: string | undefined): string[] {
  if (category) return [feedUrl(category)]
  // The combined feed first; a posting can be absent from it but present in its
  // own category feed, since each feed is an independent fixed-size window.
  return [ALL_FEED, ...CATEGORIES.map((c) => feedUrl(c))]
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  try {
    const id = extractId(opts.id)
    if (!id) {
      writeError(`could not extract a job id from "${opts.id}"`, "BAD_ID")
      return 1
    }

    // WWR has no per-job API. Descriptions ship inside the RSS, so locate the
    // posting by scanning feeds — stopping at the first that carries it.
    let detail: JobDetail | null = null
    let searched = 0

    for (const url of feedsToTry(opts.category)) {
      searched++
      const xml = await textFetch(url)
      if (!xml) continue
      const card = parseFeed(xml).find((c) => c.id === id)
      if (!card) continue
      detail = {
        ...card,
        description: descriptionFor(xml, id),
        applyUrl: card.url,
      }
      break
    }

    if (!detail) {
      writeError(
        `no job with id "${id}" found across ${searched} feed(s). WWR's RSS is a fixed-size recent window, so older postings drop out of it — open the URL directly instead.`,
        "NOT_FOUND",
      )
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        detail.title,
        `${detail.company || "—"} · ${detail.region || detail.location || "—"}`,
        `Posted: ${detail.date || "—"}`,
        detail.category ? `Category: ${detail.category}` : null,
        detail.jobType ? `Type: ${detail.jobType}` : null,
        detail.skills ? `Skills: ${detail.skills}` : null,
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

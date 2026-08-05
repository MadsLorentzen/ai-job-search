import {
  API_BASE,
  jsonFetch,
  normalizeJob,
  htmlToText,
  writeError,
  type JobDetail,
  type RawLeverPosting,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  site?: string
  format: "json" | "plain"
}

/**
 * Lever posting IDs are UUIDs and are site-scoped, so `detail` needs both.
 * Accepts a full jobs.lever.co URL (which carries both), or a UUID together
 * with --company.
 */
export function parseRef(
  input: string,
  siteFlag: string | undefined,
): { site: string; id: string } | null {
  const trimmed = input.trim()
  const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

  const urlMatch = trimmed.match(new RegExp(`lever\\.co/([^/?#]+)/(${UUID})`, "i"))
  if (urlMatch) return { site: urlMatch[1]!, id: urlMatch[2]! }

  if (new RegExp(`^${UUID}$`, "i").test(trimmed) && siteFlag) {
    return { site: siteFlag, id: trimmed }
  }

  return null
}

/**
 * Assemble the readable description. Lever splits a posting across
 * `descriptionPlain` (the intro), `lists[]` (requirements/responsibilities as
 * HTML `<li>` blobs) and `additionalPlain` (closing text) — concatenate all
 * three or the requirements section goes missing.
 */
export function buildDescription(raw: RawLeverPosting): string | null {
  const parts: string[] = []
  if (raw.descriptionPlain?.trim()) parts.push(raw.descriptionPlain.trim())

  if (Array.isArray(raw.lists)) {
    for (const list of raw.lists) {
      if (!list) continue
      const heading = list.text?.trim()
      const body = list.content ? htmlToText(list.content) : ""
      if (heading || body) {
        parts.push([heading, body].filter(Boolean).join("\n"))
      }
    }
  }

  if (raw.additionalPlain?.trim()) parts.push(raw.additionalPlain.trim())

  const joined = parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim()
  return joined || null
}

export function buildDetail(raw: RawLeverPosting, site: string): JobDetail | null {
  const card = normalizeJob(raw, site)
  if (!card) return null
  return {
    ...card,
    description: buildDescription(raw),
    applyUrl: raw.applyUrl || `${card.url}/apply`,
  }
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  try {
    const ref = parseRef(opts.id, opts.site)
    if (!ref) {
      writeError(
        `could not resolve a site + posting id from "${opts.id}". Pass a full jobs.lever.co URL, or a posting UUID together with --company <site>.`,
        "BAD_ID",
      )
      return 1
    }

    const raw = await jsonFetch<RawLeverPosting>(
      `${API_BASE}/${encodeURIComponent(ref.site)}/${encodeURIComponent(ref.id)}?mode=json`,
    )
    if (!raw) {
      writeError(`no posting found for site "${ref.site}" with id ${ref.id}`, "NOT_FOUND")
      return 1
    }

    const detail = buildDetail(raw, ref.site)
    if (!detail) {
      writeError(`posting ${ref.id} returned an unparseable record`, "PARSE_FAILED")
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        detail.title,
        `${detail.company || "—"} · ${detail.location || "—"}`,
        `Posted: ${detail.date || "—"}`,
        detail.team ? `Team: ${detail.team}` : null,
        detail.commitment ? `Commitment: ${detail.commitment}` : null,
        detail.workplaceType ? `Workplace: ${detail.workplaceType}` : null,
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

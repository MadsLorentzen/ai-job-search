import { BASE_URL, htmlFetch, parseMissionDetail, refFromPath, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * Accept a bare mission reference, a slug, a path, or a full URL. The portal
 * canonicalises on the trailing reference, so `/mission-x-<REF>` 301-redirects
 * to the real slug — we never need to know the slug to fetch a mission by id.
 */
export function detailUrl(input: string): string | null {
  const ref = refFromPath(input)
  if (ref) return `${BASE_URL}/mission-x-${ref}`
  if (/^https?:\/\//i.test(input)) return input
  if (input.startsWith("/")) return `${BASE_URL}${input}`
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const url = detailUrl(opts.id)
  if (!url) {
    writeError(
      `Could not parse a mission reference from "${opts.id}" — pass a reference like 260728C015, or the full mission URL`,
      "BAD_ID",
    )
    return 1
  }
  try {
    const { html, url: finalUrl } = await htmlFetch(url)
    // A bogus reference is served as HTTP 200 with a generic page, so an empty
    // body is not the only not-found signal — the parser reports the other one.
    const mission = html ? parseMissionDetail(html, finalUrl) : null
    if (!mission) {
      writeError("Mission not found", "NOT_FOUND")
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        mission.title,
        `Ref ${mission.id} · ${mission.location || "—"} · ${mission.duration || "—"}`,
        mission.startDate ? `Start: ${mission.startDate}` : "",
        mission.profile ? `Profile: ${mission.profile}` : "",
        mission.sector ? `Sector: ${mission.sector}` : "",
        mission.requiredSkills.length ? `Required: ${mission.requiredSkills.join(", ")}` : "",
        mission.optionalSkills.length ? `Optional: ${mission.optionalSkills.join(", ")}` : "",
        mission.dateRaw ? `Posted: ${mission.dateRaw} (${mission.date || "—"})` : "",
        "",
        mission.description || "(no description)",
        "",
        `URL: ${mission.url}`,
        mission.applyUrl ? `Apply: ${mission.applyUrl}` : "",
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(mission, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}

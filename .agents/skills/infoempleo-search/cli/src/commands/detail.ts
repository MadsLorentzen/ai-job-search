import { BASE_URL, CliError, OFFER_PATH, htmlFetch, parseJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const INFOEMPLEO_HOST = /(^|\.)infoempleo\.com$/i

/**
 * Accept a bare numeric offer ID or an infoempleo.com offer URL
 * (/ofertasdetrabajo/<slug>/<city>/<id>/). A URL on any other host is
 * rejected, using real URL parsing so look-alike hosts (infoempleo.com.evil.io)
 * and userinfo tricks (infoempleo.com@evil.io) fall on the reject side.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d{5,}$/.test(trimmed)) return trimmed

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!INFOEMPLEO_HOST.test(parsed.hostname)) return null
    const path = parsed.pathname.match(/^\/ofertasdetrabajo\/(?:[^/]+\/){2}(\d{5,})\/?$/)
    return path ? path[1] : null
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse an Infoempleo offer ID from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    // The site resolves an offer from its trailing ID; the slug/city segments
    // are cosmetic, so a bare ID is enough to fetch it.
    const html = await htmlFetch(`${BASE_URL}${OFFER_PATH}x/y/${id}/`)
    if (!html) {
      writeError("Offer not found (expired or removed)", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(html, id)
    if (!job) {
      writeError("Offer page had no JobPosting data; the markup may have changed", "PARSE_FAILED")
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.date ? `Published: ${job.date}` : "",
        job.deadline ? `Deadline: ${job.deadline}` : "",
        job.salary ? `Salary: ${job.salary}` : "",
        job.experience ? `Experience: ${job.experience}` : "",
        job.workHours ? `Hours: ${job.workHours}` : "",
        job.industry ? `Industry: ${job.industry}` : "",
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), e instanceof CliError ? e.code : "DETAIL_FAILED")
    return 1
  }
}

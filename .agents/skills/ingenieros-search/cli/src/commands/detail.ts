import { CliError, DETAIL_URL, htmlFetch, parseJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const INGENIEROS_HOST = /(^|\.)ingenieros\.es$/i

/**
 * Accept a bare numeric offer ID or an ingenieros.es detalles_oferta URL. A
 * URL on any other host is rejected, using real URL parsing so look-alike
 * hosts (ingenieros.es.evil.io) and userinfo tricks (ingenieros.es@evil.io)
 * fall on the reject side.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d{1,7}$/.test(trimmed) && Number(trimmed) > 0) return String(Number(trimmed))

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!INGENIEROS_HOST.test(parsed.hostname)) return null
    const path = parsed.pathname.match(/^\/bolsa_de_trabajo\/detalles_oferta\/(\d{1,7})\/?$/)
    return path ? String(Number(path[1])) : null
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse an Ingenieros.es offer ID from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const html = await htmlFetch(`${DETAIL_URL}/${id}`)
    if (!html) {
      writeError("Offer not found (expired or removed)", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(html, id)
    if (!job) {
      writeError("The page was not an offer page; the markup may have changed or the offer was removed", "PARSE_FAILED")
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}${job.province ? ` (${job.province})` : ""}`,
        "",
        job.date ? `Published: ${job.date}` : "",
        job.level ? `Level: ${job.level}` : "",
        job.sector ? `Sector: ${job.sector}` : "",
        job.contract ? `Contract: ${job.contract}` : "",
        job.workday ? `Hours: ${job.workday}` : "",
        job.salary ? `Salary: ${job.salary}` : "",
        job.minStudies ? `Min studies: ${job.minStudies}` : "",
        job.minExperience ? `Min experience: ${job.minExperience}` : "",
        "",
        job.description || "(no description)",
        job.minRequirements ? `\nRequirements:\n${job.minRequirements}` : "",
        job.desiredRequirements ? `\nDesired:\n${job.desiredRequirements}` : "",
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

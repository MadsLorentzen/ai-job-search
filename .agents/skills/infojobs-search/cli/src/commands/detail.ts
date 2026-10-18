import { CliError, DETAIL_PATH, apiFetch, parseDetailResponse, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const INFOJOBS_HOST = /(^|\.)infojobs\.net$/i
const OFFER_ID = /^[0-9a-f]{20,40}$/i

/**
 * Accept a bare offer ID (a 20-40 character hex string) or an infojobs.net
 * offer URL whose path ends in `of-i<id>`. A URL on any other host is
 * rejected, using real URL parsing so look-alike hosts (infojobs.net.evil.io)
 * and userinfo tricks (infojobs.net@evil.io) fall on the reject side.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (OFFER_ID.test(trimmed)) return trimmed.toLowerCase()

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (!hasScheme && !/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) return null
  let parsed: URL
  try {
    parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (!INFOJOBS_HOST.test(parsed.hostname)) return null
  const m = parsed.pathname.match(/\/of-i([0-9a-f]{20,40})\/?$/i)
  return m ? m[1].toLowerCase() : null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse an InfoJobs offer ID from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const data = await apiFetch(`${DETAIL_PATH}/${id}`)
    if (data === null) {
      writeError("Offer not found (expired or removed)", "NOT_FOUND")
      return 1
    }
    const job = parseDetailResponse(data, id)
    if (!job) {
      throw new CliError("InfoJobs returned an offer without a title; the API response shape may have changed", "PARSE_FAILED")
    }

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.date ? `Published: ${job.date}` : "",
        job.active === false ? "Status: CLOSED / INACTIVE" : "",
        job.salary ? `Salary: ${job.salary}` : "",
        job.contract ? `Contract: ${job.contract}` : "",
        job.workday ? `Hours: ${job.workday}` : "",
        job.experience ? `Experience: ${job.experience}` : "",
        job.studies ? `Studies: ${job.studies}` : "",
        job.skills.length ? `Skills: ${job.skills.join(", ")}` : "",
        "",
        job.description || "(no description)",
        job.minRequirements ? `\nMinimum requirements:\n${job.minRequirements}` : "",
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

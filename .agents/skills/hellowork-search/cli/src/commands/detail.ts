import { DETAIL_URL, htmlFetch, parseJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a bare numeric id or a full/partial HelloWork posting URL. */
export function normalizeId(input: string): string | null {
  const bare = input.match(/^\d{5,}$/)
  if (bare) return input
  const url = input.match(/\/emplois\/(\d{5,})\.html/)
  if (url) return url[1]
  const loose = input.match(/(\d{5,})\.html/)
  if (loose) return loose[1]
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(
      `Could not parse a HelloWork job id from "${opts.id}". ` +
        `Pass a numeric id (e.g. 81577686) or a posting URL ` +
        `(https://www.hellowork.com/fr-fr/emplois/81577686.html).`,
      "BAD_ID",
    )
    return 1
  }

  try {
    const html = await htmlFetch(`${DETAIL_URL}/${id}.html`)
    if (!html) {
      writeError("Job not found (the posting may have expired)", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(html, id)
    if (!job) {
      writeError("Could not parse the posting page", "PARSE_FAILED")
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.contract ? `Contract: ${job.contract}` : "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.salary ? `Salary / TJM: ${job.salary}` : "",
        job.date ? `Posted: ${job.date}` : "",
        job.validThrough ? `Valid through: ${job.validThrough}` : "",
        job.experienceMonths != null
          ? `Experience: ${job.experienceMonths} months (${Math.round(job.experienceMonths / 12)}y)`
          : "",
        job.education ? `Education: ${job.education}` : "",
        job.industry ? `Industry: ${job.industry.join(", ")}` : "",
        job.skills ? `Skills: ${job.skills.join(", ")}` : "",
        "",
        job.description || "(no description)",
        job.qualifications ? `\n--- Profil recherché ---\n${job.qualifications}` : "",
        "",
        `URL: ${job.url}`,
        job.applyUrl ? `Apply: ${job.applyUrl}` : "",
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}

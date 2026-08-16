import {
  JOB_URL,
  htmlFetch,
  parseJobDetail,
  normalizeId,
  writeError,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(
      `Could not parse a Foundit job id from "${opts.id}" (pass a numeric id or a https://www.foundit.in/job/... URL)`,
      "BAD_ID",
    )
    return 1
  }
  try {
    const html = await htmlFetch(`${JOB_URL}/${id}`)
    if (!html) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(html, id)

    if (opts.format === "plain") {
      const exp =
        job.experienceMonths != null
          ? `${Math.round((job.experienceMonths / 12) * 10) / 10} yrs`
          : null
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        exp ? `Experience: ${exp}` : "",
        job.category ? `Category: ${job.category}` : "",
        job.industry ? `Industry: ${job.industry}` : "",
        job.date ? `Posted: ${job.date}` : "",
        job.deadline ? `Apply by: ${job.deadline}` : "",
        job.skills.length ? `Skills: ${job.skills.join(", ")}` : "",
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
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}

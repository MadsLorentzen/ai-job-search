import { DETAIL_URL, jsonFetch, mapDetail, normalizeId, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

interface DetailResponse {
  job?: Parameters<typeof mapDetail>[0]
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a job id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const data = await jsonFetch<DetailResponse>(`${DETAIL_URL}/${id}`)
    if (!data || !data.job) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = mapDetail(data.job)

    if (opts.format === "plain") {
      const exp =
        job.experience && (job.experience.minValue != null || job.experience.maxValue != null)
          ? `${job.experience.minValue ?? "?"}-${job.experience.maxValue ?? "?"} yrs`
          : null
      const sal =
        job.salary && (job.salary.minValue != null || job.salary.maxValue != null)
          ? `${job.salary.minValue ?? "?"}-${job.salary.maxValue ?? "?"} LPA`
          : null
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.domain ? `Domain: ${job.domain}` : "",
        exp ? `Experience: ${exp}` : "",
        sal ? `Salary: ${sal}` : "",
        job.competition ? `Competition: ${job.competition}` : "",
        job.shortlisting ? `Shortlisting strictness: ${job.shortlisting}` : "",
        "",
        job.description || "(no description)",
        "",
        job.url ? `Apply: ${job.url}` : "Apply link: run `search` for this role to get the apply URL.",
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

import { apiGet, normalizeSlug, toDetail, writeError, type FreehireJob } from "../helpers.js"

export interface DetailOpts {
  id: string // a freehire public slug or a /jobs/<slug> URL
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const slug = normalizeSlug(opts.id)
  if (!slug) {
    writeError(`could not parse a freehire slug from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const env = await apiGet<FreehireJob>(`/api/v1/jobs/${encodeURIComponent(slug)}`)
    if (!env) {
      writeError("job not found", "NOT_FOUND")
      return 1
    }
    const job = toDetail(env.data)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        job.date ? `Posted: ${job.date.slice(0, 10)}` : "",
        job.seniority ? `Seniority: ${job.seniority}` : "",
        job.category ? `Category: ${job.category}` : "",
        job.employment_type ? `Employment: ${job.employment_type}` : "",
        job.salary ? `Salary: ${job.salary}` : "",
        job.skills.length ? `Skills: ${job.skills.join(", ")}` : "",
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
        `slug: ${job.id}`,
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

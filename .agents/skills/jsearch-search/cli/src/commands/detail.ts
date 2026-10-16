import { ApiError, DETAIL_URL, apiFetch, dataOf, readToken, toDetail } from "../helpers.js"

export interface DetailOpts {
  id: string
  country?: string
  format: "json" | "plain"
}

export function buildUrl(opts: DetailOpts): string {
  const params = new URLSearchParams()
  params.set("job_id", opts.id)
  if (opts.country) params.set("country", opts.country.toLowerCase())
  return `${DETAIL_URL}?${params.toString()}`
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const token = readToken()
  const body = await apiFetch(buildUrl(opts), token)
  const raw = dataOf(body)[0]
  const job = raw ? toDetail(raw) : null
  if (!job) throw new ApiError(`no JSearch job found for id "${opts.id}" - ids come from this CLI's search output`, "NOT_FOUND")

  if (opts.format === "plain") {
    const out = [
      job.title,
      `${job.company || "—"} · ${job.location || "—"} · ${job.date || "—"} · via ${job.publisher || "—"}`,
      job.employerWebsite ? `Employer site: ${job.employerWebsite}` : "",
      "",
      job.description || "(no description)",
      "",
      "Apply options:",
      ...job.applyOptions.map((o) => `  - ${o.publisher || "—"}${o.isDirect ? " (direct)" : ""}: ${o.url}`),
    ]
    process.stdout.write(out.filter((l, i) => l !== "" || i > 0).join("\n") + "\n")
  } else {
    process.stdout.write(JSON.stringify({ result: job }, null, 2) + "\n")
  }
  return 0
}

import {
  API_BASE,
  jsonFetch,
  htmlFetch,
  buildDetail,
  writeError,
  type JobDetail,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

interface ApiJobResponse {
  id: number | string
  title?: string | null
  candidate_title?: string | null
  locations?: string | null
  public_url?: string | null
  employer?: { company_name?: string | null } | null
  keywords?: string[] | null
}

/** Accept a numeric job id or a full public posting URL. */
function normalize(input: string): { id: string; url: string | null } | null {
  const trimmed = input.trim()
  const urlMatch = trimmed.match(/instahyre\.com\/job-(\d+)/)
  if (urlMatch) return { id: urlMatch[1], url: trimmed.split("?")[0] }
  if (/^https?:\/\//.test(trimmed)) return { id: trimmed, url: trimmed.split("?")[0] }
  const bare = trimmed.match(/^(\d+)$/)
  if (bare) return { id: bare[1], url: null }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const norm = normalize(opts.id)
  if (!norm) {
    writeError(`Could not parse a job id or URL from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    // Resolve the public posting URL (and basic fields) via the JSON API when
    // we only have a numeric id.
    let apiJob: ApiJobResponse | null = null
    let publicUrl = norm.url
    if (/^\d+$/.test(norm.id)) {
      apiJob = await jsonFetch<ApiJobResponse>(`${API_BASE}/${norm.id}`)
      if (apiJob?.public_url) publicUrl = apiJob.public_url
    }
    if (!publicUrl) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }

    const html = await htmlFetch(publicUrl)
    if (!html && !apiJob) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job: JobDetail = buildDetail(norm.id, apiJob, html)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.date ? `Posted: ${job.date}` : "",
        job.keywords.length ? `Skills: ${job.keywords.join(", ")}` : "",
        "",
        job.description || "(no description)",
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

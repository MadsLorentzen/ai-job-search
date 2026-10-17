import {
  BASE_URL,
  htmlFetch,
  parseJobDetail,
  writeError,
  type JobDetail,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const ROZEE_HOST = /(^|\.)rozee\.pk$/i
const PERMALINK = /^[a-z0-9]+(?:-[a-z0-9]+)*-jobs-\d{5,}$/i

export function normalizeDetailInput(input: string): { id: string; url: string } | null {
  const trimmed = input.trim()
  if (!trimmed || /^\d+$/.test(trimmed)) return null

  const hasScheme = /^https?:\/\//i.test(trimmed)
  const looksLikeHost = /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)
  if (hasScheme || looksLikeHost) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!ROZEE_HOST.test(parsed.hostname)) return null
    const slug = parsed.pathname.replace(/^\/+|\/+$/g, "")
    if (!PERMALINK.test(slug)) return null
    return { id: slug, url: `${BASE_URL}/${slug}` }
  }

  if (!PERMALINK.test(trimmed)) return null
  return { id: trimmed, url: `${BASE_URL}/${trimmed}` }
}

function renderPlain(job: JobDetail): string {
  return [
    job.title,
    `${job.company ?? "—"} · ${job.location ?? "—"} · ${job.date ?? "—"}`,
    job.employmentType ? `Employment: ${job.employmentType}` : "",
    job.validThrough ? `Apply by: ${job.validThrough}` : "",
    "",
    job.description ?? "(no description)",
    "",
    `URL: ${job.url}`,
  ]
    .filter((line) => line !== "")
    .join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const target = normalizeDetailInput(opts.id)
  if (!target) {
    writeError(
      `Could not resolve "${opts.id}". Use a Rozee permalink slug or a Rozee job-detail URL from search results.`,
      "BAD_ID",
    )
    return 1
  }

  try {
    const html = await htmlFetch(target.url)
    if (!html) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(html, target.url, target.id)
    if (!job) {
      writeError("The page did not contain a readable JobPosting record", "PARSE_FAILED")
      return 1
    }
    process.stdout.write(
      opts.format === "plain"
        ? renderPlain(job) + "\n"
        : JSON.stringify(job, null, 2) + "\n",
    )
    return 0
  } catch (error) {
    writeError(error instanceof Error ? error.message : String(error), "DETAIL_FAILED")
    return 1
  }
}

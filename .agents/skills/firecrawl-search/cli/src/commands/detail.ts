import {
  JOB_PROMPT,
  JOB_SCHEMA,
  apiPost,
  toDetail,
  writeError,
  type JobDetailResult,
  type ScrapedDoc,
} from "../helpers.js"

export interface DetailOpts {
  id: string // a posting URL (search results use the URL as their id)
  format: "json" | "plain"
}

/** Accept a bare URL, adding https:// when the scheme was left off. */
export function normalizeUrl(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `https://${text}`
  try {
    const parsed = new URL(withScheme)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    if (!parsed.hostname.includes(".")) return null
    return parsed.toString()
  } catch {
    return null
  }
}

/** A human-readable rendering of one posting: header, present fields, description. */
function renderPlain(job: JobDetailResult): string {
  const lines = [job.title, `${job.company ?? "—"} · ${job.location ?? "—"}`]

  const field = (label: string, value: string | null) => {
    if (value) lines.push(`${label}: ${value}`)
  }
  field("Posted", job.date)
  field("Employment", job.employment_type)
  field("Deadline", job.deadline)

  lines.push("", job.description ?? "(no description)", "", `URL: ${job.url}`)
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const url = normalizeUrl(opts.id)
  if (!url) {
    writeError(`could not parse a posting URL from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    // markdown carries the posting text; the json format extracts the structured
    // fields from the same scrape, so this is one request rather than two.
    const envelope = await apiPost<ScrapedDoc>("/v2/scrape", {
      url,
      onlyMainContent: true,
      formats: ["markdown", { type: "json", prompt: JOB_PROMPT, schema: JOB_SCHEMA }],
    })
    const doc = envelope.data
    if (!doc) {
      writeError("posting not found", "NOT_FOUND")
      return 1
    }
    const job = toDetail(doc, url)

    if (opts.format === "plain") {
      process.stdout.write(renderPlain(job) + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}

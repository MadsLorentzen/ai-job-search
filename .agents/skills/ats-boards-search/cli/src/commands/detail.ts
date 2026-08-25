import {
  boardUrls,
  jsonFetch,
  parseAshbyJobs,
  parseGreenhouseJobs,
  parseLeverJobs,
  stripHtml,
  type BoardKind,
  type JobResult,
} from "../helpers.js"

export interface DetailOpts {
  target: string
  format: "json" | "plain" | "table"
}

function splitTarget(raw: string): { kind: BoardKind; token: string; jobId: string } {
  const parts = raw.trim().split(":")
  const kind = parts[0]?.toLowerCase()
  if ((kind === "greenhouse" || kind === "lever" || kind === "ashby") && parts.length >= 3) {
    return { kind, token: parts[1], jobId: parts.slice(2).join(":") }
  }
  throw Object.assign(
    new Error("detail needs kind:boardToken:jobId (copy the id from search output)"),
    { code: "BAD_ARG" },
  )
}

export async function runDetail(opts: DetailOpts): Promise<void> {
  const { kind, token, jobId } = splitTarget(opts.target)
  const board = { kind, token, raw: `${kind}:${token}` }
  const payload = await jsonFetch(boardUrls(board).job(jobId))
  if (payload == null) {
    throw Object.assign(new Error("job not found"), { code: "NOT_FOUND" })
  }

  let job: JobResult | undefined
  if (kind === "greenhouse") {
    job = parseGreenhouseJobs({ jobs: [payload] }, token)[0]
  } else if (kind === "lever") {
    job = parseLeverJobs(Array.isArray(payload) ? payload : [payload], token)[0]
  } else {
    const wrapped = {
      jobs: Array.isArray((payload as { jobs?: unknown }).jobs)
        ? (payload as { jobs: unknown[] }).jobs
        : [payload],
    }
    job = parseAshbyJobs(wrapped, token)[0]
  }

  if (!job) {
    throw Object.assign(new Error("could not parse job detail"), { code: "PARSE" })
  }
  job.id = `${kind}:${token}:${jobId}`
  if (!job.description) {
    const html =
      (payload as { content?: string }).content ??
      (payload as { descriptionHtml?: string }).descriptionHtml
    job.description = stripHtml(html)
  }

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify(job) + "\n")
    return
  }
  process.stdout.write(
    `${job.title}\n${job.company ?? ""} · ${job.location ?? ""} · ${job.date ?? ""}\n${job.url}\n\n${job.description ?? ""}\n`,
  )
}
